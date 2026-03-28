import sqlite3
import bcrypt
import os

db_path = 'c:/Users/DELL/AI-Model/rag-ai-agent/backend/admin.db'

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()

new_password = "Vantage2026!"
new_hash = hash_password(new_password)

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

try:
    cursor.execute("UPDATE users SET password_hash = ? WHERE email = ?", (new_hash, "otium@yahoo.com"))
    conn.commit()
    print(f"Password for otium@yahoo.com reset to {new_password}")
except Exception as e:
    print(f"Error: {e}")
finally:
    conn.close()
