import sqlite3
import os

db_path = "admin.db"
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
orgs = conn.execute('SELECT name, api_key, db_connection_string FROM organizations').fetchall()
for org in orgs:
    print(dict(org))
conn.close()
