import sys
import os
sys.path.append(os.path.join(os.getcwd(), 'src'))
from src.models import init_admin_db, SessionLocal, Organization

init_admin_db()
db = SessionLocal()

try:
    print("Starting Fix...")
    orgs = db.query(Organization).all()
    for org in orgs:
        print(f"Checking {org.name} ({org.id})... Config: {org.db_connection_string}")
        
        if org.db_connection_string and "postgresql" in org.db_connection_string:
            print(f" -> Found broken Postgres config. Resetting...")
            # Use a fresh string
            new_db = f"sqlite:///org_{org.api_key[:8]}_revised.db"
            org.db_connection_string = new_db
            db.add(org) # Ensure it's marked as modified
            
    db.commit()
    print("Commit executed.")
    
    # Verify
    print("Verifying...")
    db.expire_all() # Clear cache
    orgs = db.query(Organization).all()
    for org in orgs:
        if org.name == "cisco0":
            print(f"Verified cisco0: {org.db_connection_string}")

except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
finally:
    db.close()
