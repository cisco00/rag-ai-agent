
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
    # Helper to get a valid API key (register a temp org)
    import secrets
    name = f"TestFeatureOrg_{secrets.token_hex(4)}"
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

def test_data_sources(api_key):
    logger.info("Testing /data/sources...")
    headers = {"X-API-KEY": api_key}
    response = requests.get(f"{BASE_URL}/data/sources", headers=headers)
    if response.status_code == 200:
        logger.info(f"Success: {response.json()}")
    else:
        logger.error(f"Failed: {response.status_code} - {response.text}")

def test_api_import(api_key):
    # This might fail if we don't have a valid mock API, skipping for now or use a public one
    logger.info("Skipping /import/api test (requires external API)")

def test_forecast(api_key):
    logger.info("Testing /analytics/forecast...")
    # diverse data is needed.
    pass

if __name__ == "__main__":
    api_key = get_api_key()
    if api_key:
        logger.info(f"Got API Key: {api_key}")
        test_data_sources(api_key)
    else:
        logger.error("Skipping tests due to missing API key")
