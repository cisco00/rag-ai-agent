import sqlite3
import os

db_path = "org_dY49ugI1.db"
if not os.path.exists(db_path):
    print("DB not found in host, assuming it's in container")
else:
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    c.execute('INSERT INTO token_limit_test (id, bio) VALUES (999, ?)', ('B'*100000,))
    conn.commit()
    conn.close()
    print("Done")
