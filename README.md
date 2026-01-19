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
