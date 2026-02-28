import sqlite3
import os

def search_db(db_path, search_term):
    if not os.path.exists(db_path):
        return
    print(f"Searching {db_path} for '{search_term}'...")
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = [t[0] for t in cursor.fetchall()]
        for table in tables:
            try:
                cursor.execute(f"SELECT * FROM {table}")
                rows = cursor.fetchall()
                for row in rows:
                    if any(search_term.lower() in str(cell).lower() for cell in row):
                        print(f"MATCH in {db_path} table {table}: {row}")
            except Exception as e:
                pass
        conn.close()
    except Exception as e:
        print(f"Error searching {db_path}: {e}")

search_terms = ["website", "sales", "traffic", "metric", "inventory"]
dbs = ["admin.db", "org_KOxsr8Xu.db", "identifier.sqlite.db"]

for db in dbs:
    for term in search_terms:
        search_db(db, term)
