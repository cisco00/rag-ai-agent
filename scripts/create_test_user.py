import sqlite3
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

db_path = 'backend/admin.db'
conn = sqlite3.connect(db_path)
cur = conn.cursor()

email = 'test@example.com'
password = 'password123'
hashed = pwd_context.hash(password)

try:
    cur.execute("INSERT INTO users (org_id, email, password_hash, role, display_name) VALUES (1, ?, ?, 'admin', 'Test User')", (email, hashed))
    conn.commit()
    print(f"Created test user: {email} / {password}")
except Exception as e:
    print(f"Error: {e}")
finally:
    conn.close()
