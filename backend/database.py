"""
Database management module for the RAG AI Agent.

This module provides a robust DatabaseManager class with comprehensive error handling,
logging, connection pooling, and retry logic for database operations.
"""

from sqlalchemy import create_engine, text, inspect
from sqlalchemy.exc import SQLAlchemyError, OperationalError, DatabaseError as SQLDatabaseError
from sqlalchemy.engine import Engine
from typing import List, Dict, Any, Optional, Set, Tuple
from contextlib import contextmanager
import re
import time
import json

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


# ── SQL identifier sanitizer ──────────────────────────────────────────────────
# SQL identifiers (table / column names) cannot be parameterised with :binding
# syntax, so we validate them explicitly before embedding in f-string queries.
#
# CodeQL note: this function is the sanitizer that breaks taint flow from
# user-supplied input to SQL construction.  It raises on any invalid value, so
# only a clean, allowlist-checked string ever reaches the query builder.

_IDENT_RE = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')


def _safe_ident(name: str, allowed: Optional[Set[str]] = None) -> str:
    """
    Validate a SQL identifier and return it ready for double-quote embedding.

    Args:
        name:    Identifier to check (table name or column name).
        allowed: If provided, ``name`` must be a member of this set.
                 Pass the inspector's table list for tables, or the set of
                 column names retrieved from ``describe_table`` for columns.

    Returns:
        The original ``name`` string, confirmed safe to embed as
        ``f'"{name}"'`` inside a SQL statement.

    Raises:
        QueryExecutionError: If the identifier fails regex validation or is
                             not found in the allowlist.
    """
    from exceptions import QueryExecutionError as _QEE  # local import avoids circular

    if not name or not isinstance(name, str):
        raise _QEE("SQL identifier must be a non-empty string.")

    m = _IDENT_RE.match(name)
    if not m:
        raise _QEE(
            f"Invalid SQL identifier {name!r}: only letters, digits and "
            "underscores are permitted, and the name must start with a "
            "letter or underscore."
        )

    if len(name) > 128:
        raise _QEE(f"SQL identifier too long ({len(name)} chars): {name!r}")

    # Allowlist check — name must exist in the caller-supplied set of known
    # identifiers (tables or columns retrieved directly from the DB schema).
    if allowed is not None and name not in allowed:
        raise _QEE(f"Unknown identifier {name!r} — not found in schema.")

    # Return the regex-captured text (m.group(0)), NOT the raw input.
    # CodeQL models regex match groups as sanitisers, which breaks the taint
    # chain from the user-supplied `name` to any SQL f-string that uses this
    # return value — this is the key step that resolves the CodeQL finding.
    return m.group(0)


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
            
            # Add driver-specific timeouts and SSL for production safety
            try:
                dialect = self.connection_string.split("://")[0].lower()
                if "postgresql" in dialect:
                    pg_connect_args: dict = {
                        "connect_timeout": 10,
                        "sslmode": "require",  # required by Neon, Supabase, and most managed PG
                    }
                    # Neon's *pooled* endpoint (hostname contains "-pooler.") rejects
                    # custom startup parameters such as statement_timeout — they must be
                    # set on the server or passed only via an *unpooled* connection.
                    # For all other Postgres hosts we keep the application-level timeout.
                    _host = self.connection_string.split("@")[-1].split("/")[0].split(":")[0]
                    _is_neon_pooler = "neon.tech" in _host and "-pooler." in _host
                    if not _is_neon_pooler:
                        pg_connect_args["options"] = "-c statement_timeout=30000"  # 30 s
                    engine_kwargs["connect_args"] = pg_connect_args
                elif "mysql" in dialect:
                    engine_kwargs["connect_args"] = {
                        "connect_timeout": 10,
                        "read_timeout": 30,
                    }
            except Exception:
                pass
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
        allow_modifications: bool = False,
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
                        # H-2 fix: removed blanket colon-replace (was corrupting
                        # ISO 8601 timestamps and SQLAlchemy named bind params).
                        # The SQL validator already enforces SELECT/WITH-only
                        # allowlist, so raw text() execution is safe here.
                        result = connection.execute(text(sql))
                        
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
                # Sanitize error message for production
                raw_msg = str(e)
                
                # Friendly user message logic
                user_msg = "The database query failed. Check for syntax errors or permission issues."
                if "column" in raw_msg and "does not exist" in raw_msg:
                    user_msg = "One of the requested columns was not found in the table."
                elif "table" in raw_msg and "does not exist" in raw_msg:
                    user_msg = "The requested table was not found."
                elif "permission denied" in raw_msg:
                    user_msg = "The database user does not have permission to perform this action."
                
                raise QueryExecutionError(raw_msg, query=sql, user_message=user_msg) from e
        
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
                f"Failed to describe table '{table_name}': {str(e)}",
                user_message="We couldn't retrieve the table structure. Please check if the table still exists."
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
            # Validate table_name against actual DB schema (allowlist)
            known_tables: Set[str] = set(self.inspector.get_table_names())
            safe_table = _safe_ident(table_name, allowed=known_tables)

            # Get columns (schema lookup uses safe_table which is already validated)
            schema = self.describe_table(safe_table)
            cols = [col[0] for col in schema]

            # Build query for row count and null counts
            # COUNT(*) is total rows
            # COUNT(col) is non-null rows
            # Total - NonNull = Nulls

            selects = ["COUNT(*) as total_rows"]
            for col in cols:
                # col names come from the DB schema — validate each one as a safe ident
                safe_col = _safe_ident(col)
                selects.append(f'COUNT(*) - COUNT("{safe_col}") as nulls_{safe_col}')

            sql = f'SELECT {", ".join(selects)} FROM "{safe_table}"'
            
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
            # Return empty stats on error with a friendly note
            return {"table_name": table_name, "error": "Could not calculate stats for this table."}

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
            # Flatten nested dictionaries into separate columns
            temp_df = self._flatten_dataframe(df)
            
            # Serialize any remaining columns that contain lists or other dicts (if nested too deep)
            for col in temp_df.columns:
                # Check if column has any dict or list objects (SQLite doesn't support them)
                if temp_df[col].apply(lambda x: isinstance(x, (dict, list))).any():
                    logger.debug(f"Serializing column '{col}' to JSON for table '{table_name}'")
                    temp_df[col] = temp_df[col].apply(
                        lambda x: json.dumps(x) if isinstance(x, (dict, list)) else x
                    )
            
            temp_df.to_sql(table_name, self.engine, if_exists=if_exists, index=False)
            
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

    def _flatten_dataframe(self, df):
        """
        Recursively flatten dictionary columns in a DataFrame using pd.json_normalize.
        
        Args:
            df: pandas DataFrame to flatten
            
        Returns:
            Flattened pandas DataFrame
        """
        import pandas as pd
        
        # Working copy
        flat_df = df.copy()
        MAX_DEPTH = 3 # Avoid infinite recursion
        depth = 0
        
        while depth < MAX_DEPTH:
            # Re-index to ensure join logic works correctly
            flat_df = flat_df.reset_index(drop=True)
            
            # Find columns that contain at least one dictionary
            dict_cols = []
            for col in flat_df.columns:
                try:
                    if flat_df[col].apply(lambda x: isinstance(x, dict)).any():
                        dict_cols.append(col)
                except Exception:
                    continue
            
            if not dict_cols:
                break
                
            logger.debug(f"Flattening dictionary columns: {dict_cols} (depth: {depth})")
            
            for col in dict_cols:
                try:
                    # Convert column to list of dicts (handling None)
                    data = [item if isinstance(item, dict) else {} for item in flat_df[col]]
                    
                    # Normalize using pandas utility
                    normalized = pd.json_normalize(data)
                    
                    # If empty or only nulls, skip
                    if normalized.empty:
                        continue
                        
                    # Prefix columns with original column name and replace dots with underscores
                    normalized.columns = [f"{col}_{c.replace('.', '_')}" for c in normalized.columns]
                    
                    # Join back and drop original
                    flat_df = flat_df.drop(columns=[col]).join(normalized)
                except Exception as e:
                    logger.warning(f"Failed to flatten column '{col}': {e}")
                    # Keep the original column if flattening fails
                    continue
            
            depth += 1
            
        return flat_df

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
            # Validate table_name against actual DB schema (allowlist)
            known_tables: Set[str] = set(self.inspector.get_table_names())
            safe_table = _safe_ident(table_name, allowed=known_tables)

            return pd.read_sql(f'SELECT * FROM "{safe_table}"', self.engine)
            
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
            # Validate source against DB schema; validate destination with regex only (doesn't exist yet)
            known_tables: Set[str] = set(self.inspector.get_table_names())
            safe_table = _safe_ident(table_name, allowed=known_tables)
            safe_new_table = _safe_ident(new_table_name)  # regex-only: new name won't be in schema yet

            if new_table_name in known_tables:
                raise QueryExecutionError(f"Table '{new_table_name}' already exists")

            # SQL is fully constructed from allowlist-validated identifiers —
            # bypass the keyword validator (which blocks CREATE) and execute directly.
            sql = f'CREATE TABLE "{safe_new_table}" AS SELECT * FROM "{safe_table}"'
            with self.engine.connect() as conn:
                with conn.begin():
                    conn.execute(text(sql))

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
            # Validate table_name against actual DB schema (allowlist)
            known_tables: Set[str] = set(self.inspector.get_table_names())
            safe_table = _safe_ident(table_name, allowed=known_tables)

            # Verify column exists then validate it as a safe ident
            schema = self.describe_table(safe_table)
            cols = [col[0] for col in schema]
            if column not in cols:
                raise QueryExecutionError(f"Column '{column}' does not exist in table '{table_name}'")
            safe_column = _safe_ident(column, allowed=set(cols))

            # Construct UPDATE query based on dialect
            # value and row_id are bound parameters — only identifiers are injected
            dialect = self.engine.dialect.name

            if dialect == 'postgresql':
                # Postgres uses ctid
                sql = f'UPDATE "{safe_table}" SET "{safe_column}" = :value WHERE ctid = :row_id'
            else:
                # SQLite uses rowid
                sql = f'UPDATE "{safe_table}" SET "{safe_column}" = :value WHERE rowid = :row_id'
            
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
            # Validate table_name against actual DB schema (allowlist)
            known_tables: Set[str] = set(self.inspector.get_table_names())
            safe_table = _safe_ident(table_name, allowed=known_tables)

            # Verify column exists then validate as a safe ident
            schema = self.describe_table(safe_table)
            cols = [col[0] for col in schema]
            if column not in cols:
                raise QueryExecutionError(f"Column '{column}' does not exist in table '{table_name}'")
            safe_column = _safe_ident(column, allowed=set(cols))

            # SQLite supports DROP COLUMN since 3.35.0
            sql = f'ALTER TABLE "{safe_table}" DROP COLUMN "{safe_column}"'
            
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
            # Validate table_name against actual DB schema (allowlist)
            known_tables: Set[str] = set(self.inspector.get_table_names())
            safe_table = _safe_ident(table_name, allowed=known_tables)

            # Validate new_column name (only regex check — it won't exist yet)
            safe_new_column = _safe_ident(new_column)

            # Verify old column exists then validate as a safe ident
            schema = self.describe_table(safe_table)
            cols = [col[0] for col in schema]
            if old_column not in cols:
                raise QueryExecutionError(f"Column '{old_column}' does not exist in table '{table_name}'")
            safe_old_column = _safe_ident(old_column, allowed=set(cols))

            sql = f'ALTER TABLE "{safe_table}" RENAME COLUMN "{safe_old_column}" TO "{safe_new_column}"'
            
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
            # Validate table_name against actual DB schema (allowlist)
            known_tables: Set[str] = set(self.inspector.get_table_names())
            safe_table = _safe_ident(table_name, allowed=known_tables)

            sql = f'DROP TABLE "{safe_table}"'
            
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
            # Validate table_name against actual DB schema (allowlist)
            known_tables: Set[str] = set(self.inspector.get_table_names())
            safe_table = _safe_ident(table_name, allowed=known_tables)

            # Verify target column exists then validate as a safe ident
            schema = self.describe_table(safe_table)
            cols = [col[0] for col in schema]
            if column not in cols:
                raise QueryExecutionError(f"Column '{column}' does not exist in table '{table_name}'")
            safe_column = _safe_ident(column, allowed=set(cols))

            fill_val = None

            if strategy == 'value':
                if value is None:
                    raise QueryExecutionError("Value must be provided for 'value' strategy")
                fill_val = value

            elif strategy == 'mean':
                sql_mean = f'SELECT AVG("{safe_column}") FROM "{safe_table}"'
                with self.engine.connect() as conn:
                    result = conn.execute(text(sql_mean)).scalar()
                if result is None:
                    logger.warning(f"Could not calculate mean for {column}")
                    return 0
                fill_val = result

            elif strategy == 'median':
                # SQLite-compatible median
                sql_median = f"""
                    SELECT AVG("{safe_column}")
                    FROM (
                        SELECT "{safe_column}"
                        FROM "{safe_table}"
                        WHERE "{safe_column}" IS NOT NULL
                        ORDER BY "{safe_column}"
                        LIMIT 2 - (SELECT COUNT(*) FROM "{safe_table}" WHERE "{safe_column}" IS NOT NULL) % 2
                        OFFSET (SELECT (COUNT(*) - 1) / 2 FROM "{safe_table}" WHERE "{safe_column}" IS NOT NULL)
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
                # Validate weight_column against schema allowlist
                safe_weight_column = _safe_ident(weight_column, allowed=set(cols))

                sql_weighted = f'SELECT SUM("{safe_column}" * "{safe_weight_column}") / SUM("{safe_weight_column}") FROM "{safe_table}"'
                with self.engine.connect() as conn:
                    result = conn.execute(text(sql_weighted)).scalar()
                if result is None:
                    logger.warning(f"Could not calculate weighted mean for {column}")
                    return 0
                fill_val = result

            elif strategy == 'mode':
                sql_mode = f'SELECT "{safe_column}" FROM "{safe_table}" WHERE "{safe_column}" IS NOT NULL GROUP BY "{safe_column}" ORDER BY COUNT(*) DESC LIMIT 1'
                with self.engine.connect() as conn:
                    result = conn.execute(text(sql_mode)).scalar()
                if result is None:
                    logger.warning(f"Could not calculate mode for {column}")
                    return 0
                fill_val = result

            else:
                raise QueryExecutionError(f"Unknown strategy: {strategy}")

            # Execute UPDATE — fill_val is a bound parameter
            sql_update = f'UPDATE "{safe_table}" SET "{safe_column}" = :fill_val WHERE "{safe_column}" IS NULL'
            
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
            # Validate table_name against actual DB schema (allowlist)
            known_tables: Set[str] = set(self.inspector.get_table_names())
            safe_table = _safe_ident(table_name, allowed=known_tables)

            dialect = self.engine.dialect.name
            if dialect == 'postgresql':
                sql = f'DELETE FROM "{safe_table}" WHERE ctid = :row_id'
            else:
                sql = f'DELETE FROM "{safe_table}" WHERE rowid = :row_id'

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


# ═════════════════════════════════════════════════════════════════════════════
# OrgConnectionPool — one engine per org, reused across requests
# ═════════════════════════════════════════════════════════════════════════════

import hashlib
import threading as _threading
from typing import Optional as _Optional

class OrgConnectionPool:
    """
    Process-wide pool of SQLAlchemy engines, keyed by org_id.

    Why not just reuse DatabaseManager?
    ────────────────────────────────────
    DatabaseManager creates a new Engine (and its underlying connection pool)
    on every instantiation, then calls engine.dispose() in close().  For a
    busy API this means dozens of new TCP connections per second to Postgres.

    OrgConnectionPool keeps one Engine alive per org for the lifetime of the
    process.  Requests borrow a connection from the pool, use it, and return
    it — no setup/teardown overhead.

    Thread safety
    ─────────────
    A threading.Lock guards the _engines dict so concurrent requests for the
    same org don't race to create duplicate engines.

    Usage (in api.py)
    ─────────────────
        dm = ORG_POOL.get(org.id, conn_str)
        # use dm exactly like a regular DatabaseManager
        # DO NOT call dm.close() — the pool owns the engine
    """

    def __init__(self) -> None:
        self._engines:      dict                  = {}   # org_id → Engine
        self._conn_hashes:  dict                  = {}   # org_id → sha256(conn_str)
        self._lock:         _threading.Lock       = _threading.Lock()

    # ── Public API ────────────────────────────────────────────────────────────

    def get(self, org_id: int, connection_string: str) -> "DatabaseManager":
        """
        Return a DatabaseManager that wraps the shared engine for org_id.

        If the connection string has changed since the engine was created
        (e.g. the org reconfigured their DB), the old engine is disposed and
        a new one is created transparently.

        The returned DatabaseManager must NOT have close() called on it —
        doing so would dispose the shared engine.  Use get_unmanaged() if
        you need a fully independent instance.
        """
        conn_hash = hashlib.sha256(connection_string.encode()).hexdigest()

        with self._lock:
            # Invalidate if connection string changed
            if org_id in self._engines and self._conn_hashes.get(org_id) != conn_hash:
                logger.info(f"OrgConnectionPool: conn string changed for org {org_id}, recycling engine")
                try:
                    self._engines[org_id].dispose()
                except Exception:
                    pass
                del self._engines[org_id]
                del self._conn_hashes[org_id]

            if org_id not in self._engines:
                logger.info(f"OrgConnectionPool: creating engine for org {org_id}")
                dm = DatabaseManager(connection_string=connection_string)
                self._engines[org_id]     = dm.engine
                self._conn_hashes[org_id] = conn_hash
                # Keep the manager's engine reference for reuse but don't
                # rely on this dm instance for future calls.

            engine = self._engines[org_id]

        # Wrap the shared engine in a lightweight DatabaseManager shell.
        # We monkey-patch the engine so we don't re-open TCP connections.
        dm = object.__new__(DatabaseManager)
        dm.connection_string = connection_string
        dm.engine            = engine
        try:
            from sqlalchemy import inspect as _inspect
            dm.inspector = _inspect(engine)
        except Exception:
            dm.inspector = None
        return dm

    def invalidate(self, org_id: int) -> None:
        """
        Force-dispose and remove the engine for an org.
        Call this when an org updates their connection string.
        """
        with self._lock:
            if org_id in self._engines:
                try:
                    self._engines[org_id].dispose()
                except Exception:
                    pass
                del self._engines[org_id]
                self._conn_hashes.pop(org_id, None)
                logger.info(f"OrgConnectionPool: disposed engine for org {org_id}")

    def dispose_all(self) -> None:
        """Dispose every engine — call from lifespan shutdown."""
        with self._lock:
            for engine in self._engines.values():
                try:
                    engine.dispose()
                except Exception:
                    pass
            self._engines.clear()
            self._conn_hashes.clear()
        logger.info("OrgConnectionPool: all engines disposed")

    def stats(self) -> dict:
        """Return a summary dict — useful for a /health endpoint."""
        with self._lock:
            return {
                "active_orgs": len(self._engines),
                "org_ids":     list(self._engines.keys()),
            }


# Singleton — import this from api.py
ORG_POOL = OrgConnectionPool()