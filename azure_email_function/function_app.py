import json
import logging
from collections.abc import Mapping

import azure.functions as func

from email_sender import (
    EmailConfigurationError,
    EmailValidationError,
    load_configuration,
    normalize_payload,
    send_email,
)


app = func.FunctionApp(http_auth_level=func.AuthLevel.FUNCTION)


def _json_response(payload: dict[str, object], status_code: int) -> func.HttpResponse:
    return func.HttpResponse(
        json.dumps(payload, ensure_ascii=False),
        status_code=status_code,
        mimetype="application/json",
        charset="utf-8",
    )


@app.function_name(name="send_email")
@app.route(route="send-email", methods=["POST"])
def send_email_http(req: func.HttpRequest) -> func.HttpResponse:
    try:
        raw_payload = req.get_json()
    except ValueError:
        return _json_response({"ok": False, "error": "JSON inválido"}, 400)

    if not isinstance(raw_payload, Mapping):
        return _json_response(
            {"ok": False, "error": "O corpo deve ser um objeto JSON"}, 400
        )

    try:
        configuration = load_configuration()
        payload = normalize_payload(raw_payload, configuration)
        send_email(payload, configuration)
        logging.info("E-mail enviado com sucesso pela Azure Function")
        return _json_response({"ok": True}, 200)
    except EmailValidationError as error:
        return _json_response({"ok": False, "error": str(error)}, 400)
    except EmailConfigurationError as error:
        logging.error("Configuração inválida da função de e-mail: %s", error)
        return _json_response(
            {"ok": False, "error": "Serviço de e-mail não configurado"}, 500
        )
    except Exception as error:
        # SMTPRecipientsRefused e outras exceções podem conter o destinatário.
        logging.error("Falha SMTP (%s)", type(error).__name__)
        return _json_response(
            {"ok": False, "error": "Falha ao enviar e-mail"}, 502
        )
