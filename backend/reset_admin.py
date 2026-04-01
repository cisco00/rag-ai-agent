import sys
import os

sys.path.append('/app')
from auth import hash_password
from models import engine as admin_engine
from sqlalchemy import text

def reset_admin():
    with admin_engine.connect() as conn:
        rows = conn.execute(text("SELECT id, email, role FROM users")).mappings().all()
        print("Found users in DB:")
        for u in rows:
            print(f" - {u['email']} (Role: {u['role']})")
        
        if not rows:
            print("No users found in database!")
            return
            
        admin = next((u for u in rows if u['email'] == 'admin@example.com'), None)
        if not admin:
            admin = rows[0]
            print(f"-- admin@example.com not found, resetting password for {admin['email']} instead")
            
    # Write new password
    new_hash = hash_password("password")
    with admin_engine.begin() as conn:
        conn.execute(
            text("UPDATE users SET password_hash = :h WHERE id = :id"),
            {"h": new_hash, "id": admin['id']}
        )
    print(f"-- Password for {admin['email']} has been reset to: password")

if __name__ == "__main__":
    reset_admin()
