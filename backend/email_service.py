"""
email_service.py — Vantage AI SMTP Email Service
─────────────────────────────────────────────────
Replaces send_email_mock with a real SMTP sender + HTML templates.

Required env vars:
    SMTP_HOST       e.g. smtp.gmail.com / smtp.mailgun.org
    SMTP_PORT       default 587 (STARTTLS) — use 465 for SSL
    SMTP_USER       sender address / login
    SMTP_PASS       password or app-specific password
    EMAIL_FROM      display address, defaults to SMTP_USER
    EMAIL_FROM_NAME display name, default "Vantage AI"
    APP_URL         frontend URL for links in emails

Optional:
    SMTP_USE_SSL    set to "true" to use SMTP_SSL instead of STARTTLS
"""

import os
import smtplib
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr
from typing import Optional

logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────

SMTP_HOST     = os.getenv("SMTP_HOST", "")
SMTP_PORT     = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER     = os.getenv("SMTP_USER", "")
SMTP_PASS     = os.getenv("SMTP_PASS", "")
SMTP_USE_SSL  = os.getenv("SMTP_USE_SSL", "false").lower() == "true"
EMAIL_FROM    = os.getenv("EMAIL_FROM", SMTP_USER)
EMAIL_FROM_NAME = os.getenv("EMAIL_FROM_NAME", "Vantage AI")
APP_URL       = os.getenv("APP_URL", "https://your-app.com")

# ── Base HTML template ────────────────────────────────────────────────────────

def _base_html(title: str, body_html: str) -> str:
    return f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>{title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">

        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#2563eb,#4f46e5);padding:32px 40px;">
          <h1 style="margin:0;color:#fff;font-size:24px;font-weight:700;letter-spacing:-.5px;">
            &#9698; Vantage AI
          </h1>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:40px;">
          {body_html}
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f8fafc;padding:24px 40px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;color:#94a3b8;font-size:12px;text-align:center;">
            &copy; 2026 Vantage AI &middot; You received this because you have an account on
            <a href="{APP_URL}" style="color:#2563eb;text-decoration:none;">{APP_URL}</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>"""


def _btn(text: str, url: str) -> str:
    return f"""<a href="{url}" style="display:inline-block;margin:24px 0 8px;padding:14px 32px;
background:#2563eb;color:#fff;font-weight:600;font-size:15px;border-radius:10px;
text-decoration:none;">{text}</a>"""


def _h2(text: str) -> str:
    return f'<h2 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#0f172a;">{text}</h2>'


def _p(text: str) -> str:
    return f'<p style="margin:0 0 12px;color:#475569;font-size:15px;line-height:1.6;">{text}</p>'


def _box(content: str) -> str:
    return f"""<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;
padding:16px 20px;margin:16px 0;font-family:monospace;font-size:14px;color:#0f172a;
word-break:break-all;">{content}</div>"""


# ── Core sender ───────────────────────────────────────────────────────────────

def send_email(
    to_email:   str,
    subject:    str,
    html_body:  str,
    text_body:  Optional[str] = None,
) -> bool:
    """
    Send an email via SMTP.
    Falls back to console logging if SMTP_HOST is not configured.
    Returns True on success, False on failure.
    """
    if not SMTP_HOST or not SMTP_USER or not SMTP_PASS:
        logger.warning(
            f"[Email] SMTP not configured — printing to console.\n"
            f"  To: {to_email}\n  Subject: {subject}"
        )
        print(f"\n{'='*60}\nEMAIL (not sent — SMTP not configured)\n"
              f"To: {to_email}\nSubject: {subject}\n{'='*60}\n")
        return False

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"]    = formataddr((EMAIL_FROM_NAME, EMAIL_FROM))
        msg["To"]      = to_email

        if text_body:
            msg.attach(MIMEText(text_body, "plain", "utf-8"))
        msg.attach(MIMEText(html_body, "html", "utf-8"))

        if SMTP_USE_SSL:
            with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT) as server:
                server.login(SMTP_USER, SMTP_PASS)
                server.send_message(msg)
        else:
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
                server.ehlo()
                server.starttls()
                server.login(SMTP_USER, SMTP_PASS)
                server.send_message(msg)

        logger.info(f"[Email] Sent '{subject}' → {to_email}")
        return True

    except Exception as exc:
        logger.error(f"[Email] Failed to send '{subject}' → {to_email}: {exc}", exc_info=True)
        return False


# ── Backwards-compatible drop-in for send_email_mock ─────────────────────────

def send_email_mock(to_email: str, subject: str, body: str) -> bool:
    """
    Drop-in replacement for the old send_email_mock.
    Sends a plain-text email via SMTP if configured, otherwise logs.
    """
    html = _base_html(subject, _p(body.replace("\n", "<br>")))
    return send_email(to_email, subject, html, text_body=body)


# ── Typed template senders ────────────────────────────────────────────────────

def send_welcome_email(to_email: str, org_name: str, api_key: str) -> bool:
    """Sent after an org is registered."""
    html = _base_html("Welcome to Vantage AI", f"""
        {_h2("Welcome to Vantage AI! 🎉")}
        {_p(f"Your organisation <strong>{org_name}</strong> is ready. Here's your API key — save it somewhere safe.")}
        {_box(api_key)}
        {_p("You'll need this key to configure integrations and for API access.")}
        {_btn("Go to Dashboard", APP_URL)}
        {_p('<span style="color:#94a3b8;font-size:13px;">Never share your API key publicly.</span>')}
    """)
    text = (
        f"Welcome to Vantage AI!\n\n"
        f"Your organisation '{org_name}' is ready.\n\n"
        f"API Key: {api_key}\n\n"
        f"Dashboard: {APP_URL}\n\n"
        f"Never share your API key publicly."
    )
    return send_email(to_email, f"Welcome to Vantage AI — {org_name}", html, text)


