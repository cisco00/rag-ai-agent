"""
Database management module for the RAG AI Agent.

This module provides a robust DatabaseManager class with comprehensive error handling,
logging, connection pooling, and retry logic for database operations.
"""

from sqlalchemy import create_engine, text, inspect
from sqlalchemy.exc import SQLAlchemyError, OperationalError, DatabaseError as SQLDatabaseError
from sqlalchemy.engine import Engine
from typing import List, Dict, Any, Optional, Tuple
from contextlib import contextmanager
import time

from exceptions import (
    ConnectionError,
    QueryExecutionError,
    TableNotFoundError,
    InvalidConnectionStringError
)
from logging_config import get_logger
from config import get_db_config
from validators import ConnectionStringValidator, SQLQueryValidator

# Initialize logger
logger = get_logger(__name__)


class DatabaseManager:
    """
    Manages database connections and operations with robust error handling.
    
    Features:
    - Connection pooling with configurable settings
    - Automatic retry logic for transient failures
    - Comprehensive logging
    - Query validation and sanitization
    - Type-safe operations
    """
    
    def __init__(self, connection_string: Optional[str] = None):
        """
        Initialize DatabaseManager with a connection string.
        
        Args:
            connection_string: Database connection string (uses default if None)
        
        Raises:
            ConnectionError: If database connection fails
            InvalidConnectionStringError: If connection string is invalid
        """
        # Get configuration
        config = get_db_config()
        
        # Use provided connection string or default
        self.connection_string = connection_string or config.default_connection_string
        
        # Validate connection string
        try:
            ConnectionStringValidator.validate(self.connection_string)
        except Exception as e:
            logger.error(f"Invalid connection string: {e}")
            raise
        
        # Ensure sqlite path is correct for SQLAlchemy
        if self.connection_string.startswith("sqlite://") and not self.connection_string.startswith("sqlite:///"):
            self.connection_string = self.connection_string.replace("sqlite://", "sqlite:///")
        
        logger.info(
            "Initializing database connection",
            extra={"connection_type": self.connection_string.split("://")[0]}
        )
        
        # Create engine with connection pooling
        try:
            self.engine = self._create_engine(config)
            self.inspector = inspect(self.engine)
            logger.info("Database connection established successfully")
        except Exception as e:
            logger.error(f"Failed to establish database connection: {e}", exc_info=True)
            raise ConnectionError(
                f"Failed to connect to database: {str(e)}",
                connection_string=self.connection_string
            ) from e
    
    def _create_engine(self, config) -> Engine:
        """
        Create SQLAlchemy engine with configuration.
        
        Args:
            config: Database configuration
        
        Returns:
            Configured SQLAlchemy engine
        """
        engine_kwargs = {
            "pool_pre_ping": config.pool_pre_ping,
            "pool_recycle": config.pool_recycle,
        }
        
        from sqlalchemy.pool import NullPool
        
        if not self.connection_string.startswith("sqlite"):
            engine_kwargs.update({
                "pool_size": config.pool_size,
                "max_overflow": config.max_overflow,
                "pool_timeout": config.pool_timeout,
            }) 
        else:
            # SQLite-specific settings
            engine_kwargs["connect_args"] = {"check_same_thread": False}
        
        engine = create_engine(self.connection_string, **engine_kwargs)
        
        # Test connection
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        
        return engine
    
    def get_engine(self) -> Engine:
        """
        Get the SQLAlchemy engine.
        
        Returns:
            SQLAlchemy engine
        """
        return self.engine
    
    def _execute_with_retry(self, operation, max_retries: Optional[int] = None):
        """
        Execute an operation with retry logic for transient failures.
        
        Args:
            operation: Callable to execute
            max_retries: Maximum number of retries (uses config default if None)
        
        Returns:
            Result of the operation
        
        Raises:
            Exception: If all retries are exhausted
        """
        config = get_db_config()
        max_retries = max_retries or config.max_retries
        retry_delay = config.retry_delay
        
        last_exception = None
        
        for attempt in range(max_retries + 1):
            try:
                return operation()
            except OperationalError as e:
                last_exception = e
                if attempt < max_retries:
                    wait_time = retry_delay * (config.retry_backoff ** attempt)
                    logger.warning(
                        f"Database operation failed, retrying in {wait_time}s "
                        f"(attempt {attempt + 1}/{max_retries})",
                        extra={"attempt": attempt + 1, "wait_time": wait_time}
                    )
                    time.sleep(wait_time)
                else:
                    logger.error(
                        f"Database operation failed after {max_retries} retries",
                        exc_info=True
                    )
        
        raise last_exception
    
    def execute_query(
        self,
        sql: str,
        validate: bool = True,
        allow_modifications: bool = True,
        max_rows: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """
        Execute an SQL statement and return results as dictionaries.
        
        Args:
            sql: SQL query to execute
            validate: Whether to validate the query
            allow_modifications: Whether to allow modification queries
            max_rows: Optional maximum number of rows to return
        
        Returns:
            List of dictionaries representing query results
        
        Raises:
            QueryExecutionError: If query execution fails
        """
        # Validate query if requested
        if validate:
            try:
                SQLQueryValidator.validate_all(sql, allow_modifications=allow_modifications)
            except Exception as e:
                logger.error(f"Query validation failed: {e}", extra={"query": sql[:100]})
                raise
        
        logger.info(
            "Executing query",
            extra={
                "query_preview": sql[:100],
                "query_length": len(sql),
                "max_rows": max_rows
            }
        )
        
        def _execute():
            try:
                with self.engine.connect() as connection:
                    # Start explicit transaction to ensure clean state
                    with connection.begin():
                        # Escape colons in the SQL that aren't bind parameters.
                        safe_sql = sql.replace(":", "\\:")
                        result = connection.execute(text(safe_sql))
                        
                        # Check if query returns results
                        query_type = sql.strip().upper().split()[0]
                        if query_type in ["SELECT", "PRAGMA", "SHOW", "DESCRIBE"]:
                            if max_rows:
                                rows = result.fetchmany(max_rows)
                            else:
                                rows = result.fetchall()
                                
                            data = [dict(row._mapping) for row in rows]
                            logger.info(
                                "Query executed successfully",
                                extra={"rows_returned": len(data), "max_rows": max_rows}
                            )
                            return data
                        else:
                            # For modification queries, execution is passed, commit happens at block exit
                            logger.info(
                                "Query executed successfully",
                                extra={"rows_affected": result.rowcount}
                            )
                            return [{
                                "status": "success",
                                "rows_affected": result.rowcount
                            }]
            
            except SQLAlchemyError as e:
                error_msg = f"Query execution failed: {str(e)}"
                logger.error(
                    error_msg,
                    exc_info=True,
                    extra={"query": sql[:200]}
                )
                raise QueryExecutionError(error_msg, query=sql) from e
        
        try:
            return self._execute_with_retry(_execute)
        except QueryExecutionError:
            raise
        except Exception as e:
            # Wrap any other exceptions
            raise QueryExecutionError(
                f"Unexpected error during query execution: {str(e)}",
                query=sql
            ) from e
    
    def describe_table(self, table_name: str) -> List[Tuple[str, str]]:
        """
        Get the schema of a table.
        
        Args:
            table_name: Name of the table to describe
        
        Returns:
            List of tuples containing (column_name, column_type)
        
        Raises:
            TableNotFoundError: If table does not exist
        """
        logger.info(f"Describing table: {table_name}")
        
        try:
            # Check if table exists
            if table_name not in self.inspector.get_table_names():
                raise TableNotFoundError(table_name)
            
            columns = self.inspector.get_columns(table_name)
            schema = [(col['name'], str(col['type'])) for col in columns]
            
            logger.info(
                f"Table schema retrieved",
                extra={
                    "table": table_name,
                    "columns": len(schema)
                }
            )
            
            return schema
        
        except TableNotFoundError:
            raise
        except Exception as e:
            logger.error(
                f"Error describing table {table_name}: {e}",
                exc_info=True
            )
            raise QueryExecutionError(
                f"Failed to describe table '{table_name}': {str(e)}"
            ) from e
    
    def get_table_stats(self, table_name: str) -> Dict[str, Any]:
        """
        Get statistics for a table (row count, null counts).
        
        Args:
            table_name: Table name
            
        Returns:
            Dictionary with stats
        """
        try:
            from validators import TableNameValidator
            TableNameValidator.validate(table_name)
            
            # Get columns
            schema = self.describe_table(table_name)
            cols = [col[0] for col in schema]
            
            # Build query for row count and null counts
            # COUNT(*) is total rows
            # COUNT(col) is non-null rows
            # Total - NonNull = Nulls
            
            selects = ["COUNT(*) as total_rows"]
            for col in cols:
                selects.append(f"COUNT(*) - COUNT({col}) as nulls_{col}")
                
            sql = f"SELECT {', '.join(selects)} FROM {table_name}"
            
            with self.engine.connect() as conn:
                # Start explicit transaction
                with conn.begin():
                    result = conn.execute(text(sql)).fetchone()
                
            if not result:
                return {"table_name": table_name, "total_rows": 0, "missing_values": {}}
                
            # Parse result
            # result index 0 is total_rows
            # index i+1 is nulls for cols[i]
            
            stats = {
                "table_name": table_name,
                "total_rows": result[0],
                "columns": len(cols),
                "missing_values": {}
            }
            
            total_missing = 0
            for i, col in enumerate(cols):
                null_count = result[i+1]
                if null_count > 0:
                    stats["missing_values"][col] = null_count
                    total_missing += null_count
            
            stats["total_missing"] = total_missing
            return stats
            
        except Exception as e:
            logger.error(f"Error getting stats for {table_name}: {e}", exc_info=True)
            # Return empty stats on error rather than crashing the whole overview
            return {"table_name": table_name, "error": str(e)}

    def list_tables(self) -> List[str]:
        """
        List all tables in the database.
        
        Returns:
            List of table names
        
        Raises:
            QueryExecutionError: If operation fails
        """
        logger.info("Listing database tables")
        
        try:
            tables = self.inspector.get_table_names()
            logger.info(f"Found {len(tables)} tables")
            return tables
        except Exception as e:
            logger.error(f"Error listing tables: {e}", exc_info=True)
            raise QueryExecutionError(
                f"Failed to list tables: {str(e)}"
            ) from e
    
    def load_dataframe(
        self,
        df,
        table_name: str,
        if_exists: str = 'replace'
    ) -> bool:
        """
        Load a pandas DataFrame into a database table.
        
        Args:
            df: pandas DataFrame to load
            table_name: Name of the table to create/update
            if_exists: How to behave if table exists: 'fail', 'replace', or 'append'
        
        Returns:
            True if successful
        
        Raises:
            QueryExecutionError: If operation fails
        """
        logger.info(
            f"Loading DataFrame into table: {table_name}",
            extra={
                "table": table_name,
                "rows": len(df),
                "columns": len(df.columns),
                "if_exists": if_exists
            }
        )
        
        try:
            df.to_sql(table_name, self.engine, if_exists=if_exists, index=False)
            
            # Refresh inspector to pick up new table
            self.inspector = inspect(self.engine)
            
            logger.info(
                f"DataFrame loaded successfully into {table_name}",
                extra={
                    "table": table_name,
                    "rows": len(df)
                }
            )
            
            return True
        
        except Exception as e:
            logger.error(
                f"Error loading DataFrame into {table_name}: {e}",
                exc_info=True
            )
            raise QueryExecutionError(
                f"Failed to load DataFrame into table '{table_name}': {str(e)}"
            ) from e

    def get_table_data(self, table_name: str) -> Any:
        """
        Get all data from a table as a pandas DataFrame.
        
        Args:
            table_name: Table name
            
        Returns:
            pandas DataFrame
        """
        logger.info(f"Fetching data from table: {table_name}")
        try:
            import pandas as pd
            from validators import TableNameValidator
            TableNameValidator.validate(table_name)
            
            # Check if table exists
            if table_name not in self.list_tables():
                raise TableNotFoundError(table_name)
                
            return pd.read_sql(f"SELECT * FROM {table_name}", self.engine)
            
        except Exception as e:
            logger.error(f"Error fetching table data: {e}", exc_info=True)
            raise QueryExecutionError(f"Failed to fetch table data: {str(e)}") from e
    
    @contextmanager
    def transaction(self):
        """
        Context manager for database transactions.
        
        Usage:
            with db.transaction() as conn:
                conn.execute(text("INSERT ..."))
                conn.execute(text("UPDATE ..."))
        
        Yields:
            Database connection
        """
        connection = self.engine.connect()
        transaction = connection.begin()
        
        try:
            logger.debug("Starting transaction")
            yield connection
            transaction.commit()
            logger.debug("Transaction committed")
        except Exception as e:
            transaction.rollback()
            logger.error("Transaction rolled back", exc_info=True)
            raise
        finally:
            connection.close()
    
    def health_check(self) -> Dict[str, Any]:
        """
        Check database connection health.
        
        Returns:
            Dictionary with health status information
        """
        try:
            with self.engine.connect() as conn:
                with conn.begin():
                    conn.execute(text("SELECT 1"))
            
            return {
                "status": "healthy",
                "connection_type": self.connection_string.split("://")[0],
                "tables": len(self.list_tables())
            }
        except Exception as e:
            logger.error(f"Health check failed: {e}", exc_info=True)
            return {
                "status": "unhealthy",
                "error": str(e)
            }
    
    def close(self):
        """
        Close database connection and dispose of connection pool.
        """
        logger.info("Closing database connection")
        try:
            self.engine.dispose()
            logger.info("Database connection closed successfully")
        except Exception as e:
            logger.error(f"Error closing database connection: {e}", exc_info=True)
    
    def duplicate_table(self, table_name: str, new_table_name: str) -> None:
        """
        Duplicate an existing table.
        
        Args:
            table_name: Source table name
            new_table_name: Destination table name
        
        Raises:
            TableNotFoundError: If source table doesn't exist
            InvalidRequestError: If table names are invalid
            QueryExecutionError: If duplication fails
        """
        logger.info(f"Duplicating table {table_name} to {new_table_name}")
        
        try:
            # Validate table names
            from validators import TableNameValidator
            TableNameValidator.validate(table_name)
            TableNameValidator.validate(new_table_name)
            
            # Check if source table exists
            existing_tables = self.list_tables()
            if table_name not in existing_tables:
                raise TableNotFoundError(table_name)
                
            if new_table_name in existing_tables:
                raise QueryExecutionError(f"Table '{new_table_name}' already exists")
            
            # Create copy
            # Use safe interpolation since we validated table names
            sql = f"CREATE TABLE {new_table_name} AS SELECT * FROM {table_name}"
            
            self.execute_query(sql, validate=True, allow_modifications=True)
            
            # Refresh inspector
            self.inspector = inspect(self.engine)
            
            logger.info(f"Table duplicated successfully: {new_table_name}")
            
        except Exception as e:
            logger.error(f"Error duplicating table: {e}", exc_info=True)
            raise QueryExecutionError(f"Failed to duplicate table: {str(e)}") from e

    def update_cell_value(self, table_name: str, row_id: Any, column: str, value: Any) -> bool:
        """
        Update a single cell value.
        
        Args:
            table_name: Table to update
            row_id: Row identifier (rowid for SQLite)
            column: Column name
            value: New value
            
        Returns:
            True if successful
        """
        logger.info(f"Updating cell in {table_name}: row={row_id}, col={column}")
        
        try:
            from validators import TableNameValidator
            TableNameValidator.validate(table_name)
            
            # Verify column exists
            schema = self.describe_table(table_name)
            cols = [col[0] for col in schema]
            if column not in cols:
                raise QueryExecutionError(f"Column '{column}' does not exist in table '{table_name}'")
            
            # Construct UPDATE query
            # We use rowid for SQLite which is what our file uploads use
            # Note: We can't easily validate column name with a regex as strictly as table names 
            # (they might contain spaces if imported from weird CSVs, though our import cleans them),
            # but usually they match simple patterns.
            # Using parameter binding for value and row_id is safe. 
            # Column name must be injected, but we verified it exists in schema.
            
            # Construct UPDATE/DELETE query based on dialect
            dialect = self.engine.dialect.name
            
            if dialect == 'postgresql':
                 # Postgres uses ctid
                 # row_id should be string 'TID(block,offset)' but we passed it as string from api.py
                 sql = f"UPDATE {table_name} SET {column} = :value WHERE ctid = :row_id"
            else:
                 # SQLite uses rowid
                 sql = f"UPDATE {table_name} SET {column} = :value WHERE rowid = :row_id"
            
            with self.engine.connect() as conn:
                with conn.begin():
                    result = conn.execute(text(sql), {"value": value, "row_id": row_id})
                    
                    if result.rowcount == 0:
                        logger.warning(f"No rows updated for {table_name} row {row_id}")
                        return False
                
            return True

        except Exception as e:
            logger.error(f"Error updating cell: {e}", exc_info=True)
            raise QueryExecutionError(f"Failed to update cell: {str(e)}") from e

    def drop_column(self, table_name: str, column: str) -> bool:
        """
        Drop a column from a table.
        
        Args:
            table_name: Table name
            column: Column to drop
            
        Returns:
            True if successful
        """
        logger.info(f"Dropping column {column} from {table_name}")
        try:
            from validators import TableNameValidator
            TableNameValidator.validate(table_name)
            
            # Verify column exists
            schema = self.describe_table(table_name)
            cols = [col[0] for col in schema]
            if column not in cols:
                raise QueryExecutionError(f"Column '{column}' does not exist in table '{table_name}'")
            
            # SQLite supports DROP COLUMN since 3.35.0
            sql = f"ALTER TABLE {table_name} DROP COLUMN {column}"
            
            with self.engine.connect() as conn:
                with conn.begin():
                   conn.execute(text(sql))
            
            # Refresh inspector
            self.inspector = inspect(self.engine)
            return True
        except Exception as e:
            logger.error(f"Error dropping column: {e}", exc_info=True)
            raise QueryExecutionError(f"Failed to drop column: {str(e)}") from e

    def rename_column(self, table_name: str, old_column: str, new_column: str) -> bool:
        """
        Rename a column.
        
        Args:
            table_name: Table name
            old_column: Current column name
            new_column: New column name
            
        Returns:
            True if successful
        """
        logger.info(f"Renaming column {old_column} to {new_column} in {table_name}")
        try:
            from validators import TableNameValidator
            TableNameValidator.validate(table_name)
            
            # Simple validation for new column name
            if not new_column.isidentifier():
                 raise QueryExecutionError(f"Invalid new column name: {new_column}")
            
            # Verify old column exists
            schema = self.describe_table(table_name)
            cols = [col[0] for col in schema]
            if old_column not in cols:
                raise QueryExecutionError(f"Column '{old_column}' does not exist in table '{table_name}'")
                
            sql = f"ALTER TABLE {table_name} RENAME COLUMN {old_column} TO {new_column}"
            
            with self.engine.connect() as conn:
                with conn.begin():
                   conn.execute(text(sql))
            return True
        except Exception as e:
            logger.error(f"Error renaming column: {e}", exc_info=True)
            raise QueryExecutionError(f"Failed to rename column: {str(e)}") from e

    def drop_table(self, table_name: str) -> bool:
        """
        Delete a table from the database.
        
        Args:
            table_name: Table to delete
            
        Returns:
            True if successful
        """
        logger.info(f"Dropping table {table_name}")
        try:
            from validators import TableNameValidator
            TableNameValidator.validate(table_name)
            
            # Use execute_query for consistency
            sql = f"DROP TABLE {table_name}"
            
            with self.engine.connect() as conn:
                with conn.begin():
                   conn.execute(text(sql))
            
            # Refresh inspector
            self.inspector = inspect(self.engine)
            return True
        except Exception as e:
            logger.error(f"Error dropping table {table_name}: {e}", exc_info=True)
            raise QueryExecutionError(f"Failed to drop table: {str(e)}") from e

    def fill_missing_values(self, table_name: str, column: str, strategy: str, value: Any = None, weight_column: str = None) -> int:
        """
        Fill missing values in a column.
        
        Args:
            table_name: Table name
            column: Column name
            strategy: 'value', 'mean', 'median', 'mode', 'weighted_mean'
            value: Specific value to use if strategy is 'value'
            weight_column: Column to use as weights for 'weighted_mean'
            
        Returns:
            Number of rows updated
        """
        logger.info(f"Filling missing values in {table_name}.{column} using {strategy}")
        try:
            from validators import TableNameValidator
            TableNameValidator.validate(table_name)
            
            # Verify column exists
            schema = self.describe_table(table_name)
            cols = [col[0] for col in schema]
            if column not in cols:
                raise QueryExecutionError(f"Column '{column}' does not exist in table '{table_name}'")
            
            fill_val = None
            
            if strategy == 'value':
                if value is None:
                    raise QueryExecutionError("Value must be provided for 'value' strategy")
                fill_val = value
                
            elif strategy == 'mean':
                # Calculate mean
                sql_mean = f"SELECT AVG({column}) FROM {table_name}"
                with self.engine.connect() as conn:
                    result = conn.execute(text(sql_mean)).scalar()
                if result is None:
                    logger.warning(f"Could not calculate mean for {column}")
                    return 0
                fill_val = result
                
            elif strategy == 'median':
                # Calculate median (SQLite compatible)
                sql_median = f"""
                    SELECT AVG({column})
                    FROM (
                        SELECT {column}
                        FROM {table_name}
                        WHERE {column} IS NOT NULL
                        ORDER BY {column}
                        LIMIT 2 - (SELECT COUNT(*) FROM {table_name} WHERE {column} IS NOT NULL) % 2
                        OFFSET (SELECT (COUNT(*) - 1) / 2 FROM {table_name} WHERE {column} IS NOT NULL)
                    )
                """
                with self.engine.connect() as conn:
                    result = conn.execute(text(sql_median)).scalar()
                if result is None:
                    logger.warning(f"Could not calculate median for {column}")
                    return 0
                fill_val = result

            elif strategy == 'weighted_mean':
                if not weight_column:
                    raise QueryExecutionError("Weight column must be provided for 'weighted_mean' strategy")
                if weight_column not in cols:
                    raise QueryExecutionError(f"Weight column '{weight_column}' does not exist")

                # Calculate weighted mean: SUM(col * weight) / SUM(weight)
                sql_weighted = f"SELECT SUM({column} * {weight_column}) / SUM({weight_column}) FROM {table_name}"
                with self.engine.connect() as conn:
                    result = conn.execute(text(sql_weighted)).scalar()
                if result is None:
                    logger.warning(f"Could not calculate weighted mean for {column}")
                    return 0
                fill_val = result

            elif strategy == 'mode':
                # Calculate mode
                sql_mode = f"SELECT {column} FROM {table_name} WHERE {column} IS NOT NULL GROUP BY {column} ORDER BY COUNT(*) DESC LIMIT 1"
                with self.engine.connect() as conn:
                    result = conn.execute(text(sql_mode)).scalar()
                if result is None:
                     logger.warning(f"Could not calculate mode for {column}")
                     return 0
                fill_val = result
                
            else:
                raise QueryExecutionError(f"Unknown strategy: {strategy}")
            
            # Execute Update
            sql_update = f"UPDATE {table_name} SET {column} = :fill_val WHERE {column} IS NULL"
            
            with self.engine.connect() as conn:
                result = conn.execute(text(sql_update), {"fill_val": fill_val})
                conn.commit()
                return result.rowcount
                
        except Exception as e:
            logger.error(f"Error filling missing values: {e}", exc_info=True)
            raise QueryExecutionError(f"Failed to fill missing values: {str(e)}") from e

    def delete_row(self, table_name: str, row_id: Any) -> bool:
        """
        Delete a row by ID.
        
        Args:
            table_name: Table name
            row_id: Row identifier
            
        Returns:
            True if successful
        """
        logger.info(f"Deleting row {row_id} from {table_name}")
        try:
            from validators import TableNameValidator
            TableNameValidator.validate(table_name)
            
            dialect = self.engine.dialect.name
            if dialect == 'postgresql':
                 sql = f"DELETE FROM {table_name} WHERE ctid = :row_id"
            else:
                 sql = f"DELETE FROM {table_name} WHERE rowid = :row_id"
            
            with self.engine.connect() as conn:
                with conn.begin():
                    result = conn.execute(text(sql), {"row_id": row_id})
                    return result.rowcount > 0
        except Exception as e:
            logger.error(f"Error deleting row: {e}", exc_info=True)
            raise QueryExecutionError(f"Failed to delete row: {str(e)}") from e

    def __enter__(self):
        """Context manager entry."""
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit."""
        self.close()
        return False
