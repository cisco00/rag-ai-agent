import os
import json
import logging
from typing import Any
from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)

# Import config lazily or internally to avoid circular imports? No, utils is typically imported at bottom of dependency tree.
# We'll import get_security_config inside the functions to be perfectly safe from circular imports during init.

def encrypt_string(text: str) -> str:
    """Encrypt a string using the application's security key."""
    if not text:
        return text
    from config import get_security_config
    key = get_security_config().encryption_key
    f = Fernet(key.encode('utf-8'))
    return f.encrypt(text.encode('utf-8')).decode('utf-8')

def decrypt_string(encrypted_text: str) -> str:
    """Decrypt a string. Falls back to returning plaintext if not encrypted."""
    if not encrypted_text:
        return encrypted_text
        
    # Fernet tokens start with gAAAAA...
    if not encrypted_text.startswith('gAAAAA'):
        return encrypted_text
        
    from config import get_security_config
    key = get_security_config().encryption_key
    f = Fernet(key.encode('utf-8'))
    try:
        return f.decrypt(encrypted_text.encode('utf-8')).decode('utf-8')
    except (InvalidToken, ValueError) as e:
        logger.warning(f"Failed to decrypt string, treating as plaintext (error: {e})")
        return encrypted_text


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


def clean_proto_data(data: Any) -> Any:
    """
    Recursively convert Google Proto-types (MapComposite, RepeatedComposite)
    to standard Python dicts and lists to ensure JSON serializability.
    
    Args:
        data: The data to clean (can be dict, list, or proto-type)
    
    Returns:
        Standard Python object (dict, list, str, int, etc.)
    """
    # Handle list-like objects (RepeatedComposite)
    if isinstance(data, (list, tuple)):
        return [clean_proto_data(item) for item in data]
    
    # Handle dict-like objects (MapComposite)
    if isinstance(data, dict):
        return {k: clean_proto_data(v) for k, v in data.items()}
    
    # Try converting to dict if it has a .items() method or is a proto-type
    # MapComposite and other proto objects often behave like dicts or have a _pb or can be cast
    try:
        if hasattr(data, "items") and callable(data.items): # Catches MapComposite
             return {k: clean_proto_data(v) for k, v in data.items()}
        
        # If it's not a basic type and not a dict/list, try to see if it's iterable
        if hasattr(data, "__iter__") and not isinstance(data, (str, bytes)):
            return [clean_proto_data(item) for item in data]
            
    except Exception:
        pass
        
    return data


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