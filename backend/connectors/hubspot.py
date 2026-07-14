import httpx
import pandas as pd
import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

class HubSpotConnector:
    def __init__(self, access_token: str):
        self.access_token = access_token
        self.base_url = "https://api.hubapi.com/crm/v3"
        self.headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json"
        }

    async def _fetch_paginated_objects(self, object_type: str, properties: List[str]) -> List[Dict[str, Any]]:
        results = []
        after = None
        
        async with httpx.AsyncClient() as client:
            while True:
                # Use search API if possible for better property control, or regular GET
                url = f"{self.base_url}/objects/{object_type}"
                params = {
                    "properties": ",".join(properties),
                    "limit": 100
                }
                if after:
                    params["after"] = after
                
                try:
                    resp = await client.get(url, headers=self.headers, params=params)
                    resp.raise_for_status()
                    data = resp.json()
                    
                    batch = data.get("results", [])
                    for item in batch:
                        # Extract simple properties dict
                        props = item.get("properties", {})
                        props["hubspot_id"] = item.get("id")
                        results.append(props)
                    
                    after = data.get("paging", {}).get("next", {}).get("after")
                    if not after or len(results) >= 500: # Safety cap for demo/startup
                        break
                except Exception as e:
                    logger.error(f"Error fetching HubSpot {object_type}: {e}")
                    break
        
        return results

    async def get_contacts(self) -> pd.DataFrame:
        props = ["firstname", "lastname", "email", "phone", "company", "createdate", "lastmodifieddate"]
        data = await self._fetch_paginated_objects("contacts", props)
        return pd.DataFrame(data)

    async def get_deals(self) -> pd.DataFrame:
        props = ["dealname", "amount", "dealstage", "pipeline", "closedate", "createdate"]
        data = await self._fetch_paginated_objects("deals", props)
        return pd.DataFrame(data)

    async def get_companies(self) -> pd.DataFrame:
        props = ["name", "domain", "city", "industry", "annualrevenue", "createdate"]
        data = await self._fetch_paginated_objects("companies", props)
        return pd.DataFrame(data)
