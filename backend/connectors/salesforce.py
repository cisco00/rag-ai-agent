import httpx
import pandas as pd
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime

logger = logging.getLogger(__name__)

class SalesforceConnector:
    def __init__(self, access_token: str, instance_url: str, refresh_token: Optional[str] = None):
        self.access_token = access_token
        self.instance_url = instance_url.rstrip("/")
        self.refresh_token = refresh_token
        self.headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json"
        }

    async def _query(self, soql: str) -> List[Dict[str, Any]]:
        results = []
        next_url = f"/services/data/v60.0/query?q={soql.replace(' ', '+')}"
        
        async with httpx.AsyncClient() as client:
            while next_url:
                try:
                    url = f"{self.instance_url}{next_url}"
                    resp = await client.get(url, headers=self.headers)
                    
                    if resp.status_code == 401 and self.refresh_token:
                        logger.info("Salesforce token expired, attempting refresh...")
                        # In a real app, this would refresh and retry. 
                        # For now, we log and raise to be handled by caller.
                        raise Exception("Salesforce Session Expired")
                    
                    resp.raise_for_status()
                    data = resp.json()
                    
                    batch = data.get("records", [])
                    for record in batch:
                        # Clean Salesforce metadata (attributes key)
                        record.pop("attributes", None)
                        results.append(record)
                    
                    next_url = data.get("nextRecordsUrl")
                    if not next_url or len(results) >= 500:
                        break
                except Exception as e:
                    logger.error(f"Error querying Salesforce: {e}")
                    break
        
        return results

    async def get_leads(self) -> pd.DataFrame:
        soql = "SELECT Id, FirstName, LastName, Email, Company, Status, CreatedDate FROM Lead"
        data = await self._query(soql)
        return pd.DataFrame(data)

    async def get_opportunities(self) -> pd.DataFrame:
        soql = "SELECT Id, Name, Amount, StageName, Probability, CloseDate, CreatedDate FROM Opportunity"
        data = await self._query(soql)
        return pd.DataFrame(data)

    async def get_contacts(self) -> pd.DataFrame:
        soql = "SELECT Id, FirstName, LastName, Email, CreatedDate FROM Contact"
        data = await self._query(soql)
        return pd.DataFrame(data)
