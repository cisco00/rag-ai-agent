# Product Requirements Document: Vantage AI

## Executive Summary

**Product Name:** Vantage AI: Commercial Analytics Portal  
**Version:** 2.0  
**Last Updated:** February 28, 2026  
**Document Owner:** Product Team

### Vision
Vantage AI is a production-ready, RAG-powered analytics platform that democratizes data insights for organizations. By combining natural language processing with multi-database connectivity, we enable businesses to query their data using plain English and receive actionable insights with automated visualizations.

### Mission
Empower organizations to make data-driven decisions without requiring SQL expertise or data science knowledge, while maintaining enterprise-grade security and multi-tenancy.

---

## Product Overview

### What is Vantage AI?

Vantage AI is a commercial SaaS platform that allows organizations to:
- Connect their existing databases (PostgreSQL, MySQL, SQLite, SQL Server)
- Upload CSV/Excel files for instant analysis
- Query data using natural language instead of SQL
- Receive AI-generated insights with automatic visualizations
- Share reports with stakeholders via secure links
- Maintain complete data isolation in a multi-tenant environment

### Target Users

**Primary Personas:**
1. **Business Analysts** - Need quick insights without SQL knowledge
2. **Data Managers** - Require self-service analytics for their teams
3. **Product Managers** - Want to explore data trends and metrics
4. **Executives** - Need high-level insights and shareable reports

**Secondary Personas:**
1. **Data Engineers** - Setting up database connections
2. **IT Administrators** - Managing organizational access

---

## Core Features

### 1. Multi-Tenant Organization Management

**Priority:** P0 (Critical)  
**Status:** ✅ Implemented

#### Requirements
- Organizations can self-register via API
- Each organization receives a unique API key
- Complete data isolation between organizations
- Separate admin database for organizational metadata

#### User Stories
- As a **new customer**, I want to register my organization so that I can start using the platform
- As an **admin**, I want my organization's data completely isolated from other customers
- As a **developer**, I want to authenticate all API requests using an API key

#### Technical Specifications
- Admin database: SQLite (`admin.db`)
- Organizations table with fields: `id`, `name`, `api_key`, `db_connection_string`, `created_at`
- API key generation: Secure random 256-bit tokens
- Authentication: Header-based (`X-API-KEY`)

#### API Endpoints
```
POST /register
  Request: {"name": "Organization Name"}
  Response: {"api_key": "...", "message": "..."}
```

---

### 2. Universal Database Connectivity

**Priority:** P0 (Critical)  
**Status:** ✅ Implemented

#### Requirements
- Support for major SQL databases via SQLAlchemy
- Dynamic connection string configuration per organization
- Connection validation and error handling
- Schema introspection capabilities

#### Supported Databases
- ✅ SQLite
- ✅ PostgreSQL
- ✅ MySQL
- ✅ Microsoft SQL Server
- ✅ Any SQLAlchemy-compatible database

#### User Stories
- As a **data manager**, I want to connect my PostgreSQL database so that I can analyze production data
- As an **analyst**, I want to switch between different databases without changing my workflow
- As a **developer**, I want clear error messages when database connections fail

#### Technical Specifications
- Connection strings stored encrypted in admin database
- Connection pooling for performance
- Automatic schema caching
- Support for read-only connections

#### API Endpoints
```
POST /config
  Headers: X-API-KEY
  Request: {"connection_string": "postgresql://..."}
  Response: {"status": "success", "message": "..."}

GET /tables
  Headers: X-API-KEY
  Response: {"tables": [...], "total": N}
```

---

### 3. File Import System

**Priority:** P0 (Critical)  
**Status:** ✅ Implemented

#### Requirements
- Import CSV and Excel files into databases
- Support for single and batch file uploads
- Automatic data cleaning and column name normalization
- Table management (replace, append, fail modes)

