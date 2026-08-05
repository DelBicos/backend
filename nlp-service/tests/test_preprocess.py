from app.preprocess import normalize_text, tokenize


def test_normalize_text_removes_accents_and_noise() -> None:
    assert normalize_text("Quero AGENDAR, amanhã!") == "quero agendar amanha"


def test_tokenize_preserves_action_words() -> None:
    assert "agendar" in tokenize("Gostaria de agendar uma limpeza")
