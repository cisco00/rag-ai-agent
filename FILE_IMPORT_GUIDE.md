# File Import Feature Documentation

## Overview

The RAG AI agent now has **three ways** to import CSV/Excel files into your database for analysis:

1. **API Endpoint** `/import` - Import files via HTTP (recommended for production)
2. **FileUploader Class** - Direct Python class usage
3. **Standalone Function** - One-liner convenience function

---

## Method 1: API Endpoint (Recommended)

### Endpoint: `POST /import`

Import CSV or Excel files directly into your organization's configured database.

**Headers:**
- `X-API-KEY`: Your organization's API key

**Parameters:**
- `file`: The CSV or Excel file (multipart/form-data)
- `table_name` (optional): Name for the database table (defaults to filename)
- `if_exists` (optional): How to handle existing table - `'replace'`, `'append'`, or `'fail'` (default: `'replace'`)

**Example using cURL:**

```bash
# First, configure your database
curl -X POST http://localhost:8000/config \
  -H "X-API-KEY: your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"connection_string": "sqlite:///my_analytics.db"}'

# Import a CSV file
curl -X POST "http://localhost:8000/import?table_name=sales&if_exists=replace" \
  -H "X-API-KEY: your_api_key" \
  -F "file=@sales_data.csv"
```

**Example using Python requests:**

```python
import requests

api_key = "your_api_key_here"

# Import CSV file
with open('sales_data.csv', 'rb') as f:
    response = requests.post(
        "http://localhost:8000/import",
        headers={"X-API-KEY": api_key},
        files={'file': f},
        params={
            'table_name': 'sales',
            'if_exists': 'replace'
        }
    )

result = response.json()
print(f"Imported {result['rows_imported']} rows into table '{result['table_name']}'")
```

**Response:**

```json
{
  "status": "success",
  "message": "File 'sales_data.csv' imported successfully",
  "table_name": "sales",
  "rows_imported": 1000,
  "columns": 5,
  "column_names": ["date", "product", "quantity", "price", "total"],
  "column_types": [
    ["date", "TEXT"],
    ["product", "TEXT"],
    ["quantity", "INTEGER"],
    ["price", "REAL"],
    ["total", "REAL"]
  ],
  "action": "replace",
  "database": "sqlite"
}
```

---

## Batch Import: Upload Multiple Files

### Endpoint: `POST /import/batch`

Import multiple CSV or Excel files at once. Each file creates a separate table.

**Headers:**
- `X-API-KEY`: Your organization's API key

**Parameters:**
- `files`: Multiple CSV or Excel files (multipart/form-data)
- `table_prefix` (optional): Prefix for all table names (e.g., `'jan2024'`)
- `if_exists` (optional): How to handle existing tables - `'replace'`, `'append'`, or `'fail'` (default: `'replace'`)

**Limits:**
- Maximum 20 files per batch
- Each file must be ≤ 50MB

**Example using cURL:**

```bash
curl -X POST "http://localhost:8000/import/batch?table_prefix=jan2024" \
  -H "X-API-KEY: your_api_key" \
  -F "files=@sales_data.csv" \
  -F "files=@customers.csv" \
  -F "files=@inventory.csv"
```

**Example using Python requests:**

```python
import requests

api_key = "your_api_key_here"

# Open multiple files
files = [
    ('files', open('sales_data.csv', 'rb')),
    ('files', open('customers.csv', 'rb')),
    ('files', open('inventory.csv', 'rb'))
]

response = requests.post(
    "http://localhost:8000/import/batch",
    headers={"X-API-KEY": api_key},
    files=files,
    params={
        'table_prefix': 'jan2024',
        'if_exists': 'replace'
    }
)

result = response.json()
print(f"Imported {result['successful']}/{result['total_files']} files")

# Check individual file results
for file_result in result['files']:
    if file_result['status'] == 'success':
        print(f"✓ {file_result['filename']}: {file_result['rows_imported']} rows → {file_result['table_name']}")
    else:
        print(f"✗ {file_result['filename']}: {file_result['error']}")
```

**Response:**

```json
{
  "status": "success",
  "total_files": 3,
  "successful": 3,
  "failed": 0,
  "files": [
    {
      "filename": "sales_data.csv",
      "status": "success",
      "table_name": "jan2024_sales_data",
      "rows_imported": 1000,
      "columns": 5,
      "column_names": ["date", "product", "quantity", "price", "total"]
    },
    {
      "filename": "customers.csv",
      "status": "success",
      "table_name": "jan2024_customers",
      "rows_imported": 500,
      "columns": 4,
      "column_names": ["customer_id", "name", "email", "total_purchases"]
    },
    {
      "filename": "inventory.csv",
      "status": "success",
      "table_name": "jan2024_inventory",
      "rows_imported": 200,
      "columns": 4,
      "column_names": ["product", "stock", "reorder_level", "supplier"]
    }
  ]
}
```

**Status Values:**
- `"success"` - All files imported successfully
- `"partial"` - Some files succeeded, some failed
- `"failed"` - All files failed

---

## Method 2: FileUploader Class

Use the `FileUploader` class directly in your Python code.