#### Features
- **Single File Import:** Upload one file at a time
- **Batch Import:** Upload up to 20 files simultaneously
- **Temporary Upload:** Quick analysis without permanent storage
- **Multi-Sheet Excel:** Import all sheets from Excel workbooks

#### User Stories
- As a **business analyst**, I want to upload my Excel report so that I can query it with natural language
- As a **data manager**, I want to import multiple CSV files at once to save time
- As a **product manager**, I want to quickly analyze a file without creating permanent tables

#### Technical Specifications
- Maximum file size: 50MB per file
- Supported formats: `.csv`, `.xlsx`, `.xls`
- Automatic column cleaning: lowercase, underscore separation, special char removal
- Data validation: empty file detection, size limits, type checking

#### API Endpoints
```
POST /import
  Headers: X-API-KEY
  Form Data: file, table_name (optional), if_exists (optional)
  Response: {"status": "success", "rows_imported": N, "columns": [...]}

POST /import/batch
  Headers: X-API-KEY
  Form Data: files[], table_prefix (optional), if_exists (optional)
  Response: {"total_files": N, "successful": M, "files": [...]}

POST /upload
  Headers: X-API-KEY
  Form Data: file
  Response: {"file_id": "...", "database_path": "..."}
```

---

### 4. Natural Language Query Engine

**Priority:** P0 (Critical)  
**Status:** ✅ Implemented

#### Requirements
- Convert natural language to SQL queries
- Execute queries safely with error handling
- Return results in human-readable format
- Support conversation history for context
- Automatic visualization generation

#### Capabilities
- Text-to-SQL conversion using LLM
- Multi-step reasoning with tool calling
- Automatic chart type selection
- Support for complex analytical queries
- Query result summarization

#### User Stories
- As a **business analyst**, I want to ask "What are our top 5 products?" instead of writing SQL
- As a **product manager**, I want to see trends visualized automatically
- As an **executive**, I want simple answers to complex data questions

#### Technical Specifications
- LLM: HuggingFace Inference API (Qwen/Qwen2.5-Coder-32B-Instruct)
- Tool calling: Dynamic SQL execution, schema inspection
- Max iterations: Configurable (default: 10)
- Visualization types: bar, line, pie, scatter, area charts
- Response format: JSON with text + visualization data

#### API Endpoints
```
POST /query
  Headers: X-API-KEY
  Request: {
    "query": "What are the top 5 products by revenue?",
    "history": [...],
    "use_file": false
  }
  Response: {
    "query": "...",
    "response": "...",
    "visualization": {
      "type": "bar",
      "data": {...},
      "title": "..."
    },
    "status": "success"
  }
```

---

### 5. Visualization System

**Priority:** P1 (High)  
**Status:** ✅ Implemented

#### Requirements
- Automatic chart generation from query results
- Support for multiple chart types
- Structured data format for frontend rendering
- Validation of visualization data

#### Supported Chart Types
- **Bar Chart:** Comparisons, rankings
- **Line Chart:** Trends over time
- **Pie Chart:** Proportions, distributions
- **Scatter Plot:** Correlations, relationships
- **Area Chart:** Cumulative trends

#### User Stories
- As a **business analyst**, I want to see sales trends as a line chart automatically
- As a **product manager**, I want market share shown as a pie chart
- As a **developer**, I want consistent visualization data format for rendering

#### Technical Specifications
- Visualization parser validates chart structure
- Data format: `{type, data: {labels, values}, title, description}`
- Automatic type selection based on query intent
- Fallback to table format if visualization fails

---

### 6. Report Sharing

**Priority:** P1 (High)  
**Status:** ✅ Implemented

#### Requirements
- Generate shareable links for analysis results
- Public access without authentication
- Unique report IDs
- Persistent storage of shared reports

#### User Stories
- As a **business analyst**, I want to share my findings with stakeholders via a link
- As an **executive**, I want to view shared reports without logging in
- As a **product manager**, I want to present insights in meetings using shareable URLs

