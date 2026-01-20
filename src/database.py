from sqlalchemy import create_engine, text, inspect
import os

class DatabaseManager:
    def __init__(self, connection_string="sqlite:///identifier.sqlite.db"):
        """
        Initialize with a connection string.
        Default is the local SQLite database.
        """
        # Ensure sqlite path is correct for SQLAlchemy if it's just a file name
        if connection_string.startswith("sqlite://") and not connection_string.startswith("sqlite:///"):
            connection_string = connection_string.replace("sqlite://", "sqlite:///")
        
        self.connection_string = connection_string
        self.engine = create_engine(connection_string)
        self.inspector = inspect(self.engine)

    def execute_query(self, sql: str) -> list[dict]:
        """Execute an SQL statement, returning the results as dicts."""
        print(f' - DB CALL: execute_query({sql})')
        try:
            with self.engine.connect() as connection:
                result = connection.execute(text(sql))
                if sql.strip().upper().startswith("SELECT") or sql.strip().upper().startswith("PRAGMA") or sql.strip().upper().startswith("SHOW") or sql.strip().upper().startswith("DESCRIBE"):
                    rows = result.fetchall()
                    return [dict(row._mapping) for row in rows]
                else:
                    connection.commit()
                    return [{"status": "success", "rows_affected": result.rowcount}]
        except Exception as e:
            return [{"error": str(e)}]

    def describe_table(self, table_name: str) -> list[tuple[str, str]]:
        """Look up the table schema using SQLAlchemy inspector."""
        print(f' - DB CALL: describe_table({table_name})')
        try:
            columns = self.inspector.get_columns(table_name)
            return [(col['name'], str(col['type'])) for col in columns]
        except Exception as e:
            print(f"Error describing table {table_name}: {e}")
            return []

    def list_tables(self) -> list[str]:
        """List all tables in the database."""
        try:
            return self.inspector.get_table_names()
        except Exception as e:
            print(f"Error listing tables: {e}")
            return []

    def load_dataframe(self, df, table_name: str):
        """Load a pandas DataFrame into a temporary table in the database."""
        print(f" - DB CALL: load_dataframe into {table_name}")
        try:
            df.to_sql(table_name, self.engine, if_exists='replace', index=False)
            self.inspector = inspect(self.engine) # Refresh inspector
            return True
        except Exception as e:
            print(f"Error loading dataframe: {e}")
            return False

    def close(self):
        """SQLAlchemy engine handles connection pooling, but we can dispose if needed."""
        self.engine.dispose()
