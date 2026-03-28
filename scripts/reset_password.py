import sqlite3
import bcrypt

hashed = bcrypt.hashpw('admin123'.encode(), bcrypt.gensalt(rounds=12)).decode()

db_path = 'backend/admin.db'
conn = sqlite3.connect(db_path)
cur = conn.cursor()

try:
    cur.execute("UPDATE users SET password_hash=? WHERE email='otium@yahoo.com'", (hashed,))
    conn.commit()
    print("Reset password for otium@yahoo.com to admin123")
except Exception as e:
    print(f"Error: {e}")
finally:
    conn.close()
