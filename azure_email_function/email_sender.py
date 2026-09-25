import os
import re
import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from html.parser import HTMLParser
from typing import Any, Mapping


EMAIL_PATTERN = re.compile(r"^[^\s@,;:<>\x00-\x1f\x7f]+@[^\s@,;:<>\x00-\x1f\x7f]+\.[^\s@,;:<>\x00-\x1f\x7f]+$")


class EmailValidationError(ValueError):
    pass


class EmailConfigurationError(RuntimeError):
    pass


class _PlainTextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)

    def text(self) -> str:
        return " ".join(" ".join(self.parts).split())


@dataclass(frozen=True)
class EmailConfiguration:
    smtp_host: str
    smtp_port: int
    smtp_user: str | None
    smtp_password: str | None
    from_email: str
    default_subject: str
    use_tls: bool
    use_ssl: bool
    timeout_seconds: float
    max_body_bytes: int


@dataclass(frozen=True)
class EmailPayload:
    to: str
    subject: str
    body: str


def _read_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default

    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise EmailConfigurationError(f"{name} deve ser true ou false")


def _read_int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw_value = os.environ.get(name, str(default))
    try:
        value = int(raw_value)
    except ValueError as exc:
        raise EmailConfigurationError(f"{name} deve ser um número inteiro") from exc

    if value < minimum or value > maximum:
        raise EmailConfigurationError(
            f"{name} deve estar entre {minimum} e {maximum}"
        )
    return value


def load_configuration() -> EmailConfiguration:
    smtp_host = os.environ.get("SMTP_HOST", "").strip()
    smtp_user = os.environ.get("SMTP_USER", "").strip() or None
    smtp_password = os.environ.get("SMTP_PASS") or None
    from_email = os.environ.get("FROM_EMAIL", "").strip() or smtp_user or ""
    smtp_port = _read_int("SMTP_PORT", 587, 1, 65535)
    use_ssl = _read_bool("SMTP_USE_SSL", smtp_port == 465)
    use_tls = _read_bool("SMTP_USE_TLS", not use_ssl)

    if not smtp_host:
        raise EmailConfigurationError("SMTP_HOST não configurado")
    if not from_email:
        raise EmailConfigurationError("FROM_EMAIL não configurado")
    if (
        "\r" in from_email
        or "\n" in from_email
        or not EMAIL_PATTERN.fullmatch(from_email)
    ):
        raise EmailConfigurationError("FROM_EMAIL inválido")
    if bool(smtp_user) != bool(smtp_password):
        raise EmailConfigurationError(
            "SMTP_USER e SMTP_PASS devem ser configurados em conjunto"
        )
    if use_ssl and use_tls:
        raise EmailConfigurationError(
            "SMTP_USE_SSL e SMTP_USE_TLS não podem estar ativos ao mesmo tempo"
        )
    if smtp_user and not (use_ssl or use_tls):
        raise EmailConfigurationError("Autenticação SMTP exige TLS ou SSL")

    return EmailConfiguration(
        smtp_host=smtp_host,
        smtp_port=smtp_port,
        smtp_user=smtp_user,
        smtp_password=smtp_password,
        from_email=from_email,
        default_subject=os.environ.get("DEFAULT_SUBJECT", "Mensagem DelBicos").strip()
        or "Mensagem DelBicos",
        use_tls=use_tls,
        use_ssl=use_ssl,
        timeout_seconds=float(
            _read_int("SMTP_TIMEOUT_SECONDS", 15, minimum=1, maximum=120)
        ),
        max_body_bytes=_read_int(
            "MAX_EMAIL_BODY_BYTES", 262_144, minimum=1_024, maximum=1_048_576
        ),
    )


def normalize_payload(
    raw_payload: Mapping[str, Any], configuration: EmailConfiguration
) -> EmailPayload:
    to_address = raw_payload.get("to")
    subject = raw_payload.get("subject") or configuration.default_subject
    body = raw_payload.get("body")

    if not isinstance(to_address, str) or not to_address.strip():
        raise EmailValidationError('Campo "to" é obrigatório')
    if "\r" in to_address or "\n" in to_address:
        raise EmailValidationError('Campo "to" inválido')
    to_address = to_address.strip()
    if not EMAIL_PATTERN.fullmatch(to_address):
        raise EmailValidationError('Campo "to" deve conter um e-mail válido')

    if not isinstance(subject, str) or not subject.strip():
        raise EmailValidationError('Campo "subject" deve ser texto')
    if "\r" in subject or "\n" in subject:
        raise EmailValidationError('Campo "subject" inválido')
    subject = subject.strip()
    if len(subject) > 255:
        raise EmailValidationError('Campo "subject" excede 255 caracteres')

    if not isinstance(body, str) or not body.strip():
        raise EmailValidationError('Campo "body" é obrigatório')
    if len(body.encode("utf-8")) > configuration.max_body_bytes:
        raise EmailValidationError('Campo "body" excede o tamanho permitido')

    return EmailPayload(to=to_address, subject=subject, body=body)


def _html_to_plain_text(body: str) -> str:
    parser = _PlainTextExtractor()
    parser.feed(body)
    parser.close()
    return parser.text() or body


def send_email(
    payload: EmailPayload, configuration: EmailConfiguration
) -> None:
    message = EmailMessage()
    message["From"] = configuration.from_email
    message["To"] = payload.to
    message["Subject"] = payload.subject
    message.set_content(_html_to_plain_text(payload.body))
    message.add_alternative(payload.body, subtype="html")

    if configuration.use_ssl:
        smtp_client = smtplib.SMTP_SSL(
            configuration.smtp_host,
            configuration.smtp_port,
            timeout=configuration.timeout_seconds,
            context=ssl.create_default_context(),
        )
    else:
        smtp_client = smtplib.SMTP(
            configuration.smtp_host,
            configuration.smtp_port,
            timeout=configuration.timeout_seconds,
        )

    with smtp_client as smtp:
        smtp.ehlo()
        if configuration.use_tls:
            smtp.starttls(context=ssl.create_default_context())
            smtp.ehlo()
        if configuration.smtp_user and configuration.smtp_password:
            smtp.login(configuration.smtp_user, configuration.smtp_password)
        smtp.send_message(message)
