from collections import Counter
from pathlib import Path

from app.train import MIN_EXAMPLES_PER_INTENT, load_examples


DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "intents.json"


def test_corpus_meets_pln10_minimum_for_every_intent() -> None:
    _texts, labels = load_examples(DATA_PATH)
    counts = Counter(labels)

    assert set(counts) == {
        "AGENDAR",
        "ALTERAR",
        "CANCELAR",
        "CONSULTAR",
        "FALLBACK",
        "SAUDACAO",
    }
