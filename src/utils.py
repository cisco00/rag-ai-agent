
import os

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
    with open("email_out.txt", "a") as f:
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
