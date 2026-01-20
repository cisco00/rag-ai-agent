import httpx
import time
import os

BASE_URL = "http://localhost:8000"

def verify():
    print("--- Starting Verification ---")
    
    # 1. Register
    org_name = f"TestCorp_{int(time.time())}"
    print(f"\n1. Registering Organization {org_name}...")
    reg_resp = httpx.post(f"{BASE_URL}/register", json={"name": org_name}, timeout=60.0)
    if reg_resp.status_code != 200:
        print(f"FAILED: {reg_resp.text}")
        return
    
    reg_data = reg_resp.json()
    api_key = reg_data["api_key"]
    print(f"SUCCESS: Registered TestCorp. API Key: {api_key}")
    
    headers = {"X-API-KEY": api_key}
    
    # 2. Configure DB
    print("\n2. Configuring Database...")
    db_path = os.path.abspath("identifier.sqlite.db")
    conn_str = f"sqlite:///{db_path}"
    conf_resp = httpx.post(f"{BASE_URL}/config", headers=headers, json={"connection_string": conn_str}, timeout=60.0)
    if conf_resp.status_code != 200:
        print(f"FAILED: {conf_resp.text}")
        return
    print(f"SUCCESS: Configured DB to {conn_str}")
    
    # 3. Get Tables
    print("\n3. Fetching Tables...")
    tables_resp = httpx.get(f"{BASE_URL}/tables", headers=headers, timeout=60.0)
    if tables_resp.status_code != 200:
        print(f"FAILED: {tables_resp.text}")
        return
    print(f"SUCCESS: Tables found: {tables_resp.json().get('tables')}")
    
    # 4. Run Query
    print("\n4. Running Analytics Query...")
    query = "What are the names of our staff members?"
    query_resp = httpx.post(f"{BASE_URL}/query", headers=headers, json={"query": query}, timeout=60.0)
    if query_resp.status_code != 200:
        print(f"FAILED: {query_resp.text}")
        return
    
    resp_data = query_resp.json()
    print(f"SUCCESS: Agent Response: {resp_data['response']}")
    
    print("\n--- Verification Complete ---")

if __name__ == "__main__":
    # Wait a bit for server to be ready
    time.sleep(2)
    verify()
