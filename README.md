# Computer Store RAG Agent (Hugging Face Edition)

This project implements a Retrieval-Augmented Generation (RAG) agent capable of interacting with a computer store's SQL database. It uses **Hugging Face's Inference API** (defaulting to `Qwen/Qwen2.5-72B-Instruct`) to translate natural language questions into SQL queries, execute them, and provide answering based on the data.

## Features

- **Text-to-SQL Conversion**: Converts user questions into SQL queries using state-of-the-art open models.
- **Database Interaction**: Automatically inspects database schemas and executes queries.
- **Modular Design**: Separated concerns into database management, tool definitions, and agent logic.
- **Data Persistence**: Uses a local SQLite database (`identifier.sqlite.db`).

## Project Structure

```text
rag-ai-agent/
├── src/
│   ├── main.py         # Application entry point (HF Inference Client)
│   ├── database.py     # Database connection and schema management
│   └── tools.py        # GenAI tool definitions (JSON Schemas)
├── requirements.txt    # Project dependencies
├── identifier.sqlite.db # SQLite database file (created automatically)
└── README.md           # Project documentation
```

## Prerequisites

- Python 3.12+
- A **Hugging Face Token** with access to the Inference API.

## Installation

1.  **Clone the repository** (if you haven't already).

2.  **Install dependencies**:
    ```bash
    pip install -r requirements.txt
    ```

3.  **Set up Environment Variables**:
    Create a `.env` file in the root directory and add your Hugging Face Token:
    ```env
    HF_TOKEN=your_hf_token_here
    ```

    > **Note**: The `.env` file is ignored by git to protect your credentials.

## Running as an API

The agent can also be run as a FastAPI service, making it suitable for organizational analytics.

### Start the API Server

```bash
python3 -m uvicorn src.api:app --host 0.0.0.0 --port 8000 --app-dir src
```

### API Endpoints

- **`GET /health`**: Check system status.
- **`GET /tables`**: List all database tables and their schemas.
- **`POST /query`**: Ask a natural language question.
  - Body: `{"query": "Show me a bar chart of product prices.", "db_path": "path/to/db.sqlite"}`
  - Returns: `{"response": "...", "visualization": {"type": "bar", ...}}`
- **`GET /analytics`**: Retrieve query logs and usage statistics.

### Data Visualization

When acting as a **Data Analyst**, the agent can generate structured data for charts. Simply ask:
*"Show me a bar chart of product sales"* or *"Visualize the trend of orders."*

The API will return a `visualization` object that can be directly consumed by frontend charting libraries like Chart.js or Recharts.

### Dynamic Databases

The API supports connecting to different SQLite databases on the fly. Pass the `db_path` in the `/query` request body to analyze external data sources.

### Example Request

```bash
curl -X POST http://localhost:8000/query \
     -H "Content-Type: application/json" \
     -d '{"query": "Who is the top salesperson?"}'
```

## How it Works

The system uses a **multi-turn RAG loop**:
1.  **Natural Language Query**: The user asks a question via CLI or API.
2.  **Tool Selection**: The model (Qwen 2.5) identifies which SQL tools are needed (`list_tables`, `describe_table`, `execute_query`).
3.  **Execution**: The agent executes the SQL and feeds the results back to the model.
4.  **Answer**: The model synthesizes the final answer based on the data.
5.  **Logging**: The API version logs the query and tools used for internal analytics.

## Usage

Run the main script to start the agent:

```bash
python3 src/main.py
```

The script will:
1.  Initialize the SQLite database.
2.  Connect to the Hugging Face Inference API.
3.  Run example queries using `Qwen/Qwen2.5-72B-Instruct`.

## Database Schema

The database consists of three tables:
- **Products**: `product_id`, `product_name`, `price`
- **Staff**: `staff_id`, `first_name`, `last_name`
- **Orders**: `order_id`, `customer_name`, `staff_id`, `product_id`

## Customization

-   **Adding more data**: Modify `src/database.py` in the `_seed_data` method.
-   **Changing the model**: Update `MODEL_NAME` in `src/main.py`.