#### Technical Specifications
- Report ID: Secure random hash
- Storage: File-based JSON in `shared_reports/` directory
- Public endpoint: No authentication required
- Data includes: query, response, visualization, timestamp

#### API Endpoints
```
POST /share
  Headers: X-API-KEY
  Request: {"query": "...", "history": [...]}
  Response: {
    "report_id": "...",
    "share_url": "http://.../shared/{report_id}",
    "expires_at": null
  }

GET /shared/{report_id}
  Response: {
    "query": "...",
    "response": "...",
    "visualization": {...},
    "created_at": "..."
  }
```

---

### 7. Report Export

**Priority:** P1 (High)  
**Status:** ✅ Implemented

#### Requirements
- Export analysis results to PDF format
- Export analysis results to PowerPoint format
- Include query, response text, and rendered charts
- Support for multiple chart types (bar, line, pie, etc.)

#### User Stories
- As a **business analyst**, I want to download my report as a PDF for offline viewing
- As a **product manager**, I want to export my findings to PowerPoint for presentations
- As an **executive**, I want professional-looking reports with visualizations

#### Technical Specifications
- PDF Library: `reportlab`
- PPTX Library: `python-pptx`
- Chart Rendering: `matplotlib` (server-side)
- Endpoints return streaming files for download

#### API Endpoints
```
POST /export/pdf
  Headers: X-API-KEY
  Request: {"query": "...", "response": "...", "visualization": {...}, "status": "..."}
  Response: application/pdf (file stream)

POST /export/pptx
  Headers: X-API-KEY
  Request: {"query": "...", "response": "...", "visualization": {...}, "status": "..."}
  Response: application/vnd.openxmlformats-officedocument.presentationml.presentation (file stream)
```

---

### 8. Health Monitoring

**Priority:** P2 (Medium)  
**Status:** ✅ Implemented

#### Requirements
- Health check endpoint for monitoring
- No authentication required
- Simple status response

#### API Endpoints
```
GET /health
  Response: {"status": "healthy"}
```

---

### 9. Advanced Analytics

**Priority:** P1 (High)  
**Status:** ✅ Implemented

#### Requirements
- Time-series forecasting using Holt-Winters Exponential Smoothing
- Anomaly detection using Isolation Forest
- Correlation matrix analysis
- Dropdown-based table and column selection
- Automatic column detection from connected database
- Data downsampling for large tables (>10,000 rows) to prevent browser timeouts

#### Features
- **Time Series Forecast:** Select a date column and value column, choose forecast horizon (7–90 periods) and frequency (Daily, Hourly, Weekly, Monthly)
- **Anomaly Detection:** Identify outliers in any numeric column with configurable contamination rate
- **Correlation Matrix:** Heatmap-style correlation analysis for multiple numeric columns

#### User Stories
- As a **data analyst**, I want to forecast future values of a metric without writing any code
- As a **business analyst**, I want to see which columns are correlated to identify patterns
- As a **data manager**, I want to detect unusual spikes or drops in my data automatically

#### Technical Specifications
- Forecast engine: `statsmodels` Holt-Winters (with multi-stage fallback to Simple ES)
- Anomaly engine: `sklearn` IsolationForest
- SQL row limit: 10,000 rows per analytics request to prevent timeouts
- Output downsampling: forecasts resampled to requested frequency; anomaly capped at 2,000 display points
- Response format aligned with recharts chart library: `[{date, actual, forecast}]`

#### API Endpoints
```
POST /analytics/forecast
  Headers: X-API-KEY
  Request: {"table_name": "...", "date_column": "...", "value_column": "...", "periods": 30, "freq": "D"}
  Response: {historical: {dates, values}, forecast: {dates, values}, model_type: "..."}

POST /analytics/anomaly
  Headers: X-API-KEY
  Request: {"table_name": "...", "value_column": "...", "contamination": 0.05}
  Response: {anomalies: {...}, total_points: N, anomaly_count: M}

POST /analytics/correlation
  Headers: X-API-KEY
  Request: {"table_name": "...", "columns": [...], "method": "pearson"}
  Response: {columns: [...], matrix: [[...]], method: "pearson"}
```