def send_invite_email(
    to_email:   str,
    org_name:   str,
    role:       str,
    invite_url: str,
    invited_by: Optional[str] = None,
) -> bool:
    """Sent when a user is invited to an org."""
    role_label = role.replace("_", " ").title()
    inviter    = f"<strong>{invited_by}</strong>" if invited_by else "your team admin"
    footer_text = '<span style="color:#94a3b8;font-size:13px;">This link expires in 7 days. If you didn\'t expect this, you can safely ignore it.</span>'
    html = _base_html(f"You're invited to {org_name}", f"""
        {_h2(f"You've been invited to {org_name}")}
        {_p(f"You've been invited by {inviter} to join <strong>{org_name}</strong> on Vantage AI as a <strong>{role_label}</strong>.")}
        {_btn("Accept Invitation", invite_url)}
        {_p(footer_text)}
    """)
    text = (
        f"You've been invited to {org_name} on Vantage AI.\n\n"
        f"Role: {role_label}\n\n"
        f"Accept your invitation:\n{invite_url}\n\n"
        f"This link expires in 7 days."
    )
    return send_email(to_email, f"You're invited to {org_name} on Vantage AI", html, text)


def send_password_reset_email(to_email: str, reset_url: str) -> bool:
    """Sent when a password reset is requested."""
    footer_text = '<span style="color:#94a3b8;font-size:13px;">This link expires in 1 hour. If you didn\'t request a password reset, you can safely ignore this email — your password won\'t change.</span>'
    html = _base_html("Reset your password", f"""
        {_h2("Reset your password")}
        {_p("We received a request to reset your Vantage AI password. Click the button below to choose a new one.")}
        {_btn("Reset Password", reset_url)}
        {_p(footer_text)}
    """)
    text = (
        f"Reset your Vantage AI password:\n{reset_url}\n\n"
        f"This link expires in 1 hour.\n"
        f"If you didn't request this, ignore this email."
    )
    return send_email(to_email, "Reset your Vantage AI password", html, text)


def send_alert_email(
    to_email:    str,
    rule_name:   str,
    metric:      str,
    current_val: float,
    threshold:   float,
    operator:    str,
    table_name:  str,
) -> bool:
    """Sent when an alert rule fires."""
    direction = "above" if operator in (">", ">=") else "below"
    html = _base_html(f"Alert: {rule_name}", f"""
        {_h2(f"⚠️ Alert: {rule_name}")}
        {_p(f"A threshold alert has been triggered for <strong>{metric}</strong> in <strong>{table_name}</strong>.")}
        <table style="width:100%;border-collapse:collapse;margin:20px 0;">
          <tr style="background:#fef3c7;">
            <td style="padding:12px 16px;border:1px solid #fde68a;border-radius:8px 0 0 8px;color:#92400e;font-weight:600;">Current value</td>
            <td style="padding:12px 16px;border:1px solid #fde68a;color:#92400e;font-size:18px;font-weight:700;">{current_val:,.2f}</td>
          </tr>
          <tr>
            <td style="padding:12px 16px;border:1px solid #e2e8f0;color:#64748b;">Threshold</td>
            <td style="padding:12px 16px;border:1px solid #e2e8f0;color:#0f172a;">{operator} {threshold:,.2f}</td>
          </tr>
        </table>
        {_btn("View Dashboard", APP_URL)}
    """)
    text = (
        f"Alert fired: {rule_name}\n\n"
        f"Metric: {metric} ({table_name})\n"
        f"Current value: {current_val:,.2f}\n"
        f"Threshold: {operator} {threshold:,.2f}\n\n"
        f"Dashboard: {APP_URL}"
    )
    return send_email(to_email, f"🚨 Alert: {rule_name}", html, text)


def send_scheduled_report_email(
    to_email:   str,
    query:      str,
    analysis:   str,
    frequency:  str,
) -> bool:
    """Sent for automated scheduled reports."""
    freq_label = frequency.title()
    # Convert newlines in analysis to <br> for HTML
    analysis_html = analysis.replace("\n", "<br>")
    footer_text = '<span style="color:#94a3b8;font-size:13px;">You\'re receiving this because you have a scheduled report set up. Manage your reports in the dashboard.</span>'
    html = _base_html(f"{freq_label} Report", f"""
        {_h2(f"📊 Your {freq_label} Report")}
        {_p(f'<strong>Query:</strong> {query}')}
        <div style="background:#f8fafc;border-left:4px solid #2563eb;padding:20px 24px;
            border-radius:0 10px 10px 0;margin:20px 0;color:#334155;font-size:14px;
            line-height:1.7;">{analysis_html}</div>
        {_btn("View Full Dashboard", APP_URL)}
        {_p(footer_text)}
    """)
    text = (
        f"{freq_label} Report\n\n"
        f"Query: {query}\n\n"
        f"{analysis}\n\n"
        f"Dashboard: {APP_URL}"
    )
    return send_email(to_email, f"📊 {freq_label} Report — Vantage AI", html, text)
