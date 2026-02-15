
import requests
import pandas as pd
import io
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BASE_URL = "http://localhost:8000"

def get_api_key():
    # Helper to get a valid API key (register a temp org)
    import secrets
    name = f"TestTransform_{secrets.token_hex(4)}"
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

def test_change_type(api_key):
    logger.info("Testing change_type operation...")
    
    # 1. Upload a CSV with mixed types as strings
    csv_content = "id,value,date_str\n1,100,2023-01-01\n2,200,2023-01-02\n3,invalid,not-a-date"
    files = {'file': ('test_data.csv', io.BytesIO(csv_content.encode('utf-8')), 'text/csv')}
    
    # Import
    headers = {"X-API-KEY": api_key}
    response = requests.post(f"{BASE_URL}/import", files=files, headers=headers)
    if response.status_code != 200:
        logger.error(f"Import failed: {response.text}")
        return

    table_name = response.json().get('table_name', 'test_data')
    logger.info(f"Imported table: {table_name}")

    # 2. Transform: Change 'value' to numeric (coerce error), 'date_str' to datetime
    operations = [
        {"type": "change_type", "column": "value", "new_type": "float"},
        {"type": "change_type", "column": "date_str", "new_type": "datetime"}
    ]
    
    payload = {
        "table_name": table_name,
        "operations": operations
    }
    
    response = requests.post(f"{BASE_URL}/transform", json=payload, headers=headers)
    
    if response.status_code == 200:
        result = response.json()
        logger.info("Transform success!")
        preview = result.get("preview", [])
        for row in preview:
            logger.info(row)
            
        # Verify types (implicitly by checking values)
        # Row 3 value should be null (NaN) because "invalid" cannot be float
        # Row 3 date_str should be null (NaT) because "not-a-date" cannot be datetime
        row3 = preview[2]
        if row3['value'] is None or pd.isna(row3['value']):
             logger.info("Verified: Invalid float became null")
        else:
             logger.warn(f"Failed verification: Invalid float is {row3['value']}")
             
        if row3['date_str'] is None or pd.isna(row3['date_str']):
             logger.info("Verified: Invalid date became null")
        else:
             logger.warn(f"Failed verification: Invalid date is {row3['date_str']}")
             
    else:
        logger.error(f"Transform failed: {response.status_code} - {response.text}")

if __name__ == "__main__":
    api_key = get_api_key()
    if api_key:
        test_change_type(api_key)
