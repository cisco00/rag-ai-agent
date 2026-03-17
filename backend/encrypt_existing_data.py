import os
import sys

# Ensure imports work from backend directory
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import text
from models import SessionLocal
from utils import encrypt_string

def encrypt_existing_data():
    """
    Scans the organizations table for unencrypted db_connection_string values
    and updates them to their encrypted format using the current application key.
    """
    print("Starting data encryption migration...")
    
    try:
        with SessionLocal() as db:
            # We use raw sql to read the actual stored text in the database to avoid TypeDecorator
            result = db.execute(text("SELECT id, db_connection_string FROM organizations WHERE db_connection_string IS NOT NULL"))
            
            count = 0
            for row in result:
                org_id = row[0]
                conn_str = row[1]
                
                # Check if it is already encrypted (Fernet tokens start with gAAAAA)
                if conn_str and not conn_str.startswith('gAAAAA'):
                    print(f"Encrypting connection string for Organization ID {org_id}...")
                    
                    encrypted_val = encrypt_string(conn_str)
                    
                    db.execute(
                        text("UPDATE organizations SET db_connection_string = :val WHERE id = :id"),
                        {"val": encrypted_val, "id": org_id}
                    )
                    count += 1
                    
            if count > 0:
                db.commit()
                print(f"Successfully encrypted {count} organization records.")
            else:
                print("No plaintext records found. Everything is already encrypted.")
                
    except Exception as e:
        print(f"Error during migration: {e}")
        sys.exit(1)

if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    encrypt_existing_data()