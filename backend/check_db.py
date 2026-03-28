import sqlite3
import os

db_path = 'c:/Users/DELL/AI-Model/rag-ai-agent/backend/admin.db'

if not os.path.exists(db_path):
    print(f"Database not found at {db_path}")
    exit(1)

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

try:
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = cursor.fetchall()
    print(f"Tables: {tables}")

    for table in tables:
        table_name = table[0]
        print(f"\nContent of table {table_name}:")
        cursor.execute(f"SELECT * FROM {table_name}")
        rows = cursor.fetchall()
        for row in rows:
            print(row)
except Exception as e:
    print(f"Error: {e}")
finally:
    conn.close()
