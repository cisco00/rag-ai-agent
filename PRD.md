# Product Requirements Document: Vantage AI

## Executive Summary

**Product Name:** Vantage AI: Commercial Analytics Portal  
**Version:** 2.1  
**Last Updated:** March 2026  
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
- Monitor and catch data anomalies via the Proactive Insight Engine
- Transform data seamlessly using an AI-guided pipeline

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
- Organizations can self-register via API or UI
- Each organization receives a unique API key
- Complete data isolation between organizations
- Separate admin database for organizational metadata
- Enforce unique email addresses per organization during registration to prevent duplicate accounts

#### User Stories
- As a **new customer**, I want to register my organization so that I can start using the platform
- As an **admin**, I want my organization's data completely isolated from other customers
- As a **developer**, I want to authenticate all API requests using an API key

#### Technical Specifications
- Admin database: SQLite (`admin.db`)
- Organizations table with fields: `id`, `name`, `email`, `api_key`, `db_connection_string`, `branding`, `created_at`
- API key generation: Secure random 256-bit tokens
- Authentication: Header-based (`x-api-key`)

#### API Endpoints
```
POST /register
  Request: {"name": "Organization Name", "email": "admin@org.com"}
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
  Headers: x-api-key
  Request: {"connection_string": "postgresql://..."}
  Response: {"status": "success", "message": "..."}

GET /tables
  Headers: x-api-key
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
- File analysis before import (Analyze Before Import feature)
- Table management (replace, append, fail modes)

#### Features
- **Single File Import:** Upload one file at a time
- **Batch Import:** Upload up to 20 files simultaneously
- **Analyze Before Import:** Pre-scan file structures to prevent import failures and show a preview of column formats
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
  Headers: x-api-key
  Form Data: file, table_name (optional), if_exists (optional)
  Response: {"status": "success", "rows_imported": N, "columns": [...]}

POST /analyze-file
  Headers: x-api-key
  Form Data: file
  Response: {"status": "success", "analysis": {...}}
  
POST /upload
  Headers: x-api-key
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
- Deliver brief, plain-English explanations with visualizations (no verbose/technical output)
- Support conversation history for context
- Automatic visualization generation

#### Capabilities
- Text-to-SQL conversion using LLM
- Multi-step reasoning with tool calling
- Automatic chart type selection based on query results
- Support for complex analytical queries
- Query result summarization

#### User Stories
- As a **business analyst**, I want to ask "What are our top 5 products?" instead of writing SQL
- As a **product manager**, I want to see trends visualized automatically
- As an **executive**, I want simple answers to complex data questions without overwhelming SQL logs

#### Technical Specifications
- LLM: HuggingFace Inference API (Qwen/Qwen2.5-Coder-32B-Instruct)
- Tool calling: Dynamic SQL execution, schema inspection
- Max iterations: Configurable (default: 10)
- Visualization types: bar, line, pie, scatter, area charts
- Response format: JSON with text + visualization data

#### API Endpoints
```
POST /query
  Headers: x-api-key
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

### 5. Proactive Insight Engine

**Priority:** P1 (High)  
**Status:** ✅ Implemented

#### Requirements
- Automatically detect anomalies and metric changes in organizational databases
- Use the AI agent to explain *why* the metrics changed
- Surface insights proactively without requiring the user to ask a question
- Schedule check-ins to run as a background task
- Mark insights as read/unread

#### Features
- **Background Scheduler:** Periodically compares current metrics (e.g., 24-hr average) against a baseline (e.g., 7-day average) for all configured organizations.
- **AI-Driven Explanations:** When a significant shifts (>10%) is detected, asks the underlying AnalyticsAgent to analyze the tables and formulate an explanation.
- **Insights UI:** A distinct "Insights Center" that categorizes insights by severity (high, medium, low) and lists headline, explanation, and likely causes.

#### User Stories
- As a **business analyst**, I want the system to alert me if daily sales drop unexpectedly so I can investigate without explicitly running a query.
- As an **executive**, I want proactive alerts covering key performance indicators highlighted automatically for me.

#### API Endpoints
```
GET /insights
  Headers: x-api-key
  Response: {"status": "success", "insights": [...]}

POST /insights/{id}/seen
  Headers: x-api-key
  Response: {"status": "success"}

POST /insights/mark-all-seen
  Headers: x-api-key
  Response: {"status": "success"}
```

---

### 6. Data Transformation Pipeline & AI Wizard

**Priority:** P1 (High)  
**Status:** ✅ Implemented

#### Requirements
- Provide a UI for users to clean, format, and engineer features on their data
- Allow for chaining of multiple operations (e.g., drop row, filter, rename column)
- **AI Transformation Wizard:** An input field to describe necessary transformations in plain English, which translates to correct pipeline operations.
- Dynamic fill NaN logic featuring suggested strategies based on data type (mean for numerical, mode for categorical).

#### Operations Supported
- **Cleaning:** Drop Duplicates, Clean Text, Remove Outliers
- **Transform:** Filter Rows, Rename Column, Drop Column, Change Type, Fill Missing Values
- **Advanced/Aggregation:** Normalize, Encode, Group By, Resample Time Series

#### User Stories
- As a **data manager**, I want to drop columns that have mostly null values or impute them rapidly.
- As a **business user**, I want to tell the AI to "make the date column a datetime format" simply by typing it out.

