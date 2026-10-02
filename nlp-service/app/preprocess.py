"""Pré-processamento reprodutível para mensagens curtas em português."""

from __future__ import annotations

import re
import unicodedata

from nltk.stem.snowball import SnowballStemmer
from nltk.tokenize import wordpunct_tokenize

# URLs e menções sociais são removidas antes da normalização genérica. Apenas
# apagar seus símbolos manteria termos irrelevantes como "https", "com" e o
# nome mencionado no vocabulário TF-IDF.
URL_PATTERN = re.compile(r"\b(?:https?://|www\.)[^\s]+", re.IGNORECASE)
MENTION_PATTERN = re.compile(r"(?<![\w@])@[\w.]+", re.UNICODE)

# Negação e palavras que distinguem ações não devem desaparecer durante a
# normalização. Isso evita aproximar, por exemplo, "quero cancelar" de frases
# afirmativas de agendamento.
PROTECTED_TOKENS = {"nao", "sim", "cancelar", "alterar", "reagendar", "agendar"}
STEMMER = SnowballStemmer("portuguese")


def normalize_text(text: str) -> str:
    """Remove URLs, menções, acentos e ruído, preservando letras e números."""
    without_urls = URL_PATTERN.sub(" ", text)
    without_mentions = MENTION_PATTERN.sub(" ", without_urls)
    normalized = unicodedata.normalize("NFD", without_mentions.lower())
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
