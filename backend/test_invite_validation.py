import os
import sys
from fastapi import HTTPException

# Ensure the backend directory is in the path
sys.path.append(os.getcwd())

from auth import create_invite
from models import get_db, Organization, Base, engine

def test_invitation_validation():
    try:
        with get_db() as db:
            org = db.query(Organization).first()
            if not org:
                print("No organization found.")
                return

            print(f"Testing for Org: {org.name} (ID: {org.id})")
            
            # 1. Test inviting an existing user (Owner)
            owner_email = org.email or "otium@yahoo.com" # From previous run
            print(f"\n1. Testing inviting existing user: {owner_email}")
            try:
                create_invite(org.id, owner_email, "analyst", 1)
                print("FAIL: Should have raised HTTPException for existing user.")
            except HTTPException as e:
                print(f"SUCCESS: Caught expected error: {e.detail}")
            
            # 2. Test duplicate invitation
            test_email = "duplicate_test@example.com"
            print(f"\n2. Testing duplicate invitation: {test_email}")
            
            # Create first invite
            try:
                create_invite(org.id, test_email, "analyst", 1)
                print("First invite created.")
                
                # Try second invite
                create_invite(org.id, test_email, "analyst", 1)
                print("FAIL: Should have raised HTTPException for duplicate invite.")
            except HTTPException as e:
                print(f"SUCCESS: Caught expected error: {e.detail}")
                
    except Exception as e:
        print(f"Unexpected error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test_invitation_validation()
