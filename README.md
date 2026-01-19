# Computer Store AI Analytics Dashboard (Hugging Face Edition)

This project implements a Retrieval-Augmented Generation (RAG) agent capable of interacting with a computer store's SQL database. It uses **Hugging Face's Inference API** (defaulting to `Qwen/Qwen2.5-72B-Instruct`) to act as a **Senior Data Analyst**, translating natural language questions into SQL, generating visualizations, and providing deep insights.

## 🚀 Quick Start: The Dashboard

The easiest way to use the agent is through the modern web dashboard.

1.  **Start the Server**:
    ```bash
    python3 -m uvicorn api:app --host 0.0.0.0 --port 8000 --app-dir src
    ```
2.  **Open in Browser**:
    👉 **[http://localhost:8000](http://localhost:8000)**

---

## ✨ Features

- **Text-to-SQL Conversion**: Advanced translation of complex questions into optimized SQL queries.
- **Data Visualization**: Automatically generates JSON for charts (Bar, Line, Pie) via **Chart.js** integration.
- **Data Analyst Persona**: Acts as a senior analyst providing context, explanations, and visual trends.
- **Dynamic Databases**: Query any SQLite database file on the fly by specifying its path.
- **Premium Frontend**: A custom responsive dashboard with glassmorphism UI/UX.
- **Full REST API**: Integrated FastAPI backend for organizational integration.

## 📁 Project Structure

```text
rag-ai-agent/
├── src/
│   ├── api.py          # FastAPI Server (REST Endpoints)
│   ├── main.py         # Core Agent Logic & Analyst Persona
│   ├── database.py     # Schema Management & SQLite Connection
│   ├── tools.py        # Tool Definitions (JSON Schemas)
│   └── static/         # Frontend Dashboard
│       └── index.html  # Premium Web Interface
├── requirements.txt    # Project dependencies (FastAPI, HF Client)
├── identifier.sqlite.db # Primary SQLite database
└── README.md           # Project documentation
```

## 🛠️ Installation

1.  **Install dependencies**:
    ```bash
    pip install -r requirements.txt
    ```

2.  **Set up Environment Variables**:
    Create a `.env` file in the root directory:
    ```env
    HF_TOKEN=your_hf_token_here
    ```

---

## 📡 API Reference

### Endpoints

- **`GET /`**: Serves the Analytics Dashboard.
- **`GET /health`**: System status check.
- **`GET /tables`**: Returns database schema information.
- **`POST /query`**: The heart of the analyst.
  - **Body**: 
    ```json
    {
      "query": "Show me a pie chart of sales by staff member.",
      "db_path": "optional/path/to/other.db"
    }
    ```
  - **Returns**: Textual analysis and a `visualization` object for charts.

- **`GET /analytics`**: Internal logs for query auditing.

---

## 🎨 Visualization Capability

When you ask for a graph or trend, the agent identifies the correct aggregation and returns a structured payload:

```json
"visualization": {
  "type": "bar",
  "labels": ["Laptop", "Keyboard", "Mouse"],
  "data": [799.99, 129.99, 29.99]
}
```

The frontend dashboard automatically picks this up and renders a beautiful, interactive chart.

---

## 🧠 How it Works

The system uses a **Multi-Turn RAG Loop**:
1.  **Schema Awareness**: The agent explores tables using `list_tables` and `describe_table`.
2.  **Tool Execution**: It executes multi-step SQL queries to gather nested data.
3.  **Synthesis**: The Senior Data Analyst persona translates results into actionable insights and visual data.
4.  **Logging**: Every query is tracked for organizational performance monitoring.

## 📊 Database Schema

Default tables include:
- **Products**: Catalog of items and prices.
- **Staff**: Sales personnel details.
- **Orders**: Transaction records linking staff and products.

---

## 🤝 Contribution & Customization

-   **Persona**: Modify `SYSTEM_PROMPT` in `src/main.py`.
-   **Database**: Add more initial data in `src/database.py`.
-   **API**: Extend endpoints in `src/api.py`.
