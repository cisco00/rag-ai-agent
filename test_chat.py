
import requests
import json
import logging
import sys
import os

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BASE_URL = "http://localhost:8000"

def get_api_key():
    import secrets
    name = f"TestChatOrg_{secrets.token_hex(4)}"
    try:
        response = requests.post(f"{BASE_URL}/register", json={"name": name})
        if response.status_code == 200:
            return response.json()["api_key"]
        else:
            logger.error(f"Failed to register temp org: {response.text}")
            return None
    except Exception as e:
        logger.error(f"Failed to connect to backend: {e}")
        return None

def test_chat_flow(api_key):
    headers = {"X-API-KEY": api_key}
    
    # 1. Create Session
    logger.info("Creating chat session...")
    resp = requests.post(f"{BASE_URL}/chat/sessions", headers=headers, json={"title": "Test Session"})
    if resp.status_code != 200:
        logger.error(f"Failed to create session: {resp.text}")
        return
    session_id = resp.json()["id"]
    logger.info(f"Session created: {session_id}")
    
    # 2. Configure DB (Mock) - skip for now, query will fail on DB check but might save user message?
    # actually execute_query checks for db_connection_string early.
    # We need to register DB or just mock it.
    # We can use file upload to bypass DB check if use_file=True is supported, but we removed use_file logic in favor of DB prioritization.
    # Actually, execute_query uses org.db_connection_string.
    
    # Let's try to list sessions at least
    resp = requests.get(f"{BASE_URL}/chat/sessions", headers=headers)
    logger.info(f"Sessions list: {resp.json()}")
    
    # 3. Check messages (should be empty)
    resp = requests.get(f"{BASE_URL}/chat/sessions/{session_id}/messages", headers=headers)
    messages = resp.json()
    logger.info(f"Messages (empty): {messages}")
    assert len(messages) == 0

    # 4. Try Query (will fail due to no DB, but let's see if it saves user message before failing?)
    # The code saves user message *before* checking DB conn?
    # Looking at code: Yes, "Save user message if session_id provided" is before "Check if org has DB connection".
    
    logger.info("Sending query...")
    resp = requests.post(f"{BASE_URL}/query", headers=headers, json={
        "query": "Hello world",
        "session_id": session_id
    })
    logger.info(f"Query response status: {resp.status_code}") # Likely 200 with error text or 400
    
    # 5. Check messages again
    resp = requests.get(f"{BASE_URL}/chat/sessions/{session_id}/messages", headers=headers)
    messages = resp.json()
    logger.info(f"Messages (should have user msg): {messages}")
    
    # Verify user message is there
    found_user = any(m["role"] == "user" and m["content"] == "Hello world" for m in messages)
    if found_user:
        logger.info("User message persisted successfully!")
    else:
        logger.error("User message NOT persisted.")

if __name__ == "__main__":
    api_key = get_api_key()
    if api_key:
        test_chat_flow(api_key)