---

### 10. Real-Time Data Streaming

**Priority:** P1 (High)  
**Status:** ✅ Implemented

#### Requirements
- Live monitoring of database table data via WebSocket
- Hybrid WebSocket + HTTP polling fallback for maximum compatibility
- Dynamic table and column selection
- Live line chart with configurable buffer size (10–200 points)
- Automatic replay mode for static/historical datasets
- Connection status indicator (Live / Connecting / Failed)

#### Features
- **Live Streaming:** WebSocket connection to `/ws/stream/{table}` for genuinely live tables
- **Replay Mode (HTTP Polling):** For static historical tables, automatically falls back to HTTP polling, cycling through rows at 1.5-second intervals
- **Live Stats:** Derived current, average, min, and max values for the first selected column
- **Recent Data Table:** Shows the last 10 received data points in a tabular view

#### User Stories
- As a **data engineer**, I want to monitor my production database metrics in real time
- As an **analyst**, I want to see a live chart of sensor readings without refreshing the page
- As a **manager**, I want to see current vs average metrics at a glance

#### Technical Specifications
- WebSocket endpoint: `/ws/stream/{table_name}?api_key={key}`
- Poll interval: 2 seconds (WS server), 1.5 seconds (HTTP fallback)
- Replay dataset: last 500 rows of table
- WS fallback timeout: 5 seconds
- Chart library: `recharts` `LineChart` with `isAnimationActive={false}` for performance

#### API Endpoints
```
WS /ws/stream/{table_name}?api_key={key}
  Message format: {"timestamp": "...", "col1": value, "col2": value, ...}
```

---

### 11. Data Management

**Priority:** P1 (High)  
**Status:** ✅ Implemented

#### Requirements
- View and browse all tables in the connected database
- Paginated table preview with inline editing
- Add, edit, and delete rows
- Import CSV/Excel files directly from the Data Management screen
- Fill missing values with AI-suggested imputation strategies

#### Features
- **Table Browser:** Lists all tables with row counts; click to preview data
- **Inline Edit:** Click any cell to edit values in-place
- **Row Operations:** Add new rows and delete existing rows
- **Missing Value Analysis:** Automatically calculates % missing per column and suggests mean (numeric) or mode (categorical) imputation
- **Data Import:** Upload CSV/Excel from the Data Management UI

#### User Stories
- As a **data manager**, I want to fix incorrect values in my database directly from the UI
- As a **data analyst**, I want to fill missing values with sensible defaults before running analysis
- As a **business user**, I want to import new data without leaving the analytics interface

---

### 12. Scheduled Reports

**Priority:** P2 (Medium)  
**Status:** ✅ Implemented

#### Requirements
- Schedule recurring queries to run automatically
- Configurable frequency (hourly, daily, weekly, monthly)
- View and manage existing scheduled reports
- Integration with export formats (PDF/PPTX)

#### User Stories
- As a **manager**, I want a daily sales summary delivered automatically
- As an **executive**, I want a weekly KPI report without any manual steps

---

## Technical Architecture

### Technology Stack

**Backend:**
- **Framework:** FastAPI (Python 3.10+)
- **Database ORM:** SQLAlchemy
- **LLM:** HuggingFace Inference API
- **Server:** Uvicorn (ASGI)

**Data Processing:**
- **File Parsing:** pandas
- **Database Drivers:** psycopg2, pymysql, pyodbc

**Security:**
- **Authentication:** API Key (Header-based)
- **Secrets Management:** Environment variables (.env)

### System Components

