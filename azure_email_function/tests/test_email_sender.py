from unittest.mock import MagicMock, patch

import pytest

from email_sender import (
    EmailConfigurationError,
    EmailValidationError,
    load_configuration,
    normalize_payload,
    send_email,
)


SMTP_ENVIRONMENT_VARIABLES = (
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASS",
    "FROM_EMAIL",
    "DEFAULT_SUBJECT",
    "SMTP_USE_TLS",
    "SMTP_USE_SSL",
    "SMTP_TIMEOUT_SECONDS",
    "MAX_EMAIL_BODY_BYTES",
)


@pytest.fixture(autouse=True)
def clean_smtp_environment(monkeypatch):
    for variable in SMTP_ENVIRONMENT_VARIABLES:
        monkeypatch.delenv(variable, raising=False)


def configured_environment(monkeypatch):
    monkeypatch.setenv("SMTP_HOST", "smtp.example.test")
    monkeypatch.setenv("SMTP_PORT", "587")
    monkeypatch.setenv("SMTP_USER", "mailer@example.test")
    monkeypatch.setenv("SMTP_PASS", "secret")
    monkeypatch.setenv("FROM_EMAIL", "no-reply@example.test")


def test_load_configuration_requires_smtp_host():
    with pytest.raises(EmailConfigurationError, match="SMTP_HOST"):
        load_configuration()


def test_normalize_payload_uses_default_subject(monkeypatch):
    configured_environment(monkeypatch)
    monkeypatch.setenv("DEFAULT_SUBJECT", "Assunto padrão")
    configuration = load_configuration()

    payload = normalize_payload(
        {"to": "destinatario@example.test", "body": "<p>Olá</p>"},
        configuration,
    )

    assert payload.subject == "Assunto padrão"
    assert payload.to == "destinatario@example.test"


@pytest.mark.parametrize(
    "raw_payload,error_message",
    [
        ({"body": "Mensagem"}, 'Campo "to" é obrigatório'),
        (
            {"to": "email-invalido", "body": "Mensagem"},
            'Campo "to" deve conter um e-mail válido',
        ),
        (
            {"to": "destinatario@example.test", "body": ""},
            'Campo "body" é obrigatório',
        ),
        (
            {
                "to": "destinatario@example.test",
                "subject": "Assunto\r\nBcc: atacante@example.test",
                "body": "Mensagem",
            },
            'Campo "subject" inválido',
        ),
    ],
)
def test_normalize_payload_rejects_invalid_input(
    monkeypatch, raw_payload, error_message
):
    configured_environment(monkeypatch)
    configuration = load_configuration()

    with pytest.raises(EmailValidationError, match=error_message):
        normalize_payload(raw_payload, configuration)


@patch("email_sender.smtplib.SMTP")
def test_send_email_uses_starttls_and_authentication(smtp_class, monkeypatch):
    configured_environment(monkeypatch)
    configuration = load_configuration()
    payload = normalize_payload(
        {
            "to": "destinatario@example.test",
            "subject": "Assunto",
            "body": "<p>Mensagem <strong>HTML</strong></p>",
        },
        configuration,
    )
    smtp = MagicMock()
    smtp_class.return_value.__enter__.return_value = smtp

    send_email(payload, configuration)

    smtp_class.assert_called_once_with("smtp.example.test", 587, timeout=15.0)
    smtp.starttls.assert_called_once()
    smtp.login.assert_called_once_with("mailer@example.test", "secret")
    smtp.send_message.assert_called_once()


def test_configuration_rejects_partial_credentials(monkeypatch):
    monkeypatch.setenv("SMTP_HOST", "smtp.example.test")
    monkeypatch.setenv("FROM_EMAIL", "no-reply@example.test")
    monkeypatch.setenv("SMTP_USER", "mailer@example.test")

    with pytest.raises(EmailConfigurationError, match="em conjunto"):
        load_configuration()


def test_body_limit_counts_utf8_bytes(monkeypatch):
    configured_environment(monkeypatch)
    monkeypatch.setenv("MAX_EMAIL_BODY_BYTES", "1024")
    with pytest.raises(EmailValidationError, match="tamanho"):
        normalize_payload({"to": "user@example.test", "body": "á" * 513}, load_configuration())


@patch("email_sender.smtplib.SMTP_SSL")
def test_implicit_tls_and_password_preserved(smtp_class, monkeypatch):
    configured_environment(monkeypatch)
    monkeypatch.setenv("SMTP_PORT", "465")
    monkeypatch.setenv("SMTP_PASS", " password with spaces ")
    configuration = load_configuration()
    payload = normalize_payload({"to": "user@example.test", "body": "<p>Olá</p>"}, configuration)
    smtp = smtp_class.return_value.__enter__.return_value
    send_email(payload, configuration)
    smtp.starttls.assert_not_called()
    smtp.login.assert_called_once_with("mailer@example.test", " password with spaces ")
    message = smtp.send_message.call_args.args[0]
    assert message.get_body(preferencelist=("html",)).get_content().strip() == "<p>Olá</p>"
    assert message.get_body(preferencelist=("plain",)).get_content().strip() == "Olá"


def test_cannot_authenticate_over_plaintext(monkeypatch):
    configured_environment(monkeypatch)
    monkeypatch.setenv("SMTP_USE_TLS", "false")
    with pytest.raises(EmailConfigurationError, match="TLS"):
        load_configuration()
