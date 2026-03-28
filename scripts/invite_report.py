import sqlite3
import os
from datetime import datetime, timezone

db_path = 'backend/admin.db'
if not os.path.exists(db_path):
    print("Database not found.")
    exit(1)

conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

print("# Invitation Status Report\n")

# 1. Accepted Invitations
# We can find these by looking at used=1 in invite_tokens
cur.execute("""
    SELECT i.email, i.role, u.display_name, u.created_at as joined_at, u.last_login_at
    FROM invite_tokens i
    JOIN users u ON i.email = u.email AND i.org_id = u.org_id
    WHERE i.used = 1
""")
accepted = cur.fetchall()

print("## Accepted Invitations")
if accepted:
    for row in accepted:
        print(f"- **{row['email']}** ({row['role']})")
        print(f"  - Name: {row['display_name']}")
        print(f"  - Joined: {row['joined_at']}")
        print(f"  - Last Login: {row['last_login_at'] or 'Never'}")
else:
    print("No accepted invitations found.")

# 2. Pending Invitations
now = datetime.now(timezone.utc).isoformat()
cur.execute("""
    SELECT email, role, expires_at, created_at
    FROM invite_tokens
    WHERE used = 0 AND expires_at > ?
""", (now,))
pending = cur.fetchall()

print("\n## Pending Invitations")
if pending:
    for row in pending:
        print(f"- **{row['email']}** ({row['role']})")
        print(f"  - Invited: {row['created_at']}")
        print(f"  - Expires: {row['expires_at']}")
else:
    print("No pending invitations found.")

# 3. Expired Invitations
cur.execute("""
    SELECT email, role, expires_at
    FROM invite_tokens
    WHERE used = 0 AND expires_at <= ?
""", (now,))
expired = cur.fetchall()

if expired:
    print("\n## Expired Invitations")
    for row in expired:
        print(f"- **{row['email']}** ({row['role']}) (Expired: {row['expires_at']})")

conn.close()
