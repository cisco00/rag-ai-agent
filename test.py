import urllib.request
import json

req1 = urllib.request.Request("http://127.0.0.1:8000/register", data=json.dumps({"name": "TestOrg9"}).encode(), headers={"Content-Type": "application/json"})
resp1 = urllib.request.urlopen(req1)
api_key = json.loads(resp1.read().decode())["api_key"]

urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:8000/config", data=json.dumps({"connection_string": "sqlite:///C:/Users/DELL/AI-Model/rag-ai-agent/identifier.sqlite.db"}).encode(), headers={"Content-Type": "application/json", "X-API-KEY": api_key}))

req3 = urllib.request.Request("http://127.0.0.1:8000/tables", headers={"X-API-KEY": api_key})
try:
    resp3 = urllib.request.urlopen(req3)
    print(resp3.read().decode())
except urllib.error.HTTPError as e:
    print(f"Error {e.code}: {e.read().decode()}")
