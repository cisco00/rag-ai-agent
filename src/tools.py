from database import DatabaseManager

def get_db_tools(db: DatabaseManager):
    """
    Returns a dictionary of tool functions and their JSON schemas for Hugging Face.
    """
    
    # Define schemas
    tools_schema = [
        {
            "type": "function",
            "function": {
                "name": "list_tables",
                "description": "List all tables in the database.",
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
                "description": "Look up the table schema.",
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
                "description": "Execute an SQL statement, returning the results.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "sql": {
                            "type": "string",
                            "description": "The SQL query to execute."
                        }
                    },
                    "required": ["sql"]
                }
            }
        }
    ]

    # Map names to functions
    tool_map = {
        "list_tables": db.list_tables,
        "describe_table": db.describe_table,
        "execute_query": db.execute_query
    }

    return tools_schema, tool_map
