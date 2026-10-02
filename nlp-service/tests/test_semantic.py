import app.semantic as semantic
from app.semantic import SemanticCandidate, rank_candidates


class FakeEmbeddingModel:
    """Representa relações semânticas sem baixar o modelo nos testes unitários."""

    def encode(self, sentences, **_kwargs):
        vectors = {
            "preciso aparar meu cabelo": [1.0, 0.0, 0.0],
            "corte de cabelo masculino barbearia beleza": [0.96, 0.04, 0.0],
            "limpeza residencial faxina casa": [0.0, 1.0, 0.0],
            "pintura de parede residencial": [0.0, 0.0, 1.0],
        }
        return [vectors[sentence] for sentence in sentences]


class CountingEmbeddingModel:
    def __init__(self):
        self.calls = 0

    def encode(self, sentences, **_kwargs):
        self.calls += 1
        return [[float(index), 1.0] for index, _sentence in enumerate(sentences)]


def test_rank_candidates_returns_semantically_relevant_service_first() -> None:
    hits = rank_candidates(
        "preciso aparar meu cabelo",
        [
            SemanticCandidate(1, "corte de cabelo masculino barbearia beleza"),
            SemanticCandidate(2, "limpeza residencial faxina casa"),
            SemanticCandidate(3, "pintura de parede residencial"),
        ],
        min_score=0.35,
        model=FakeEmbeddingModel(),
    )

    assert [(hit.id, hit.score) for hit in hits] == [(1, 0.96)]


def test_rank_candidates_omits_results_below_relevance_threshold() -> None:
    hits = rank_candidates(
        "preciso aparar meu cabelo",
        [SemanticCandidate(2, "limpeza residencial faxina casa")],
        min_score=0.35,
        model=FakeEmbeddingModel(),
    )

    assert hits == []


def test_document_embeddings_are_reused_between_catalog_searches() -> None:
    model = CountingEmbeddingModel()
    original_size = semantic.EMBEDDING_CACHE_SIZE
    semantic._document_embedding_cache.clear()
    semantic.EMBEDDING_CACHE_SIZE = 10
    try:
        semantic._get_cached_document_embeddings(model, ["montagem de móveis"])
        semantic._get_cached_document_embeddings(model, ["montagem de móveis"])
    finally:
        semantic._document_embedding_cache.clear()
        semantic.EMBEDDING_CACHE_SIZE = original_size

    assert model.calls == 1
