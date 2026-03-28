import sqlite3
import os

db_path = 'admin.db'
if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    try:
        cur.execute("SELECT password_hash FROM users WHERE email='otium@yahoo.com'")
        row = cur.fetchone()
        if row:
            print(f"Hash for otium@yahoo.com: {row[0]}")
        else:
            print("User not found.")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        conn.close()
else:
    print(f"DB not found at {db_path}")
