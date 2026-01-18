# Computer Store RAG Agent

This project implements a Retrieval-Augmented Generation (RAG) agent capable of interacting with a computer store's SQL database. It uses Google's Gemini Flash model to translate natural language questions into SQL queries, execute them, and provide answering based on the data.

## Features

- **Text-to-SQL Conversion**: Converts user questions into SQL queries using Gemini.
- **Database Interaction**: Automatically inspects database schemas and executes queries.
- **Modular Design**: Separated concerns into database management, tool definitions, and agent logic.
- **Data Persistence**: Uses a local SQLite database (`identifier.sqlite.db`).

## Project Structure

```text
rag-ai-agent/
├── src/
│   ├── main.py         # Application entry point
│   ├── database.py     # Database connection and schema management
│   └── tools.py        # GenAI tool definitions
├── requirements.txt    # Project dependencies
├── identifier.sqlite.db # SQLite database file (created automatically)
└── README.md           # Project documentation
```

## Prerequisites

- Python 3.12+
- A Google Cloud API Key with access to Gemini models.

## Installation

1.  **Clone the repository** (if you haven't already).

2.  **Install dependencies**:
    ```bash
    pip install -r requirements.txt
    ```

3.  **Set up Environment Variables**:
    Create a `.env` file in the root directory and add your Google API key:
    ```env
    GOOGLE_API_KEY=your_api_key_here
    ```

    > **Note**: The `.env` file is ignored by git to protect your credentials.

## Usage

Run the main script to start the agent:

```bash
python3 src/main.py
```

The script will:
1.  Initialize the SQLite database (and seed it with test data if empty).
2.  Connect to the Gemini API.
3.  Run example queries:
    - "What is the cheapest product"
    - "What products should salesperson Alice focus on to round out her portfolio? Explain why."

## Database Schema

The database consists of three tables:
- **Products**: `product_id`, `product_name`, `price`
- **Staff**: `staff_id`, `first_name`, `last_name`
- **Orders**: `order_id`, `customer_name`, `staff_id`, `product_id`

## Customization

-   **Adding more data**: Modify `src/database.py` in the `_seed_data` method.
-   **Changing the model**: Update the model name in `src/main.py` (default: `gemini-2.0-flash`).
