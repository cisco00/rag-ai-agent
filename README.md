# Vantage AI: Commercial Analytics Portal

This project is a production-ready, RAG-powered analytics tool for organizations. It allows companies to register, connect their own databases (SQL Server, PostgreSQL, MySQL, SQLite), upload Excel/CSV files, and leverage AI-powered insights via a secure, authenticated API.

## 🚀 Deployment (Docker Compose)

The easiest way to get started is using Docker Compose, which spins up the backend, frontend, and a PostgreSQL database.

### 1. Configure Environment
Create a `.env` file in the `backend/` directory with your Hugging Face token and other configurations.

### 2. Start Services
```bash
docker-compose up -build
```

The application will be available at:
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:8000

---

## 📁 Project Structure

```text
rag-ai-agent/
├── backend/            # Python FastAPI backend
│   ├── api.py          # FastAPI Server (Commercial Endpoints)
│   ├── models.py       # Admin DB Models (Orgs, API Keys)
│   ├── main.py         # Multi-tenant Agent Logic
│   ├── database.py     # SQLAlchemy Database Manager
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/           # React + Vite frontend
│   ├── src/
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml  # Orchestration
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

---

## 🛠️ Requirements
- Docker and Docker Compose
- API Keys (Hugging Face / OpenAI) as configured in `.env`
