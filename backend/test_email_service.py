
import os
import sys
import logging
from dotenv import load_dotenv

# Add the current directory to sys.path so we can import email_service
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Load environment variables
load_dotenv()

from email_service import send_email_mock, SMTP_HOST, SMTP_USER

def test_delivery():
    logging.basicConfig(level=logging.INFO)
    target = "idokofrancis66@gmail.com"
    subject = "Vantage AI — Email Service Verification"
    body = "Hello! This is a test email from Vantage AI to confirm that your SMTP service is correctly configured and working."
    
    print(f"Attempting to send test email...")
    print(f"SMTP Host: {SMTP_HOST}")
    print(f"SMTP User: {SMTP_USER}")
    print(f"Target: {target}")
    
    success = send_email_mock(target, subject, body)
    
    if success:
        print("\nSUCCESS: Email was accepted by the SMTP server.")
    else:
        print("\nFAILURE: Check the logs above for details.")

if __name__ == "__main__":
    test_delivery()
