# Refactoring Quick Reference Guide

## New Modules

### Exceptions (`exceptions.py`)
```python
from exceptions import (
    QueryExecutionError,
    FileValidationError,
    ConnectionError,
    ModelAPIError
)

try:
    db.execute_query(sql)
except QueryExecutionError as e:
    logger.error(f"Query failed: {e}")
```

### Configuration (`config.py`)
```python
from config import get_db_config, get_file_upload_config

# Get configuration
db_config = get_db_config()
max_file_size = get_file_upload_config().max_file_size

# Environment variables
# Set in .env file:
# DATABASE_URL=postgresql://...
# MAX_FILE_SIZE=104857600
# LOG_LEVEL=DEBUG
```

### Logging (`logging_config.py`)
```python
from logging_config import get_logger

logger = get_logger(__name__)
logger.info("Processing request", extra={"user_id": "123"})
logger.error("Operation failed", exc_info=True)
```

### Validators (`validators.py`)
```python
from validators import FileValidator, SQLQueryValidator

# Validate file
validator = FileValidator()
validator.validate_all(file_path)

# Validate SQL
SQLQueryValidator.validate_all(sql, allow_modifications=False)
```

## Enhanced Features

### Database Manager

#### Context Manager
```python
with DatabaseManager(connection_string) as db:
    result = db.execute_query("SELECT * FROM products")
    # Automatically closed
```

#### Transactions
```python
with db.transaction() as conn:
    conn.execute(text("INSERT INTO products VALUES (...)"))
    conn.execute(text("UPDATE inventory SET ..."))
    # Automatically committed or rolled back
```

#### Health Check
```python
health = db.health_check()
# Returns: {"status": "healthy", "connection_type": "sqlite", "tables": 5}
```

#### Retry Logic
```python
# Automatically retries on transient failures
result = db.execute_query(sql)  # Will retry up to 3 times
```

### File Uploader

#### Progress Tracking
```python
def progress_callback(message, percent):
    print(f"[{percent}%] {message}")

uploader.upload_file_to_db(
    file_path,
    progress_callback=progress_callback
)
```

#### Custom Validators
```python
from validators import FileValidator

custom_validator = FileValidator(
    max_size=100 * 1024 * 1024,  # 100MB
    supported_extensions=['.csv', '.xlsx']
)

uploader = FileUploader(db, file_validator=custom_validator)
```

### Analytics Agent

#### Context Manager
```python
with AnalyticsAgent(hf_token) as agent:
    result = agent.run_query("What are the top products?")
    # Automatically closed
```

#### Query Statistics
```python
stats = agent.get_query_stats()
print(f"Total queries: {stats['total_queries']}")
print(f"Average iterations: {stats['avg_iterations']}")
print(f"Most used tools: {stats['most_used_tools']}")
```

#### Error Handling
```python
from exceptions import MaxIterationsError, ModelAPIError

try:
    result = agent.run_query(query)
except MaxIterationsError:
    print("Query too complex, try breaking it down")
except ModelAPIError as e:
    print(f"API error: {e}")
```

## Configuration Options

### Database Configuration
```python
# In config.py or environment variables
database:
  pool_size: 5
  max_overflow: 10
  pool_timeout: 30
  pool_recycle: 3600
  max_retries: 3
  retry_delay: 1.0
```

### File Upload Configuration
```python
file_upload:
  max_file_size: 52428800  # 50MB
  max_batch_files: 20
  supported_extensions: ['.csv', '.xlsx', '.xls']
  max_columns: 1000
  max_rows: 1000000
```

### Agent Configuration
```python
agent:
  model_name: "Qwen/Qwen2.5-72B-Instruct"
  max_iterations: 10
  timeout: 300
  max_tokens: 1024
```

### Logging Configuration
```python
logging:
  log_level: "INFO"
  log_to_file: true
  log_file: "logs/rag_agent.log"
  max_log_size: 10485760  # 10MB
  backup_count: 5
```

