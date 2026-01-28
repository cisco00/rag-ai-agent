import sys
import os
sys.path.append(os.path.join(os.getcwd(), 'src'))
from src.models import init_admin_db, SessionLocal, Organization

# Initialize
init_admin_db()
db = SessionLocal()

try:
    orgs = db.query(Organization).all()
    for org in orgs:
        # Check if it looks like the broken postgres one
        if org.db_connection_string and "postgresql" in org.db_connection_string:
            print(f"Reseting org {org.name} (ID: {org.id})")
            print(f"Old: {org.db_connection_string}")
            # Reset to default sqlite
            new_db = f"sqlite:///org_{org.api_key[:8]}.db"
            org.db_connection_string = new_db
            print(f"New: {new_db}")
            
    db.commit()
    print("Database connections reset successfully.")
except Exception as e:
    import traceback
    traceback.print_exc()
finally:
    db.close()
