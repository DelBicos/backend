"""API interna para a classificação de intenções."""

from __future__ import annotations

import os
import secrets
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from app.model import classify, load_model
from app.semantic import SemanticCandidate, rank_candidates

app = FastAPI(title="DelBicos Intent Classifier", docs_url=None, redoc_url=None)
artifact: dict[str, Any] | None = None


def require_api_key(x_api_key: str = Header(default="", alias="X-API-Key")) -> None:
    """Exige a chave de API compartilhada com o backend Express.

    Falha fechado: se NLU_SERVICE_API_KEY nao estiver configurada no ambiente,
    toda chamada e recusada -- nunca ha um modo sem autenticacao por engano.
    Usa comparacao em tempo constante para nao vazar a chave por timing.
    """
    expected = os.getenv("NLU_SERVICE_API_KEY", "")
    if not expected or not secrets.compare_digest(x_api_key, expected):
        raise HTTPException(status_code=401, detail="Chave de API ausente ou invalida.")


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
    default_model_path = Path(__file__).resolve().parent.parent / "artifacts" / "intent_classifier.joblib"
    model_path = Path(os.getenv("MODEL_PATH", str(default_model_path)))
    artifact = load_model(model_path)


@app.get("/health")
def health() -> dict[str, str]:
    if artifact is None:
        raise HTTPException(status_code=503, detail="Modelo ainda não foi carregado.")
    return {"status": "ok", "model_version": str(artifact["metadata"]["model_version"])}


@app.post("/classify", response_model=ClassifyResponse, dependencies=[Depends(require_api_key)])
def classify_intent(request: ClassifyRequest) -> ClassifyResponse:
    if artifact is None:
        raise HTTPException(status_code=503, detail="Modelo indisponível.")
    intent, confidence = classify(request.text, artifact, get_threshold())
    return ClassifyResponse(
        intent=intent,
        confidence=round(confidence, 4),
        model_version=str(artifact["metadata"]["model_version"]),
    )


@app.post("/semantic-search", response_model=SemanticSearchResponse, dependencies=[Depends(require_api_key)])
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
