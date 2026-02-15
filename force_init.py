
import os
import sys
# Add src to path
sys.path.append(os.path.join(os.getcwd(), 'src'))

from models import init_admin_db, engine, Base, ChatSession, ChatMessage
import logging

logging.basicConfig(level=logging.INFO)

print("Forcing init_admin_db...")
init_admin_db()
print("Done.")

# Check tables
from sqlalchemy import inspect
inspector = inspect(engine)
tables = inspector.get_table_names()
print(f"Tables: {tables}")

if "chat_sessions" in tables and "chat_messages" in tables:
    print("SUCCESS: Chat tables found.")
else:
    print("FAILURE: Chat tables NOT found.")