```python
from database import DatabaseManager
from file_uploader import FileUploader

# Create database connection
db = DatabaseManager("sqlite:///my_analytics.db")

# Create uploader
uploader = FileUploader(db)

# Import CSV file
result = uploader.upload_file_to_db(
    file_path='sales_data.csv',
    table_name='sales',
    if_exists='replace'
)

if result['success']:
    print(f"✓ Imported {result['rows_imported']} rows")
    print(f"  Columns: {', '.join(result['column_names'])}")
else:
    print(f"✗ Error: {result['error']}")

db.close()
```

**For Excel files with multiple sheets:**

```python
# Import specific sheet
result = uploader.upload_file_to_db(
    file_path='report.xlsx',
    table_name='q1_sales',
    sheet_name='Q1 2024',  # Specify sheet name or index
    if_exists='replace'
)

# Import all sheets
result = uploader.upload_multiple_sheets(
    excel_file_path='annual_report.xlsx',
    table_prefix='annual_2024'
)
# Creates tables: annual_2024_sheet1, annual_2024_sheet2, etc.
```

---

## Method 3: Standalone Function

The simplest one-liner approach:

```python
from file_uploader import upload_file_to_database

# One line to import
result = upload_file_to_database(
    file_path='sales_data.csv',
    connection_string='sqlite:///my_analytics.db',
    table_name='sales',
    if_exists='replace'
)

print(f"Imported {result['rows_imported']} rows")
```

---

## Features

### ✅ Automatic Data Cleaning

The file uploader automatically:
- Cleans column names (removes spaces, special characters)
- Validates file size (max 50MB)
- Checks for empty files
- Handles missing data appropriately

### ✅ Supported File Types

- **CSV** (`.csv`)
- **Excel** (`.xlsx`, `.xls`)

### ✅ Table Management Options

**`if_exists` parameter:**
- `'replace'` - Drop existing table and create new one (default)
- `'append'` - Add data to existing table
- `'fail'` - Raise error if table exists

### ✅ Automatic Column Name Cleaning

Column names are automatically cleaned:
- Spaces → underscores
- Special characters removed
- Converted to lowercase
- Numbers prefixed with `col_`

**Example:**
```
"Product Name" → "product_name"
"Price ($)" → "price"
"2024 Sales" → "col_2024_sales"
```

---

## Complete Workflow Example

```python
import requests

# 1. Register organization
response = requests.post(
    "http://localhost:8000/register",
    json={"name": "My Company"}
)
api_key = response.json()['api_key']

# 2. Configure database
requests.post(
    "http://localhost:8000/config",
    headers={"X-API-KEY": api_key},
    json={"connection_string": "sqlite:///my_analytics.db"}
)

# 3. Import CSV file
with open('sales_data.csv', 'rb') as f:
    requests.post(
        "http://localhost:8000/import",
        headers={"X-API-KEY": api_key},
        files={'file': f},
        params={'table_name': 'sales'}
    )

# 4. Query the imported data
response = requests.post(
    "http://localhost:8000/query",
    headers={"X-API-KEY": api_key},
    json={"query": "What are the top 5 products by sales?"}
)

print(response.json()['response'])
```

---

## Error Handling

The import function provides detailed error messages:

```python
{
  "success": false,
  "error": "File too large: 75.5MB. Maximum allowed size is 50MB."
}
```

Common errors:
- File not found
- File too large (>50MB)
- Unsupported file type
- Empty file
- Database connection failed
- Table already exists (with `if_exists='fail'`)

---

## Advanced Usage

### Append Monthly Data

```python
# January
upload_file_to_database('jan_sales.csv', table_name='sales', if_exists='replace')

# February - append
upload_file_to_database('feb_sales.csv', table_name='sales', if_exists='append')

# March - append
upload_file_to_database('mar_sales.csv', table_name='sales', if_exists='append')
```

### Import Multiple Excel Sheets

```python
from file_uploader import FileUploader
from database import DatabaseManager

db = DatabaseManager("sqlite:///my_analytics.db")
uploader = FileUploader(db)

result = uploader.upload_multiple_sheets(
    excel_file_path='annual_report.xlsx',
    table_prefix='report_2024'
)

print(f"Imported {result['sheets_processed']} sheets:")
for table in result['tables']:
    print(f"  - {table['table_name']}: {table['result']['rows_imported']} rows")
```

---

## API Endpoints Summary

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/import` | POST | Import single file into configured database (permanent) |
| `/import/batch` | POST | Import multiple files at once (permanent) |
| `/upload` | POST | Upload file to temporary database (for quick analysis) |
| `/tables` | GET | List all tables in database |
| `/query` | POST | Query data with natural language |

**Key Differences:**
- `/import` → Single file, permanent table in configured database
- `/import/batch` → Multiple files, permanent tables with optional prefix
- `/upload` → Single file, temporary database for quick file analysis

---

## See Also

- [import_examples.py](file:///home/idoko/AI%20agent/rag-ai-agent/import_examples.py) - Complete working examples
- [example_file_upload.py](file:///home/idoko/AI%20agent/rag-ai-agent/src/example_file_upload.py) - More examples
- [README.md](file:///home/idoko/AI%20agent/rag-ai-agent/README.md) - Main documentation
