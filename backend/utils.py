
import os
import json
from typing import Any


def clean_llm_json_content(content: str) -> str:
    """
    Strip markdown code blocks from LLM JSON response.
    
    Args:
        content: Raw content that may be wrapped in ```json ... ```
    
    Returns:
        Cleaned string ready for json.loads()
    """
    content = content.strip()
    if content.startswith("```json"):
        content = content.replace("```json", "", 1)
    if content.startswith("```"):
        content = content.replace("```", "", 1)
    if content.endswith("```"):
        content = content[:-3]
    return content.strip()


def parse_llm_json(content: str) -> Any:
    """
    Parse JSON from LLM response, handling markdown code blocks.
    
    Args:
        content: Raw content from LLM (may include ```json ... ```)
    
    Returns:
        Parsed Python object (dict, list, etc.)
    """
    return json.loads(clean_llm_json_content(content))


def send_email_mock(to_email, subject, body):
    """
    Mock email sender or real sender if env vars present.
    In real production, use a task queue + SendGrid/SES.
    """
    smtp_host = os.environ.get("SMTP_HOST")
    smtp_port = os.environ.get("SMTP_PORT", 587)
    smtp_user = os.environ.get("SMTP_USER")
    smtp_pass = os.environ.get("SMTP_PASS")
    
    msg_content = f"To: {to_email}\nSubject: {subject}\n\n{body}"
    print("--- EMAIL OUT ---")
    print(msg_content)
    print("-----------------")
    
    # Write to file for verification
    with open("email_out.txt", "a", encoding="utf-8") as f:
        f.write(msg_content + "\n\n")

    if smtp_host and smtp_user and smtp_pass:
        try:
            import smtplib
            from email.mime.text import MIMEText
            msg = MIMEText(body)
            msg['Subject'] = subject
            msg['From'] = smtp_user
            msg['To'] = to_email
            
            with smtplib.SMTP(smtp_host, int(smtp_port)) as server:
                server.starttls()
                server.login(smtp_user, smtp_pass)
                server.send_message(msg)
            print("Email sent successfully.")
        except Exception as e:
            print(f"Failed to send real email: {e}")
