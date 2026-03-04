"""
Database tools for the Analytics Agent.

This module provides tool definitions and mappings for the agent to interact
with databases through function calling.
"""

from typing import Dict, List, Tuple, Any, Optional
from typing import Dict, List, Tuple, Any, Optional
from database import DatabaseManager
from analytics import calculate_correlation
from logging_config import get_logger

# Initialize logger
logger = get_logger(__name__)


def get_db_tools(db: DatabaseManager, tables: Optional[List[str]] = None) -> Tuple[List[Dict], Dict[str, Any]]:
    """
    Returns tool schemas and function mappings for database operations.
    
    Args:
        db: DatabaseManager instance
        tables: Optional list of tables to restrict the agent to.
    
    Returns:
        Tuple of (tools_schema, tool_map)
        - tools_schema: List of tool definitions for the AI model
        - tool_map: Dictionary mapping tool names to functions
    """
    logger.debug(f"Creating database tools (restricted tables: {tables})")
    
    # Define tool schemas for the AI model
    tools_schema = [
        {
            "type": "function",
            "function": {
                "name": "list_tables",
                "description": (
                    "List all tables in the database. "
                    "Use this to discover what data is available before querying."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {},
                    "required": []
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "describe_table",
                "description": (
                    "Get the schema of a specific table, including column names and types. "
                    "Use this to understand the structure of a table before writing queries."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "table_name": {
                            "type": "string",
                            "description": "The name of the table to describe."
                        }
                    },
                    "required": ["table_name"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "execute_query",
                "description": (
                    "Execute a SQL query and return the results. "
                    "Use this to retrieve data from the database. "
                    "Always use SELECT queries for data retrieval. "
                    "Note: Results are limited to 200 rows to prevent context overflow."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "sql": {
                            "type": "string",
                            "description": (
                                "The SQL query to execute. "
                                "Should be a valid SQL statement for the database type."
                            )
                        }
                    },
                    "required": ["sql"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "calculate_correlation",
                "description": (
                    "Calculate the correlation matrix between numeric columns in a table. "
                    "Use this when the user asks about relationships or correlations between variables."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "table_name": {
                            "type": "string",
                            "description": "The name of the table to analyze."
                        },
                        "columns": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Optional list of columns to include. If omitted, all numeric columns are used."
                        },
                        "method": {
                            "type": "string",
                            "enum": ["pearson", "spearman", "kendall"],
                            "description": "Correlation method. Default is 'pearson'."
                        }
                    },
                    "required": ["table_name"]
                }
            }
        }
    ]
    
    # Create wrapper functions with logging
    def list_tables_with_logging():
        """List all tables with logging."""
        logger.info("Tool called: list_tables")
        try:
            result = db.list_tables()
            if tables:
                # Filter results to only include allowed tables
                result = [t for t in result if t in tables]
            logger.debug(f"list_tables returned {len(result)} tables")
            return result
        except Exception as e:
            logger.error(f"list_tables failed: {e}", exc_info=True)
            raise
    
    def describe_table_with_logging(table_name: str):
        """Describe table with logging."""
        logger.info(f"Tool called: describe_table(table_name={table_name})")
        
        # Check if table is allowed
        if tables and table_name not in tables:
            error_msg = f"Table '{table_name}' is not in the list of allowed tables: {tables}"
            logger.warning(error_msg)
            return {"error": error_msg}

        try:
            result = db.describe_table(table_name)
            logger.debug(f"describe_table returned {len(result)} columns")
            return result
        except Exception as e:
            logger.error(
                f"describe_table failed for table '{table_name}': {e}",
                exc_info=True
            )
            raise
    
    def execute_query_with_logging(sql: str):
        """Execute query with logging."""
        logger.info(f"Tool called: execute_query(sql={sql[:100]}...)")
        try:
            # Enforce 200 row limit for agent tool calls
            result = db.execute_query(sql, max_rows=200)
            logger.debug(f"execute_query returned {len(result)} rows")
            return result
        except Exception as e:
            logger.error(f"execute_query failed: {e}", exc_info=True)
            raise

    def calculate_correlation_with_logging(table_name: str, columns: Optional[List[str]] = None, method: str = 'pearson'):
        """Calculate correlation with logging."""
        logger.info(f"Tool called: calculate_correlation(table={table_name}, method={method})")
        
        # Check if table is allowed
        if tables and table_name not in tables:
             error_msg = f"Table '{table_name}' is not in the list of allowed tables: {tables}"
             logger.warning(error_msg)
             return {"error": error_msg}

        try:
            # Need to get dataframe first
            df = db.get_table_data(table_name)
            result = calculate_correlation(df, columns, method)
            
            # Format for LLM if it's a valid result (add simple text summary if needed)
            if "error" not in result:
                logger.info("Correlation calculation successful")
            
            return result
        except Exception as e:
            logger.error(f"calculate_correlation failed: {e}", exc_info=True)
            raise
    
    # Map tool names to functions
    tool_map = {
        "list_tables": list_tables_with_logging,
        "describe_table": describe_table_with_logging,
        "execute_query": execute_query_with_logging,
        "calculate_correlation": calculate_correlation_with_logging
    }
    
    logger.debug(f"Created {len(tools_schema)} database tools")
    
    return tools_schema, tool_map


def validate_tool_call(tool_name: str, arguments: Dict[str, Any]) -> None:
    """
    Validate tool call arguments.
    
    Args:
        tool_name: Name of the tool being called
        arguments: Arguments passed to the tool
    
    Raises:
        ValueError: If validation fails
    """
    if tool_name == "describe_table":
        if "table_name" not in arguments:
            raise ValueError("describe_table requires 'table_name' argument")
        if not isinstance(arguments["table_name"], str):
            raise ValueError("table_name must be a string")
    
    elif tool_name == "execute_query":
        if "sql" not in arguments:
            raise ValueError("execute_query requires 'sql' argument")
        if not isinstance(arguments["sql"], str):
            raise ValueError("sql must be a string")
        if not arguments["sql"].strip():
            raise ValueError("sql cannot be empty")
    
    elif tool_name == "list_tables":
        # No arguments required
        pass
    
    else:
        raise ValueError(f"Unknown tool: {tool_name}")
