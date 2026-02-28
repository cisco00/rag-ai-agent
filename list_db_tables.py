
import sqlite3
import os

db_files = [
    "src/admin.db",
    "admin.db",
    "identifier.sqlite.db",
    "org_KOxsr8Xu.db"
]

for db_file in db_files:
    if os.path.exists(db_file):
        print(f"\n--- Tables in {db_file} ---")
        try:
            conn = sqlite3.connect(db_file)
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
            tables = cursor.fetchall()
            for table in tables:
                print(table[0])
            conn.close()
        except Exception as e:
            print(f"Error reading {db_file}: {e}")
    else:
        print(f"\n{db_file} does not exist.")
