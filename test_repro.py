import requests
import json
import uuid

API_BASE = "http://127.0.0.1:8000"

def run_test():
    test_id = str(uuid.uuid4())[:8]
    org_name = f"test_org_{test_id}"
    email = f"test_{test_id}@example.com"
    password = "Password123!"
    
    print(f"Registering user {org_name}...")
    res = requests.post(f"{API_BASE}/register", json={
        "name": org_name,
        "email": email
    })
    res.raise_for_status()
    api_key = res.json()["api_key"]
    headers = {"X-API-KEY": api_key}
    
    print("Uploading file to trigger SQLite DB creation...")
    files = {"file": ("data.csv", "id,name\n1,alice\n2,bob")}
    res = requests.post(f"{API_BASE}/import", headers=headers, files=files, data={"if_exists": "replace"})
    res.raise_for_status()
    print("File uploaded")
    
    res = requests.get(f"{API_BASE}/tables", headers=headers)
    res.raise_for_status()
    print("Tables before DB creation:", res.json()["tables"])
    
    new_db = f"test_db_{test_id}"
    new_user = f"user_{test_id}"
    print(f"Creating Postgres DB: {new_db}...")
    res = requests.post(f"{API_BASE}/database/create-postgres", headers=headers, json={
        "new_db_name": new_db,
        "new_user": new_user,
        "new_password": "TestPassword123!"
    })
    res.raise_for_status()
    print("DB Created!")
    
    res = requests.get(f"{API_BASE}/tables", headers=headers)
    res.raise_for_status()
    print("Tables AFTER DB creation:", res.json()["tables"])
    
    if "uploaded_data" in res.json()["tables"] or "data" in res.json()["tables"] or "data.csv" in res.json()["tables"] or "data" in res.json()["tables"]:
        print("BUG REPRODUCED: The old tables are suspiciously present!")
    else:
        print("BUG NOT PRESENT: Tables are empty as they should be for a fresh database.")

if __name__ == "__main__":
    run_test()
