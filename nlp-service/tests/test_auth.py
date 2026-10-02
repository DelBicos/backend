"""Testes da autenticacao por chave de API compartilhada nas rotas do nlp-service."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.main import require_api_key


def test_require_api_key_rejects_quando_variavel_nao_configurada(monkeypatch):
    monkeypatch.delenv("NLU_SERVICE_API_KEY", raising=False)
    with pytest.raises(HTTPException) as exc_info:
        require_api_key(x_api_key="qualquer-coisa")
    assert exc_info.value.status_code == 401


def test_require_api_key_rejects_chave_incorreta(monkeypatch):
    monkeypatch.setenv("NLU_SERVICE_API_KEY", "segredo-correto")
    with pytest.raises(HTTPException) as exc_info:
        require_api_key(x_api_key="chave-errada")
    assert exc_info.value.status_code == 401


def test_require_api_key_rejects_header_ausente(monkeypatch):
    monkeypatch.setenv("NLU_SERVICE_API_KEY", "segredo-correto")
    with pytest.raises(HTTPException):
        require_api_key(x_api_key="")


def test_require_api_key_aceita_chave_correta(monkeypatch):
    monkeypatch.setenv("NLU_SERVICE_API_KEY", "segredo-correto")
    require_api_key(x_api_key="segredo-correto")
