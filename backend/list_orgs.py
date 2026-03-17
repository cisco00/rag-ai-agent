import sqlite3
import os

db_path = "c:\\Users\\DELL\\AI-Model\\rag-ai-agent\\backend\\admin.db"
if not os.path.exists(db_path):
    print(f"DB not found at {db_path}")
    exit(1)

conn = sqlite3.connect(db_path)
cursor = conn.cursor()
cursor.execute("SELECT name, api_key, db_connection_string FROM organizations")
rows = cursor.fetchall()
for row in rows:
    print(f"Org: {row[0]}, API Key: {row[1]}, DB: {row[2]}")
conn.close()
