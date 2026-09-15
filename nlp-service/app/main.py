"""API interna para a classificação de intenções."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from app.model import classify, load_model
from app.semantic import SemanticCandidate, rank_candidates

app = FastAPI(title="DelBicos Intent Classifier", docs_url=None, redoc_url=None)
artifact: dict[str, Any] | None = None


class ClassifyRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class ClassifyResponse(BaseModel):
    intent: str
    confidence: float
    model_version: str


class SemanticCandidateRequest(BaseModel):
    id: int = Field(gt=0)
    text: str = Field(min_length=1, max_length=2000)


class SemanticSearchRequest(BaseModel):
    query: str = Field(min_length=2, max_length=500)
    candidates: list[SemanticCandidateRequest] = Field(min_length=1, max_length=500)
    limit: int = Field(default=20, ge=1, le=500)
    min_score: float | None = Field(default=None, ge=-1, le=1)


class SemanticSearchHitResponse(BaseModel):
    id: int
    score: float


class SemanticSearchResponse(BaseModel):
    results: list[SemanticSearchHitResponse]


def get_threshold() -> float:
    raw = os.getenv("NLU_CONFIDENCE_THRESHOLD", "0.65")
    try:
        return min(1.0, max(0.0, float(raw)))
    except ValueError:
        return 0.65


def get_semantic_min_score() -> float:
    raw = os.getenv("SEMANTIC_MIN_SCORE", "0.35")
    try:
        return min(1.0, max(-1.0, float(raw)))
    except ValueError:
        return 0.35


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


@app.post("/semantic-search", response_model=SemanticSearchResponse)
def semantic_search(request: SemanticSearchRequest) -> SemanticSearchResponse:
    """Ordena documentos de serviços enviados pela API principal.

    O serviço de NLP não acessa o banco: isso mantém autorização e filtros de
    catálogo sob responsabilidade do back-end Express.
    """
    results = rank_candidates(
        request.query,
        [SemanticCandidate(candidate.id, candidate.text) for candidate in request.candidates],
        limit=request.limit,
        min_score=get_semantic_min_score() if request.min_score is None else request.min_score,
    )
    return SemanticSearchResponse(
        results=[SemanticSearchHitResponse(id=hit.id, score=hit.score) for hit in results]
    )
