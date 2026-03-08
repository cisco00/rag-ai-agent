# Developer Scripts

One-off utility scripts for inspecting and debugging the Vantage AI data layer. 
These are **not** production code — they run against the live databases from the command line.

| Script | Purpose |
|---|---|
| `check_data_sources.py` | List all registered data sources for every org |
| `inspect_orgs_v2.py` | Print org metadata and config from the admin DB |
| `insert_massive.py` | Bulk-insert test data into an org database |
| `search_db.py` | Search for a value across all tables in an org DB |
| `list_db_tables.py` | List all tables and row counts for an org DB |

## Usage

Run from the project root after activating the Python environment:

```bash
cd c:\Users\DELL\AI-Model\rag-ai-agent
python scripts/check_data_sources.py
```

> **Note:** Scripts expect environment variables from `backend/.env` to be set.  
> Load them first: `$env:$(Get-Content backend\.env | ConvertFrom-StringData)`
