"""API interna para a classificação de intenções."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from app.model import classify, load_model

app = FastAPI(title="DelBicos Intent Classifier", docs_url=None, redoc_url=None)
artifact: dict[str, Any] | None = None


class ClassifyRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class ClassifyResponse(BaseModel):
    intent: str
    confidence: float
    model_version: str


def get_threshold() -> float:
    raw = os.getenv("NLU_CONFIDENCE_THRESHOLD", "0.65")
    try:
        return min(1.0, max(0.0, float(raw)))
    except ValueError:
        return 0.65


@app.on_event("startup")
def startup() -> None:
    global artifact
    model_path = Path(os.getenv("MODEL_PATH", "/app/artifacts/intent_classifier.joblib"))
    artifact = load_model(model_path)


@app.get("/health")
def health() -> dict[str, str]:
    if artifact is None:
        raise HTTPException(status_code=503, detail="Modelo ainda não foi carregado.")
    return {"status": "ok", "model_version": str(artifact["metadata"]["model_version"])}


@app.post("/classify", response_model=ClassifyResponse)
def classify_intent(request: ClassifyRequest) -> ClassifyResponse:
    if artifact is None:
        raise HTTPException(status_code=503, detail="Modelo indisponível.")
    intent, confidence = classify(request.text, artifact, get_threshold())
    return ClassifyResponse(
        intent=intent,
        confidence=round(confidence, 4),
        model_version=str(artifact["metadata"]["model_version"]),
    )
