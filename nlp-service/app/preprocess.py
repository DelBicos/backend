"""Pré-processamento reprodutível para mensagens curtas em português."""

from __future__ import annotations

import re
import unicodedata

from nltk.stem.snowball import SnowballStemmer
from nltk.tokenize import wordpunct_tokenize

# Negação e palavras que distinguem ações não devem desaparecer durante a
# normalização. Isso evita aproximar, por exemplo, "quero cancelar" de frases
# afirmativas de agendamento.
PROTECTED_TOKENS = {"nao", "sim", "cancelar", "alterar", "reagendar", "agendar"}
STEMMER = SnowballStemmer("portuguese")


def normalize_text(text: str) -> str:
    """Remove acentos e ruído, preservando letras, números e separação de palavras."""
    normalized = unicodedata.normalize("NFD", text.lower())
    normalized = "".join(
        char for char in normalized if unicodedata.category(char) != "Mn"
    )
    normalized = re.sub(r"[^a-z0-9\s]", " ", normalized)
    return re.sub(r"\s+", " ", normalized).strip()


def tokenize(text: str) -> list[str]:
    """Tokeniza e aplica stemming leve sem requerer download de recursos NLTK."""
    tokens = wordpunct_tokenize(normalize_text(text))
    return [
        token if token in PROTECTED_TOKENS or len(token) <= 2 else STEMMER.stem(token)
        for token in tokens
        if token.strip()
    ]