#### API Endpoints
```
POST /transform
  Headers: x-api-key
  Request: {"table_name": "...", "operations": [...]}
  Response: {"status": "success", "message": "...", "rows_affected": N}

POST /transform/suggest
  Headers: x-api-key
  Request: {"table_name": "...", "prompt": "..."}
  Response: {"status": "success", "operations": [...]}
```

---

### 7. Visualization System

**Priority:** P1 (High)  
**Status:** ✅ Implemented

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

### 8. Report Sharing and Export

**Priority:** P1 (High)  
**Status:** ✅ Implemented

#### Requirements
- Generate shareable links for analysis results (Public access without authentication)
- Export analysis results to PDF format
- Export analysis results to PowerPoint (PPTX) format
- Include query, response text, and rendered charts

#### User Stories
- As a **business analyst**, I want to download my report as a PDF for offline viewing or share my findings with stakeholders via a link
- As a **product manager**, I want to export my findings to PowerPoint for presentations

#### Technical Specifications
- Shared reports have unique secure random hashes and file-based JSON storage
- Output generation libraries: `reportlab` (PDF), `python-pptx` (PPTX), `matplotlib` (chart rendering server-side)

---

### 9. Advanced Analytics

**Priority:** P1 (High)  
**Status:** ✅ Implemented

#### Requirements
- Time-series forecasting using Holt-Winters Exponential Smoothing
- Anomaly detection using Isolation Forest
- Correlation matrix analysis
- Dropdown-based table and column selection in UI (to prevent manually typing column names)
- Automatic column detection from connected database
- Data downsampling for large tables (>10,000 rows) to prevent browser timeouts

#### Features
- **Time Series Forecast:** Select a date column and value column using dynamic dropdowns, choose forecast horizon (7–90 periods) and frequency (Daily, Hourly, Weekly, Monthly)
- **Anomaly Detection:** Identify outliers in any numeric column with configurable contamination rate
- **Correlation Matrix:** Heatmap-style correlation analysis for multiple numeric columns

#### User Stories
- As a **data analyst**, I want to forecast future values of a metric without writing any code
- As a **business analyst**, I want to see which columns are correlated to identify patterns

---

### 10. Real-Time Data Streaming

**Priority:** P1 (High)  
**Status:** ✅ Implemented

#### Requirements
- Live monitoring of database table data via WebSocket
- Hybrid WebSocket + HTTP polling fallback for maximum compatibility
- Dynamic table and column selection
- Live line chart with configurable buffer size
- Connection status indicator

#### Features
- **Live Streaming:** WebSocket connection to `/ws/stream/{table}` for genuinely live tables
- **Replay Mode (HTTP Polling):** For static historical tables, automatically falls back to HTTP polling, cycling through rows at 1.5-second intervals

---

### 11. Data Management

**Priority:** P1 (High)  
**Status:** ✅ Implemented

#### Requirements
- View and browse all tables in the connected database
- Paginated table preview with inline editing
- Add, edit, and delete rows
- Fill missing values with AI-suggested imputation strategies

#### User Stories
- As a **data manager**, I want to fix incorrect values in my database directly from the UI
- As a **data analyst**, I want to fill missing values with sensible defaults before running analysis

---

### 12. Scheduled Reports

**Priority:** P2 (Medium)  
**Status:** ✅ Implemented

#### Requirements
- Schedule recurring queries to run automatically
- Configurable frequency (hourly, daily, weekly, monthly)
- View and manage existing scheduled reports

#### User Stories
- As a **manager**, I want a daily sales summary delivered automatically

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
- **Authentication:** API Key (Header-based `x-api-key`)
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

---

## Security & Compliance

### Authentication
- ✅ API Key-based authentication
- ✅ Header validation on all protected endpoints (`x-api-key`)
- ✅ Secure token generation (256-bit random)
- ✅ Prevent duplicate email accounts at Org level

### Data Isolation
- ✅ Separate databases per organization
- ✅ Connection string encryption
- ✅ No cross-tenant data access

### Input Validation
- ✅ File size limits (50MB)
- ✅ File type validation
- ✅ SQL injection prevention via parameterized queries

---

## Future Roadmap

### Phase 2 — Completed (Q1 2026)
- ✅ Web-based dashboard UI (React + Vite)
- ✅ Query history and chat session management
- ✅ Scheduled reports
- ✅ Advanced analytics (forecasting, anomaly detection, correlation)
- ✅ Real-time data streaming (WebSocket + HTTP polling fallback)
- ✅ Data management UI (inline edit, row add/delete, AI missing value fill)
- ✅ File analysis before import ("Analyze Before Import")
- ✅ PDF and PowerPoint export
- ✅ Proactive Insight Engine and Detection Pipeline
- ✅ AI Transformation Wizard

### Phase 3 (Q2 2026)
- 🔲 Advanced visualizations (heatmaps, treemaps, candlestick)
- ✅ Custom branding per organization
- 🔲 Webhook integrations
- 🔲 User management and RBAC within organizations
- 🔲 Email notifications and report delivery

### Phase 4 (Q3–Q4 2026)
- 🔲 Mobile app (iOS/Android)
- 🔲 Slack / Microsoft Teams integration
- 🔲 Multi-language support
- 🔲 On-premise deployment option
- 🔲 Rate limiting and API key rotation

---

## Success Metrics

### Product Metrics
- **Adoption:** Number of registered organizations
- **Engagement:** Queries per organization per week
- **Performance:** Average query response time

### Business Metrics
- **Revenue:** MRR/ARR growth
- **Customer Satisfaction:** NPS score

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

**Document Version:** 2.1  
**Last Updated:** March 2026  
**Next Review:** June 2026
