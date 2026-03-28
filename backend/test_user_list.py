import os
import sys

# Ensure the backend directory is in the path
sys.path.append(os.getcwd())

from auth import get_invite_statuses
from models import get_db, Organization

try:
    with get_db() as db:
        org = db.query(Organization).first()
        if not org:
            print("No organization found in database.")
            sys.exit(1)
            
        print(f"Testing for Organization: {org.name} (ID: {org.id})")
        statuses = get_invite_statuses(org.id)
        
        print(f"\nFound {len(statuses)} entries:")
        for s in statuses:
            print(f"- {s['email']} | {s['role']} | Status: {s['status']} | Created: {s['created_at']}")
            
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
