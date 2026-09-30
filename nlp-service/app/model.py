"""Carregamento e predição do pipeline TF-IDF + SVM."""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import joblib

FALLBACK = "FALLBACK"
VALID_INTENTS = {"AGENDAR", "ALTERAR", "CANCELAR", "CONSULTAR", "SAUDACAO", FALLBACK}


def load_model(model_path: str | Path) -> dict[str, Any]:
    return joblib.load(model_path)


def classify(
    text: str,
    artifact: dict[str, Any],
    confidence_threshold: float,
) -> tuple[str, float]:
    """Classifica texto e força fallback quando a margem SVM é insuficiente."""
    pipeline = artifact["pipeline"]
    intent = str(pipeline.predict([text])[0])
    classes = [str(label) for label in pipeline.classes_]
    if intent not in VALID_INTENTS or intent not in classes:
        return FALLBACK, 0.0

    scores = list(pipeline.decision_function([text])[0])
    predicted_index = classes.index(intent)
    runner_up = max(
        score for index, score in enumerate(scores) if index != predicted_index
    )
    # A sigmoide normaliza a distância entre a intenção vencedora e a segunda
    # colocada para 0..1. Não é uma probabilidade gerada: é a margem da SVM.
    margin = float(scores[predicted_index] - runner_up)
    confidence = 1 / (1 + math.exp(-margin))

    if intent == FALLBACK or confidence < confidence_threshold:
        return FALLBACK, confidence
    return intent, confidence
