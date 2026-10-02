from app.preprocess import normalize_text, tokenize


def test_normalize_text_removes_accents_and_noise() -> None:
    assert normalize_text("Quero AGENDAR, amanhã!") == "quero agendar amanha"


def test_tokenize_preserves_action_words() -> None:
    assert "agendar" in tokenize("Gostaria de agendar uma limpeza")


def test_normalize_text_removes_url_mention_emoji_and_extra_spaces() -> None:
    raw = "  Olá, @Janaina! 😊 Veja https://exemplo.com/aula?q=1   agora.  "

    assert normalize_text(raw) == "ola veja agora"


def test_normalize_text_removes_www_url_and_underscored_mention() -> None:
    raw = "Fale com @suporte_delbicos ou acesse www.delbicos.com.br/chat."

    assert normalize_text(raw) == "fale com ou acesse"


def test_tokenize_does_not_keep_url_or_mention_terms() -> None:
    tokens = tokenize("Agendar @Profissional pelo link https://delbicos.com/perfil 😊")
    joined_tokens = " ".join(tokens)

    assert "agendar" in tokens
    assert all(fragment not in joined_tokens for fragment in ("prof", "http", "delbic", "perfil"))
