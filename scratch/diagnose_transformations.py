
import os
import json
import logging
import asyncio
from dotenv import load_dotenv
load_dotenv('./backend/.env')

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("diagnostic")

# Mocking config
class MockConfig:
    def __init__(self):
        self.model_provider = os.getenv("LLM_PROVIDER", "google")
        self.google_api_key = os.getenv("GOOGLE_API_KEY")
        self.hf_token = os.getenv("HF_TOKEN")
        self.model_name = os.getenv("MODEL_NAME", "gemini-2.0-flash")

async def diagnose():
    try:
        from backend.database import DatabaseManager
        from backend.models import get_org_by_id, get_db, Organization
        from backend.schema_cache import get_cached_schema_summary
        from backend.llm_client import get_llm_client
        
        # 1. Check Organizations
        with get_db() as db:
            orgs = db.query(Organization).all()
            logger.info(f"Found {len(orgs)} organizations")
            if not orgs:
                logger.error("No organizations found in admin.db")
                return
            
            org = orgs[0]
            logger.info(f"Diagnosing for org: {org.name} (ID: {org.id})")
        
        # 2. Check Connection String
        from backend.dependencies import get_org_connection_string
        conn_str = get_org_connection_string(org)
        logger.info(f"Connection string: {conn_str}")
        
        if not conn_str:
            logger.error("No connection string found for org")
            return
            
        # 3. Check Schema Introspection
        try:
            db_manager = DatabaseManager(connection_string=conn_str)
            tables = db_manager.list_tables()
            logger.info(f"Tables found: {tables}")
            if not tables:
                logger.warning("No tables found in organization database")
            else:
                table = tables[0]
                schema = db_manager.describe_table(table)
                logger.info(f"Schema for {table}: {schema}")
        except Exception as e:
            logger.error(f"Database introspection failed: {e}")
            return

        # 4. Check Schema Summary (Cache)
        summary = get_cached_schema_summary(conn_str)
        if not summary:
            logger.error("Failed to build schema summary")
        else:
            logger.info(f"Schema summary length: {len(summary)}")
            logger.info(f"Summary preview: {summary[:100]}...")

        # 5. Check LLM suggestions
        config = MockConfig()
        client = get_llm_client(config.model_provider, config)
        
        prompt = "lowercase the name column"
        operations_spec = "Respond exclusively with a JSON list. Table schema: {schema_summary}"
        
        messages = [
            {"role": "system", "content": operations_spec.format(schema_summary=summary)},
            {"role": "user", "content": f"Table: {tables[0] if tables else 'unknown'}. Prompt: {prompt}"}
        ]
        
        logger.info("requesting LLM suggestions...")
        response = client.chat_completion(
            model=config.model_name,
            messages=messages,
            max_tokens=500
        )
        content = response.choices[0].message.content
        logger.info(f"LLM Response: {content}")
        
        try:
            from backend.utils import clean_llm_json_content
            ops = json.loads(clean_llm_json_content(content))
            logger.info(f"Parsed operations: {ops}")
        except Exception as e:
            logger.error(f"Failed to parse operations: {e}")

    except Exception as e:
        logger.error(f"Diagnostic failed: {e}", exc_info=True)

if __name__ == "__main__":
    import asyncio
    # Set python path to includes backend
    # Actually, we can just run it from root if we modify sys.path
    import sys
    sys.path.append(os.path.join(os.getcwd(), 'backend'))
    asyncio.run(diagnose())
