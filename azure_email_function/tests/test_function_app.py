import json
from unittest.mock import patch

from function_app import app, send_email_http


class FakeRequest:
    def __init__(self, payload=None, invalid_json=False):
        self.payload = payload
        self.invalid_json = invalid_json

    def get_json(self):
        if self.invalid_json:
            raise ValueError("invalid json")
        return self.payload


def response_json(response):
    return json.loads(response.get_body().decode("utf-8"))


def test_returns_400_for_invalid_json():
    response = send_email_http(FakeRequest(invalid_json=True))

    assert response.status_code == 400
    assert response_json(response) == {"ok": False, "error": "JSON inválido"}


@patch("function_app.send_email")
@patch("function_app.load_configuration")
def test_sends_valid_payload(load_configuration, send_email):
    configuration = load_configuration.return_value
    configuration.default_subject = "Assunto padrão"
    configuration.max_body_bytes = 262_144
    response = send_email_http(
        FakeRequest(
            {
                "to": "destinatario@example.test",
                "subject": "Assunto",
                "body": "<p>Mensagem</p>",
            }
        )
    )

    assert response.status_code == 200
    assert response_json(response) == {"ok": True}
    send_email.assert_called_once()


@patch("function_app.send_email", side_effect=RuntimeError("SMTP offline"))
@patch("function_app.load_configuration")
def test_does_not_expose_smtp_error(load_configuration, _send_email):
    configuration = load_configuration.return_value
    configuration.default_subject = "Assunto padrão"
    configuration.max_body_bytes = 262_144
    response = send_email_http(
        FakeRequest(
            {
                "to": "destinatario@example.test",
                "subject": "Assunto",
                "body": "Mensagem",
            }
        )
    )

    assert response.status_code == 502
    assert response_json(response) == {"ok": False, "error": "Falha ao enviar e-mail"}


def test_binding_requires_function_key_and_post():
    function = app.get_functions()[0]
    binding = json.loads(function.get_function_json())["bindings"][0]
    assert binding["authLevel"].lower() == "function"
    assert binding["methods"] == ["POST"]
    assert binding["route"] == "send-email"


def test_rejects_non_object():
    response = send_email_http(FakeRequest(payload=["invalid"]))
    assert response.status_code == 400


@patch("function_app.send_email", side_effect=RuntimeError("secret-password user@example.test"))
@patch("function_app.load_configuration")
def test_logs_do_not_expose_smtp_exception(load_configuration, _send_email, caplog):
    load_configuration.return_value.max_body_bytes = 262_144
    send_email_http(FakeRequest({"to": "user@example.test", "subject": "Teste", "body": "Mensagem"}))
    assert "RuntimeError" in caplog.text
    assert "secret-password" not in caplog.text
    assert "user@example.test" not in caplog.text
