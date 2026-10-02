"""Treina e avalia o classificador de intenções a partir do corpus versionado."""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import joblib
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics import accuracy_score, classification_report, f1_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import FeatureUnion, Pipeline
from sklearn.svm import LinearSVC

from app.preprocess import normalize_text, tokenize


def load_examples(data_path: Path) -> tuple[list[str], list[str]]:
    payload = json.loads(data_path.read_text(encoding="utf-8"))
    intents = payload.get("intents", [])

    texts: list[str] = []
    labels: list[str] = []
    for item in intents:
        name = item.get("name")
        examples = item.get("examples", [])
        if not isinstance(name, str) or not isinstance(examples, list):
            raise ValueError("Cada intenção deve conter name e examples válidos.")
        for example in examples:
            if isinstance(example, str) and example.strip():
                texts.append(example.strip())
                labels.append(name)

    if len(set(labels)) < 2:
        raise ValueError("O corpus precisa conter ao menos duas intenções.")
    if min(labels.count(label) for label in set(labels)) < 6:
        raise ValueError("Cada intenção precisa de pelo menos seis exemplos.")
    return texts, labels


def create_pipeline() -> Pipeline:
    word_vectorizer = TfidfVectorizer(
        tokenizer=tokenize,
        token_pattern=None,
        lowercase=False,
        ngram_range=(1, 2),
        sublinear_tf=True,
        min_df=1,
    )
    # N-gramas de caracteres tornam o classificador mais tolerante a flexões
    # como "cancelo/cancelar" e variações curtas de digitação.
    character_vectorizer = TfidfVectorizer(
        analyzer="char_wb",
        preprocessor=normalize_text,
        lowercase=False,
        ngram_range=(3, 5),
        sublinear_tf=True,
        min_df=1,
    )
    vectorizer = FeatureUnion(
        [("words", word_vectorizer), ("characters", character_vectorizer)]
    )
    # SVM linear. A confiança é calculada em model.py pela margem da decisão
    # entre a intenção prevista e a segunda melhor intenção.
    svm = LinearSVC(
        C=1.0,
        class_weight="balanced",
        random_state=42,
    )
    return Pipeline([("tfidf", vectorizer), ("svm", svm)])


def train(data_path: Path, artifact_dir: Path) -> dict[str, Any]:
    texts, labels = load_examples(data_path)
    train_texts, test_texts, train_labels, test_labels = train_test_split(
        texts,
        labels,
        test_size=0.2,
        random_state=42,
        stratify=labels,
    )

    evaluation_pipeline = create_pipeline()
    evaluation_pipeline.fit(train_texts, train_labels)
    predictions = evaluation_pipeline.predict(test_texts)

    corpus_digest = hashlib.sha256(data_path.read_bytes()).hexdigest()[:12]
    trained_at = datetime.now(UTC).isoformat()
    metadata: dict[str, Any] = {
        "model_version": f"tfidf-word-char-linear-svm-{corpus_digest}",
        "trained_at": trained_at,
        "corpus_sha256": corpus_digest,
        "samples": len(texts),
        "labels": sorted(set(labels)),
        "accuracy": round(float(accuracy_score(test_labels, predictions)), 4),
        "f1_macro": round(float(f1_score(test_labels, predictions, average="macro")), 4),
        "classification_report": classification_report(
            test_labels,
            predictions,
            output_dict=True,
            zero_division=0,
        ),
    }

    # Após avaliar em dados separados, o modelo que vai para produção é
    # refeito com todo o corpus disponível. Assim nenhuma frase versionada fica
    # inutilizada apenas por ter participado do conjunto de teste.
    production_pipeline = create_pipeline()
    production_pipeline.fit(texts, labels)

    artifact_dir.mkdir(parents=True, exist_ok=True)
    artifact = {"pipeline": production_pipeline, "metadata": metadata}
    joblib.dump(artifact, artifact_dir / "intent_classifier.joblib")
    (artifact_dir / "metrics.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return metadata


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=Path("data/intents.json"))
    parser.add_argument("--artifact-dir", type=Path, default=Path("artifacts"))
    args = parser.parse_args()

    metadata = train(args.data, args.artifact_dir)
    print(json.dumps({k: metadata[k] for k in ("samples", "accuracy", "f1_macro", "model_version")}))


if __name__ == "__main__":
    main()
