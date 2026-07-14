import httpx
import pandas as pd
import logging
from datetime import datetime
from typing import List, Optional, Dict, Any

from database import DatabaseManager
from models import DataSource, Organization

logger = logging.getLogger(__name__)

from connectors import HubSpotConnector, SalesforceConnector
import json

def clean_crm_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    """
    Apply basic cleaning to CRM data:
    - Normalizes column names (snake_case)
    - Standards date formats
    - Removes empty columns
    - Drops duplicates based on ID
    """
    if df is None or df.empty:
        return df
        
    # 1. Normalize column names: lower() and replace spaces/caps with underscores
    import re
    def to_snake_case(name):
        s1 = re.sub('(.)([A-Z][a-z]+)', r'\1_\2', name)
        return re.sub('([a-z0-9])([A-Z])', r'\1_\2', s1).lower().replace(' ', '_')
    
    df.columns = [to_snake_case(c) for c in df.columns]
    
    # 2. Drop columns that are 100% null
    df = df.dropna(axis=1, how='all')
    
    # 3. Standardize date columns (heuristics)
    date_cols = [c for c in df.columns if 'date' in c or 'at' in c]
    for col in date_cols:
        try:
            df[col] = pd.to_datetime(df[col], errors='coerce')
        except:
            pass
            
    # 4. Deduplicate by ID if exists
    id_col = next((c for c in df.columns if 'id' in c), None)
    if id_col:
        df = df.drop_duplicates(subset=[id_col])
        
    return df

async def run_crm_sync(source: DataSource, org: Organization, objects: Optional[List[str]] = None) -> Dict[str, Any]:
    """
    Fetch data from CRM using specialized connectors and load cleaned data into org database.
    """
    provider = source.source_type.replace("crm_", "")
    
    # Connection logic
    tokens = source.connection_details
    if isinstance(tokens, str):
        tokens = json.loads(tokens)
    
    access_token = tokens.get("access_token")
    instance_url = tokens.get("instance_url")
    refresh_token = tokens.get("refresh_token")
    
    sync_results = {}
    db_manager = DatabaseManager(connection_string=org.db_connection_string)
    
    try:
        # Initialize specialized connector
        if provider == "hubspot":
            connector = HubSpotConnector(access_token)
        elif provider == "salesforce":
            connector = SalesforceConnector(access_token, instance_url, refresh_token)
        else:
            raise Exception(f"Unsupported connector type: {provider}")

        # Objects to sync
        if not objects:
            if provider == "salesforce":
                objects = ["Lead", "Contact", "Opportunity"]
            else: # hubspot
                objects = ["contacts", "deals", "companies"]

        for obj in objects:
            logger.info(f"Syncing {provider} object: {obj}")
            
            df = None
            if "mock" in access_token:
                df = generate_mock_crm_data(provider, obj)
            else:
                # Call specialized methods
                method_name = f"get_{obj.lower()}s" if not obj.lower().endswith('s') else f"get_{obj.lower()}"
                if hasattr(connector, method_name):
                    df = await getattr(connector, method_name)()
                else:
                    logger.warning(f"Connector {provider} does not have method {method_name}")
            
            # Application of the "Data Cleaning" step requested by the user
            if df is not None and not df.empty:
                df = clean_crm_dataframe(df)
                table_name = f"{provider}_{obj.lower()}{'' if obj.lower().endswith('s') else 's'}"
                success = db_manager.load_dataframe(df, table_name, if_exists='replace')
                if success:
                    sync_results[obj] = {"status": "success", "rows": len(df), "table": table_name}
                else:
                    sync_results[obj] = {"status": "failed", "error": "DB Load Error"}
            else:
                sync_results[obj] = {"status": "skipped", "reason": "No data found"}
                
        return sync_results
    finally:
        db_manager.close()

def generate_mock_crm_data(provider: str, obj: str) -> pd.DataFrame:
    """Generate professional mock data for testing."""
    import random
    
    data = []
    if obj.lower() in ["lead", "contact", "contacts"]:
        first_names = ["John", "Sarah", "Michael", "Emma", "David", "Olivia", "James", "Sophia"]
        last_names = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis"]
        for i in range(25):
            data.append({
                "Id": f"ID_{random.randint(1000, 9999)}",
                "FirstName": random.choice(first_names),
                "LastName": random.choice(last_names),
                "Email": f"user{i}@example.com",
                "Source": random.choice(["LinkedIn", "Web", "Referral", "Cold Call"]),
                "Status": random.choice(["Open", "Working", "Closed", "Qualified"]),
                "CreatedAt": datetime.now().isoformat()
            })
    elif obj.lower() in ["opportunity", "deal", "deals"]:
        stages = ["Discovery", "Proposal", "Negotiation", "Closed Won", "Closed Lost"]
        amounts = [15000, 25000, 50000, 120000, 8000, 45000]
        for i in range(15):
            data.append({
                "Id": f"OP_{random.randint(1000, 9999)}",
                "Name": f"Deal with {random.choice(['Acme', 'Globo', 'TechNext'])} - {i}",
                "Amount": random.choice(amounts),
                "StageName": random.choice(stages),
                "Probability": random.randint(10, 100),
                "CloseDate": "2024-06-30"
            })
    else: # Account / Company
        for i in range(10):
            data.append({
                "Id": f"COMP_{random.randint(1000, 9999)}",
                "Name": f"Enterprise Corp {i}",
                "Industry": random.choice(["Tech", "Finance", "Healthcare", "Manufacturing"]),
                "Revenue": random.choice([1000000, 5000000, 10000000, 50000000])
            })
            
    return pd.DataFrame(data)