## Common Patterns

### Error Handling
```python
from exceptions import (
    QueryExecutionError,
    FileValidationError,
    TableNotFoundError
)

try:
    result = db.execute_query(sql)
except TableNotFoundError as e:
    print(f"Table '{e.table_name}' not found")
except QueryExecutionError as e:
    print(f"Query failed: {e}")
    logger.error("Query execution failed", exc_info=True)
```

### Logging with Context
```python
from logging_config import create_context_logger

logger = create_context_logger(
    __name__,
    request_id="req-123",
    user_id="user-456"
)

logger.info("Processing request")
# Logs will include request_id and user_id
```

### Validation
```python
from validators import FileValidator, DataFrameValidator

# Validate file
file_validator = FileValidator()
file_validator.validate_all(file_path)

# Validate DataFrame
df_validator = DataFrameValidator()
df_validator.validate_all(df)
```

## Migration Examples

### Before Refactoring
```python
from database import DatabaseManager
from file_uploader import upload_file_to_database

db = DatabaseManager("sqlite:///mydb.db")
try:
    result = db.execute_query("SELECT * FROM products")
    print(result)
except Exception as e:
    print(f"Error: {e}")
finally:
    db.close()

upload_result = upload_file_to_database("data.csv")
if not upload_result.get("success"):
    print(f"Upload failed: {upload_result.get('error')}")
```

### After Refactoring
```python
from database import DatabaseManager
from file_uploader import FileUploader
from exceptions import QueryExecutionError, FileValidationError
from logging_config import get_logger

logger = get_logger(__name__)

# Use context manager
with DatabaseManager("sqlite:///mydb.db") as db:
    try:
        result = db.execute_query("SELECT * FROM products")
        logger.info(f"Retrieved {len(result)} products")
    except QueryExecutionError as e:
        logger.error("Query failed", exc_info=True)
        raise

    # Upload with progress tracking
    uploader = FileUploader(db)
    try:
        upload_result = uploader.upload_file_to_db(
            "data.csv",
            progress_callback=lambda msg, pct: print(f"{msg}: {pct}%")
        )
        logger.info(f"Uploaded {upload_result['rows_imported']} rows")
    except FileValidationError as e:
        logger.error(f"File validation failed: {e}")
        raise
```

## Environment Variables

Create a `.env` file:
```bash
# Database
DATABASE_URL=sqlite:///mydb.db

# HuggingFace
HF_TOKEN=your_token_here

# File Upload
MAX_FILE_SIZE=52428800

# Logging
LOG_LEVEL=INFO
ENVIRONMENT=development

# API
PORT=8000
DEBUG=false
```

## Troubleshooting

### Import Errors
```python
# Make sure src is in your path
import sys
sys.path.insert(0, 'src')

# Or use absolute imports
from src.database import DatabaseManager
```

### Configuration Errors
```python
from exceptions import MissingConfigurationError

try:
    config = get_agent_config()
except MissingConfigurationError as e:
    print(f"Missing config: {e.config_key}")
    # Set the required environment variable
```

### Logging Not Working
```python
# Initialize logging explicitly
from logging_config import setup_logging

logger = setup_logging(
    name=__name__,
    log_level="DEBUG",
    log_to_console=True
)
```

## Best Practices

1. **Always use context managers** for database and agent operations
2. **Handle specific exceptions** rather than catching all exceptions
3. **Use structured logging** with extra context
4. **Validate inputs** before processing
5. **Configure via environment variables** for different environments
6. **Monitor logs** for errors and performance issues
7. **Use type hints** for better IDE support and error detection

## Performance Tips

1. **Connection Pooling**: Adjust `pool_size` based on your workload
2. **Query Validation**: Disable for trusted queries to improve performance
3. **Logging Level**: Use INFO or WARNING in production
4. **File Streaming**: For very large files, consider streaming uploads
5. **Retry Logic**: Adjust `max_retries` and `retry_delay` for your network
