import requests
import json
import time

BASE_URL = "http://localhost:8000"

def run_tests():
    print("--- Testing User Management & Role Handover ---")

    # 1. Register new org
    print("1. Registering Organization...")
    res = requests.post(f"{BASE_URL}/auth/register", json={"name": "Removal Test Org", "email": "removal@vantage.local"})
    # It might fail if exists but let's use a unique name
    if res.status_code == 400:
        # try unique
        res = requests.post(f"{BASE_URL}/auth/register", json={"name": f"Removal Test Org {time.time()}", "email": f"removal_{time.time()}@vantage.local"})
    
    org_data = res.json()
    api_key = org_data["api_key"]
    print("Org API Key:", api_key)

    # 2. Register first user (Owner)
    print("2. Registering Owner...")
    res = requests.post(
        f"{BASE_URL}/auth/register-first-user",
        headers={"x-api-key": api_key},
        json={"email": "owner_test@vantage.local", "password": "Password123!", "display_name": "Test Owner"}
    )
    if res.status_code != 200:
        print("Registration failed (maybe exists). Let's just login.")
        res = requests.post(f"{BASE_URL}/auth/login", json={"email": "owner_test@vantage.local", "password": "Password123!"})
    
    owner_token = res.json()["access_token"]
    owner_headers = {"Authorization": f"Bearer {owner_token}"}

    # 3. Create Invite
    print("3. Inviting user1...")
    res = requests.post(f"{BASE_URL}/auth/invite", headers=owner_headers, json={"email": "user1@vantage.local", "role": "analyst"})
    print("Invite User1:", res.status_code, res.json())

    # 4. Revoke Invite
    print("4. Revoking Invite for user1...")
    res = requests.delete(f"{BASE_URL}/auth/invite/user1@vantage.local", headers=owner_headers)
    print("Revoke Invite status:", res.status_code, res.json())
    assert res.status_code == 200

    # 5. Invite and Accept User2
    print("5. Inviting and Accepting user2...")
    res = requests.post(f"{BASE_URL}/auth/invite", headers=owner_headers, json={"email": "user2@vantage.local", "role": "analyst"})
    token2 = res.json()["token"]
    res = requests.post(f"{BASE_URL}/auth/accept-invite", json={"token": token2, "password": "Password123!", "display_name": "User Two"})
    print("Accept User2 status:", res.status_code)
    assert res.status_code == 200

    # 6. Remove User2
    print("6. Removing User2...")
    res = requests.delete(f"{BASE_URL}/auth/users/user2@vantage.local", headers=owner_headers)
    print("Remove User2 status:", res.status_code, res.json())
    assert res.status_code == 200

    # 7. Invite and Accept User3
    print("7. Inviting and Accepting user3...")
    res = requests.post(f"{BASE_URL}/auth/invite", headers=owner_headers, json={"email": "user3@vantage.local", "role": "analyst"})
    token3 = res.json()["token"]
    res = requests.post(f"{BASE_URL}/auth/accept-invite", json={"token": token3, "password": "Password123!", "display_name": "User Three"})
    user3_token = res.json()["access_token"]
    print("Accept User3 status:", res.status_code)

    # 8. Change Role (Handover Ownership)
    print("8. Handover Ownership to User3...")
    res = requests.put(f"{BASE_URL}/auth/users/user3@vantage.local/role", headers=owner_headers, json={"role": "owner"})
    print("Role Change status:", res.status_code, res.json())
    assert res.status_code == 200

    # 9. Verify roles
    print("9. Verifying New Roles...")
    res_owner = requests.get(f"{BASE_URL}/auth/me", headers=owner_headers)
    res_user3 = requests.get(f"{BASE_URL}/auth/me", headers={"Authorization": f"Bearer {user3_token}"})
    
    print("Original Owner Role:", res_owner.json()["role"])
    print("User3 Role:", res_user3.json()["role"])
    
    assert res_owner.json()["role"] == "admin"
    assert res_user3.json()["role"] == "owner"

    print("ALL TESTS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    run_tests()
