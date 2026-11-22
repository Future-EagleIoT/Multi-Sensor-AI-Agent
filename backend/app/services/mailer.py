import logging
import smtplib
from email.message import EmailMessage

from app.config import get_settings

logger = logging.getLogger(__name__)


def send_email(to_email: str, subject: str, body_text: str, body_html: str | None = None) -> bool:
    settings = get_settings()
    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(body_text)
    if body_html:
        msg.add_alternative(body_html, subtype="html")

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=5) as smtp:
            smtp.send_message(msg)
        return True
    except Exception as exc:
        logger.warning("[Mailer] Failed to send email to %s: %s", to_email, exc)
        return False
