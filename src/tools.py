from database import DatabaseManager

def get_db_tools(db: DatabaseManager):
    """
    Returns a list of tools (functions) that the GenAI model can use.
    These functions are bound to the provided DatabaseManager instance.
    """
    return [
        db.list_tables,
        db.describe_table,
        db.execute_query
    ]
