import sqlite3
import os

db_path = 'admin.db'
if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    try:
        cur.execute("SELECT id, org_id, email, role FROM users;")
        rows = cur.fetchall()
        print("Users in admin.db:")
        for row in rows:
            print(row)
        
        cur.execute("SELECT id, name, api_key FROM organizations;")
        orgs = cur.fetchall()
        print("\nOrganizations in admin.db:")
        for org in orgs:
            print(org)
    except Exception as e:
        print(f"Error: {e}")
    finally:
        conn.close()
else:
    print(f"DB not found at {db_path}")
