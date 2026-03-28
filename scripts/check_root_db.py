import sqlite3
import os

db_path = 'admin.db'  # Check root admin.db
if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    try:
        cur.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tables = cur.fetchall()
        print(f"Tables in {db_path}: {tables}")
        
        if ('users',) in tables:
            cur.execute("SELECT id, org_id, email, role FROM users;")
            rows = cur.fetchall()
            print("Users:")
            for row in rows:
                print(row)
        else:
            print("No 'users' table found.")
            
        if ('organizations',) in tables:
            cur.execute("SELECT id, name, api_key FROM organizations;")
            orgs = cur.fetchall()
            print("\nOrganizations:")
            for org in orgs:
                print(org)
    except Exception as e:
        print(f"Error: {e}")
    finally:
        conn.close()
else:
    print(f"DB not found at {db_path}")
