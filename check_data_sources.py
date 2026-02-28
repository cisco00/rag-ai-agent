
import sqlite3
import os

db_file = "src/admin.db"
if os.path.exists(db_file):
    print(f"\n--- Data in {db_file} (data_sources) ---")
    try:
        conn = sqlite3.connect(db_file)
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM data_sources;")
        rows = cursor.fetchall()
        for row in rows:
            print(row)
        conn.close()
    except Exception as e:
        print(f"Error reading {db_file}: {e}")
