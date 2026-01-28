import sys
import os
sys.path.append(os.path.join(os.getcwd(), 'src'))
from src.models import init_admin_db, SessionLocal, Organization

# Initialize
init_admin_db()
db = SessionLocal()

try:
    print(f"Checking DB at {os.getcwd()}/admin.db")
    orgs = db.query(Organization).all()
    for org in orgs:
        print(f"Org: {org.name}, API Config: {org.db_connection_string}")
except Exception as e:
    print(f"Error: {e}")
finally:
    db.close()
