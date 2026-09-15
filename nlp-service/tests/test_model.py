from app.model import classify


class FakePipeline:
    classes_ = ["AGENDAR", "FALLBACK"]

    def predict(self, _texts):
        return ["AGENDAR"]

    def decision_function(self, _texts):
        return [[1.0, -1.0]]


def test_classify_returns_best_intent_above_threshold() -> None:
    intent, confidence = classify("quero marcar uma pintura", {"pipeline": FakePipeline()}, 0.65)
    assert intent == "AGENDAR"
    assert confidence > 0.8


def test_classify_returns_fallback_below_threshold() -> None:
    intent, _confidence = classify("texto inesperado", {"pipeline": FakePipeline()}, 0.9)
    assert intent == "FALLBACK"
