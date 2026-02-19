
import requests
import pandas as pd
import io
import logging
import json
import time

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BASE_URL = "http://localhost:8000"

def get_api_key():
    # Helper to get a valid API key (register a temp org)
    import secrets
    name = f"TestAdvTransform_{secrets.token_hex(4)}"
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

def test_advanced_transforms(api_key):
    logger.info("Testing advanced transformations...")
    
    # 1. Upload a CSV with diverse data
    # Columns: id, category, value, date
    csv_content = """id,category,value,date
1,A,10,2023-01-01
2,A,20,2023-01-02
3,B,30,2023-01-03
4,B,40,2023-01-04
5,C,50,2023-01-05
"""
    files = {'file': ('adv_test_data.csv', io.BytesIO(csv_content.encode('utf-8')), 'text/csv')}
    
    headers = {"X-API-KEY": api_key}
    response = requests.post(f"{BASE_URL}/import", files=files, headers=headers)
    if response.status_code != 200:
        logger.error(f"Import failed: {response.text}")
        return

    table_name = response.json().get('table_name', 'adv_test_data')
    logger.info(f"Imported table: {table_name}")

    # 2. Transform: Normalize 'value', One-Hot 'category', Extract Day from 'date'
    operations = [
        {"type": "change_type", "column": "value", "new_type": "float"},
        {"type": "normalize", "column": "value", "method": "min-max"},
        {"type": "encode", "column": "category", "method": "one-hot"},
        {"type": "feature_engineering", "feature_type": "time_component", "column": "date", "component": "day"}
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
        
        # Verify columns exist
        if not preview:
            logger.error("No preview returned!")
            return
            
        first_row = preview[0]
        logger.info(f"First row: {first_row}")
        
        keys = first_row.keys()
        expected_keys = ['value_scaled', 'category_A', 'date_day']
        
        for k in expected_keys:
            if k in keys:
                logger.info(f"Verified column exists: {k}")
            else:
                logger.error(f"Missing column: {k}")
                
        # Value check
        # Min max of 10,20,30,40,50 -> 0, 0.25, 0.5, 0.75, 1.0
        # Row 1 (val 10) should be 0
        if first_row['value_scaled'] == 0:
             logger.info("Min-max scaling verified (0.0)")
        else:
             logger.error(f"Min-max scaling failed: {first_row['value_scaled']}")

    else:
        logger.error(f"Transform failed: {response.status_code} - {response.text}")

if __name__ == "__main__":
    api_key = get_api_key()
    if api_key:
        test_advanced_transforms(api_key)