```
┌─────────────────────────────────────────────────────────┐
│                     FastAPI Server                       │
│                        (api.py)                          │
└─────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│   Models     │   │ Analytics    │   │  Database    │
│  (models.py) │   │   Agent      │   │   Manager    │
│              │   │  (main.py)   │   │(database.py) │
└──────────────┘   └──────────────┘   └──────────────┘
        │                   │                   │
        ▼                   ▼                   ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  Admin DB    │   │ HuggingFace  │   │  Customer    │
│ (admin.db)   │   │     API      │   │  Databases   │
└──────────────┘   └──────────────┘   └──────────────┘
```

### Data Flow

1. **Registration:** Client → `/register` → Admin DB → API Key
2. **Configuration:** Client → `/config` + API Key → Admin DB → Connection String
3. **File Import:** Client → `/import` + File → Database Manager → Customer DB
4. **Query:** Client → `/query` + Question → Analytics Agent → LLM → SQL → Customer DB → Response + Viz

---

## Security & Compliance

### Authentication
- ✅ API Key-based authentication
- ✅ Header validation on all protected endpoints
- ✅ Secure token generation (256-bit random)

### Data Isolation
- ✅ Separate databases per organization
- ✅ Connection string encryption
- ✅ No cross-tenant data access

### Input Validation
- ✅ File size limits (50MB)
- ✅ File type validation
- ✅ SQL injection prevention via parameterized queries
- ✅ Schema validation for requests

### Future Security Enhancements
- 🔲 Rate limiting per organization
- 🔲 API key rotation
- 🔲 Audit logging
- 🔲 Role-based access control (RBAC)
- 🔲 Data encryption at rest
- 🔲 HTTPS enforcement

---

## Performance Requirements

### Response Times
- Health check: < 100ms
- Registration: < 500ms
- Database configuration: < 1s
- File import (1MB): < 5s
- Query execution: < 10s (simple), < 30s (complex)

### Scalability
- Support 100+ concurrent organizations
- Handle files up to 50MB
- Process batch imports (20 files)
- Maintain conversation history (50 messages)

### Resource Limits
- Max file size: 50MB per file
- Max batch files: 20 files
- Max query iterations: 10
- Connection timeout: 30s

---

## API Reference

### Base URL
```
http://localhost:8000
```

### Authentication
All endpoints except `/register`, `/health`, and `/shared/{id}` require:
```
Headers: X-API-KEY: <your_api_key>
```

### Endpoints Summary

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/health` | GET | ❌ | Health check |
| `/register` | POST | ❌ | Create organization |
| `/config` | POST | ✅ | Configure database |
| `/tables` | GET | ✅ | List database tables |
| `/tables/{name}/preview` | GET | ✅ | Preview table data |
| `/import` | POST | ✅ | Import single file |
| `/import/batch` | POST | ✅ | Import multiple files |
| `/upload` | POST | ✅ | Temporary file upload |
| `/analyze-file` | POST | ✅ | Analyze file before import |
| `/query` | POST | ✅ | Natural language query |
| `/share` | POST | ✅ | Create shareable report |
| `/shared/{id}` | GET | ❌ | View shared report |
| `/export/pdf` | POST | ✅ | Export report as PDF |
| `/export/pptx` | POST | ✅ | Export report as PPTX |
| `/analytics/forecast` | POST | ✅ | Time-series forecasting |
| `/analytics/anomaly` | POST | ✅ | Anomaly detection |
| `/analytics/correlation` | POST | ✅ | Correlation matrix |
| `WS /ws/stream/{table}` | WS | ✅ | Real-time data streaming |

---

## Error Handling

### Error Response Format
```json
{
  "detail": "Error message",
  "error_type": "ValidationError",
  "status_code": 400
}
```

### HTTP Status Codes
- `200` - Success
- `400` - Bad Request (validation error)
- `401` - Unauthorized (invalid API key)
- `404` - Not Found
- `500` - Internal Server Error

### Common Errors
- **Invalid API Key:** `401 Unauthorized`
- **Database not configured:** `400 Bad Request`
- **File too large:** `400 Bad Request`
- **Unsupported file type:** `400 Bad Request`
- **Query timeout:** `500 Internal Server Error`

---

## Logging & Monitoring

### Logging Levels
- **INFO:** Normal operations, query execution
- **WARNING:** Deprecated features, performance issues
- **ERROR:** Failed operations, exceptions
- **DEBUG:** Detailed execution traces

### Log Locations
- Application logs: `logs/app.log`
- Query logs: In-memory analytics
- Error logs: Console + file

### Metrics Tracked
- Total queries processed
- Average response time
- Tool usage frequency
- Visualization generation rate
- Error rate by type

---

## Deployment

### Requirements
- Python 3.10+
- 2GB RAM minimum
- 10GB disk space
- Network access to HuggingFace API

### Environment Variables
```bash
HF_TOKEN=<huggingface_api_token>
ADMIN_DB_URL=sqlite:///./admin.db
LOG_LEVEL=INFO
MAX_FILE_SIZE_MB=50
```

### Installation
```bash
# Clone repository
git clone <repo_url>
cd rag-ai-agent

# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Set environment variables
cp .env.example .env
# Edit .env with your HF_TOKEN

# Run server
export PYTHONPATH=$PYTHONPATH:$(pwd)/src
python3 src/api.py
```

### Production Deployment
- Use production ASGI server (Gunicorn + Uvicorn workers)
- Configure reverse proxy (Nginx)
- Enable HTTPS
- Set up database backups
- Configure monitoring (Prometheus, Grafana)

---

## Future Roadmap

### Phase 2 — Completed (Q1 2026)
- ✅ Web-based dashboard UI (React + Next.js)
- ✅ Query history and chat session management
- ✅ Scheduled reports
- ✅ Advanced analytics (forecasting, anomaly detection, correlation)
- ✅ Real-time data streaming (WebSocket + HTTP polling fallback)
- ✅ Data management UI (inline edit, row add/delete, missing value fill)
- ✅ File analysis before import ("Analyze Before Import")
- ✅ PDF and PowerPoint export

### Phase 3 (Q2 2026)
- 🔲 Advanced visualizations (heatmaps, treemaps, candlestick)
- 🔲 Custom branding per organization
- 🔲 Webhook integrations
- 🔲 User management and RBAC within organizations
- 🔲 Email notifications and report delivery

### Phase 4 (Q3–Q4 2026)
- 🔲 Mobile app (iOS/Android)
- 🔲 Slack / Microsoft Teams integration
- 🔲 Multi-language support
- 🔲 On-premise deployment option
- 🔲 Rate limiting and API key rotation
- 🔲 Audit logging

---

## Success Metrics

### Product Metrics
- **Adoption:** Number of registered organizations
- **Engagement:** Queries per organization per week
- **Retention:** Weekly/Monthly active organizations
- **Performance:** Average query response time

### Business Metrics
- **Revenue:** MRR/ARR growth
- **Customer Satisfaction:** NPS score
- **Support:** Ticket volume and resolution time
- **Churn:** Monthly churn rate

### Technical Metrics
- **Uptime:** 99.9% availability
- **Error Rate:** < 1% of requests
- **Query Success Rate:** > 95%
- **Visualization Success Rate:** > 80%

---

## Appendix

### Glossary
- **RAG:** Retrieval-Augmented Generation
- **LLM:** Large Language Model
- **API Key:** Authentication token for API access
- **Multi-tenancy:** Single instance serving multiple organizations
- **Tool Calling:** LLM invoking functions to perform tasks

### Related Documents
- [README.md](README.md) - Quick start guide
- [FILE_IMPORT_GUIDE.md](FILE_IMPORT_GUIDE.md) - File import documentation
- [REFACTORING_GUIDE.md](REFACTORING_GUIDE.md) - Code quality guidelines

### Support
- Documentation: [README.md](README.md)
- Issues: GitHub Issues
- Email: support@vantageai.example.com

---

**Document Version:** 2.0  
**Last Updated:** February 28, 2026  
**Next Review:** May 28, 2026
