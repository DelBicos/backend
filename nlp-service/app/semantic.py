"""Busca semântica multilíngue para o catálogo de serviços.

O classificador TF-IDF/SVM identifica a intenção do chatbot. Este módulo é
separado porque sua responsabilidade é ordenar documentos pelo significado da
consulta, inclusive quando as palavras usadas pelo cliente não são idênticas
ao título do serviço cadastrado.
"""

from __future__ import annotations

import os
from collections import OrderedDict
from dataclasses import dataclass
from functools import lru_cache
from threading import Lock
from typing import Any, Protocol, Sequence


DEFAULT_MODEL_NAME = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"


def _get_embedding_cache_size() -> int:
    try:
        return min(20_000, max(0, int(os.getenv("SEMANTIC_EMBEDDING_CACHE_SIZE", "5000"))))
    except ValueError:
        return 5000


EMBEDDING_CACHE_SIZE = _get_embedding_cache_size()
_document_embedding_cache: OrderedDict[str, Any] = OrderedDict()
_document_embedding_cache_lock = Lock()


class EmbeddingModel(Protocol):
    """Interface mínima para manter o ranking testável sem carregar o modelo."""

    def encode(self, sentences: Sequence[str], **kwargs: Any) -> Any: ...


@dataclass(frozen=True)
class SemanticCandidate:
    id: int
    text: str


@dataclass(frozen=True)
class SemanticSearchHit:
    id: int
    score: float


def normalize_semantic_text(text: str) -> str:
    """Remove apenas espaços excedentes; os acentos são úteis aos embeddings."""
    return " ".join(text.split())


@lru_cache(maxsize=1)
def get_embedding_model() -> EmbeddingModel:
    """Carrega o modelo uma única vez, somente quando há uma consulta semântica."""
    from sentence_transformers import SentenceTransformer

    model_name = os.getenv("SEMANTIC_MODEL_NAME", DEFAULT_MODEL_NAME)
    return SentenceTransformer(model_name)


def _dot_product(left: Sequence[float], right: Sequence[float]) -> float:
    return float(sum(float(a) * float(b) for a, b in zip(left, right)))


def _encode(embedder: EmbeddingModel, sentences: Sequence[str]) -> list[Any]:
    return list(
        embedder.encode(
            sentences,
            normalize_embeddings=True,
            convert_to_numpy=False,
            show_progress_bar=False,
        )
    )


def _get_cached_document_embeddings(
    embedder: EmbeddingModel,
    documents: Sequence[str],
) -> list[Any]:
    """Codifica apenas documentos novos e mantém cache por texto normalizado.

    A chave é o próprio documento; por isso uma edição de serviço gera outro
    embedding automaticamente, sem exigir comunicação do Express para limpar
    o cache. A primeira busca continua em lote para não degradar o tempo de
    resposta do catálogo inicial.
    """
    if EMBEDDING_CACHE_SIZE == 0:
        return _encode(embedder, documents)

    embeddings_by_document: dict[str, Any] = {}
    missing: list[str] = []
    seen: set[str] = set()
    with _document_embedding_cache_lock:
        for document in documents:
            if document in seen:
                continue
            seen.add(document)
            cached = _document_embedding_cache.get(document)
            if cached is None:
                missing.append(document)
            else:
                _document_embedding_cache.move_to_end(document)
                embeddings_by_document[document] = cached

    if missing:
        encoded_missing = _encode(embedder, missing)
        with _document_embedding_cache_lock:
            for document, embedding in zip(missing, encoded_missing):
                _document_embedding_cache[document] = embedding
                _document_embedding_cache.move_to_end(document)
                embeddings_by_document[document] = embedding
            while len(_document_embedding_cache) > EMBEDDING_CACHE_SIZE:
                _document_embedding_cache.popitem(last=False)

    return [embeddings_by_document[document] for document in documents]


def rank_candidates(
    query: str,
    candidates: Sequence[SemanticCandidate],
    *,
    limit: int = 20,
    min_score: float = 0.35,
    model: EmbeddingModel | None = None,
) -> list[SemanticSearchHit]:
    """Ordena candidatos por similaridade de cosseno dos embeddings normalizados."""
    normalized_query = normalize_semantic_text(query)
    valid_candidates = [
        candidate
        for candidate in candidates
        if candidate.id > 0 and normalize_semantic_text(candidate.text)
    ]
    if not normalized_query or not valid_candidates or limit <= 0:
        return []

    documents = [normalize_semantic_text(candidate.text) for candidate in valid_candidates]
    embedder = model or get_embedding_model()
    query_embedding = _encode(embedder, [normalized_query])[0]
    # Modelos injetados existem apenas nos testes. Evitar cache global nesses
    # casos mantém a execução determinística e não mistura vetores de modelos.
    document_embeddings = (
        _encode(embedder, documents)
        if model is not None
        else _get_cached_document_embeddings(embedder, documents)
    )
    hits = [
        SemanticSearchHit(
            id=candidate.id,
            # Com os vetores normalizados, produto escalar equivale ao cosseno.
            score=round(_dot_product(query_embedding, embedding), 6),
        )
        for candidate, embedding in zip(valid_candidates, document_embeddings)
    ]
    return sorted(
        (hit for hit in hits if hit.score >= min_score),
        key=lambda hit: (-hit.score, hit.id),
    )[:limit]
