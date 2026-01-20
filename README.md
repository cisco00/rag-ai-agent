# Commercial AI Analytics API (Multi-Tenant)

This project is a production-ready, RAG-powered analytics tool for organizations. It allows companies to register, connect their own databases (SQL Server, PostgreSQL, MySQL, SQLite), and leverage AI-powered insights via a secure, authenticated API.

## 🚀 Commercial Quick Start

### 1. Start the Server
```bash
export PYTHONPATH=$PYTHONPATH:$(pwd)/src
python3 src/api.py
```

### 2. Register Your Organization
First, register your company to get an **API Key**:
```bash
curl -X POST http://localhost:8000/register -H "Content-Type: application/json" -d '{"name": "Acme Corp"}'
```
> [!IMPORTANT]
> Save the `api_key` returned. You must include it in all subsequent requests as the `X-API-KEY` header.

### 3. Configure Your Database
Connect your organization's database by providing a SQLAlchemy-compatible connection string:
```bash
curl -X POST http://localhost:8000/config \
     -H "X-API-KEY: your_api_key_here" \
     -H "Content-Type: application/json" \
     -d '{"connection_string": "sqlite:////absolute/path/to/your/database.db"}'
```

---

## ✨ Commercial Features

- **Multi-Tenancy**: Complete isolation of organizations, their configurations, and data.
- **API-Key Security**: Every request is authenticated via the `X-API-KEY` header.
- **Universal DB Support**: Powered by **SQLAlchemy**, connect to PostgreSQL, MySQL, SQLite, and more.
- **Text-to-SQL & Visualization**: Organizations can query their proprietary data using natural language and receive formatted chart data.
- **Admin Metadata Storage**: Separate `admin.db` for managing organizational accounts and API keys.

## 📁 Project Structure

```text
rag-ai-agent/
├── src/
│   ├── api.py          # FastAPI Server (Commercial Endpoints)
│   ├── models.py       # Admin DB Models (Orgs, API Keys)
│   ├── main.py         # Multi-tenant Agent Logic
│   ├── database.py     # SQLAlchemy Database Manager
│   ├── tools.py        # Database Tool Definitions
│   └── static/         # Frontend Dashboard (Internal Demo)
├── admin.db            # Administrative Database (Orgs & Keys)
├── identifier.sqlite.db # Sample Customer Database
├── requirements.txt    # Project dependencies
└── README.md           # Documentation
```

## 📡 API Reference

### Auth Header
All endpoints (except `/register` and `/health`) require:
`X-API-KEY: <your_secret_key>`

### Endpoints

- **`POST /register`**: Create a new organization.
- **`POST /config`**: Set the connection string for your organization's database.
- **`GET /tables`**: Explore the schema of your connected database.
- **`POST /query`**: Ask questions about your data.
  - **Body**: `{"query": "What are our top 5 products by revenue?"}`
  - **Returns**: Analysis + `visualization` (chart) data.

---

## 🛠️ Requirements

- Python 3.10+
- SQLAlchemy
- FastAPI & Uvicorn
- Hugging Face API Token (set in `.env`)
