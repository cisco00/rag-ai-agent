"""
Validation utilities for the RAG AI Agent application.

This module provides validators for files, database connections, queries,
and other inputs to ensure data integrity and security.
"""

import os
import re
from pathlib import Path
from typing import Optional, List, Callable
import pandas as pd
from functools import wraps

from exceptions import (
    FileNotFoundError,
    FileSizeError,
    UnsupportedFileTypeError,
    EmptyFileError,
    InvalidDataFrameError,
    InvalidConnectionStringError,
    QueryExecutionError,
    InvalidRequestError
)
from config import get_file_upload_config, get_db_config


def sanitize_table_name(filename: str, prefix: Optional[str] = None) -> str:
    """
    Generate a valid SQL table name from a filename.
    
    Args:
        filename: Original filename (e.g. 'My Data 2024.csv')
        prefix: Optional prefix for the table name (e.g. 'import_2024')
    
    Returns:
        Sanitized table name (e.g. 'my_data_2024' or 'import_2024_my_data_2024')
    """
    base_name = Path(filename).stem.lower()
    base_name = re.sub(r'[^a-z0-9_]', '_', base_name)
    if base_name and base_name[0].isdigit():
        base_name = f"t_{base_name}"
    if prefix:
        return f"{prefix}_{base_name}"
    return base_name


class FileValidator:
    """
    Validates file uploads including size, type, and content.
    """
    
    def __init__(
        self,
        max_size: Optional[int] = None,
        supported_extensions: Optional[List[str]] = None
    ):
        """
        Initialize file validator.
        
        Args:
            max_size: Maximum file size in bytes (uses config default if None)
            supported_extensions: List of allowed extensions (uses config default if None)
        """
        config = get_file_upload_config()
        self.max_size = max_size or config.max_file_size
        self.supported_extensions = supported_extensions or config.supported_extensions
    
    def validate_exists(self, file_path: str) -> None:
        """
        Validate that file exists.
        
        Args:
            file_path: Path to the file
        
        Raises:
            FileNotFoundError: If file does not exist
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(file_path)
    
    def validate_size(self, file_path: str) -> None:
        """
        Validate file size is within limits.
        
        Args:
            file_path: Path to the file
        
        Raises:
            FileSizeError: If file exceeds maximum size
        """
        file_size = os.path.getsize(file_path)
        if file_size > self.max_size:
            raise FileSizeError(file_size, self.max_size, file_path)
    
    def validate_type(self, file_path: str) -> None:
        """
        Validate file type is supported.
        
        Args:
            file_path: Path to the file
        
        Raises:
            UnsupportedFileTypeError: If file type is not supported
        """
        file_extension = Path(file_path).suffix.lower()
        if file_extension not in self.supported_extensions:
            raise UnsupportedFileTypeError(file_extension, self.supported_extensions)
    
    def validate_not_empty(self, file_path: str) -> None:
        """
        Validate file is not empty.
        
        Args:
            file_path: Path to the file
        
        Raises:
            EmptyFileError: If file is empty
        """
        if os.path.getsize(file_path) == 0:
            raise EmptyFileError(file_path)
    
    def validate_all(self, file_path: str) -> None:
        """
        Run all file validations.
        
        Args:
            file_path: Path to the file
        
        Raises:
            FileValidationError: If any validation fails
        """
        self.validate_exists(file_path)
        self.validate_size(file_path)
        self.validate_type(file_path)
        self.validate_not_empty(file_path)


class DataFrameValidator:
    """
    Validates pandas DataFrames for database operations.
    """
    
    def __init__(
        self,
        max_rows: Optional[int] = None,
        max_columns: Optional[int] = None
    ):
        """
        Initialize DataFrame validator.
        
        Args:
            max_rows: Maximum number of rows allowed
            max_columns: Maximum number of columns allowed
        """
        config = get_file_upload_config()
        self.max_rows = max_rows or config.max_rows
        self.max_columns = max_columns or config.max_columns
    
    def validate_not_empty(self, df: pd.DataFrame) -> None:
        """
        Validate DataFrame is not empty.
        
        Args:
            df: DataFrame to validate
        
        Raises:
            InvalidDataFrameError: If DataFrame is empty
        """
        if df.empty:
            raise InvalidDataFrameError("DataFrame is empty")
    
    def validate_size(self, df: pd.DataFrame) -> None:
        """
        Validate DataFrame size is within limits.
        
        Args:
            df: DataFrame to validate
        
        Raises:
            InvalidDataFrameError: If DataFrame exceeds size limits
        """
        if len(df) > self.max_rows:
            raise InvalidDataFrameError(
                f"DataFrame has {len(df)} rows, exceeds maximum of {self.max_rows}"
            )
        
        if len(df.columns) > self.max_columns:
            raise InvalidDataFrameError(
                f"DataFrame has {len(df.columns)} columns, "
                f"exceeds maximum of {self.max_columns}"
            )
    
    def validate_columns(self, df: pd.DataFrame) -> None:
        """
        Validate DataFrame has valid column names.
        
        Args:
            df: DataFrame to validate
        
        Raises:
            InvalidDataFrameError: If column names are invalid
        """
        # Check for duplicate columns
        if df.columns.duplicated().any():
            duplicates = df.columns[df.columns.duplicated()].tolist()
            raise InvalidDataFrameError(
                f"DataFrame has duplicate column names: {duplicates}"
            )
        
        # Check for empty column names
        if any(str(col).strip() == '' for col in df.columns):
            raise InvalidDataFrameError("DataFrame has empty column names")
    
    def validate_all(self, df: pd.DataFrame) -> None:
        """
        Run all DataFrame validations.
        
        Args:
            df: DataFrame to validate
        
        Raises:
            InvalidDataFrameError: If any validation fails
        """
        self.validate_not_empty(df)
        self.validate_size(df)
        self.validate_columns(df)


class ConnectionStringValidator:
    """
    Validates database connection strings.
    """
    
    # Supported database types
    SUPPORTED_DATABASES = ['sqlite', 'postgresql', 'mysql', 'mssql', 'oracle']
    
    @staticmethod
    def validate(connection_string: str) -> None:
        """
        Validate database connection string format.
        
        Args:
            connection_string: Database connection string
        
        Raises:
            InvalidConnectionStringError: If connection string is invalid
        """
        if not connection_string or not connection_string.strip():
            raise InvalidConnectionStringError("Connection string cannot be empty")
        
        # Check for basic format: dialect://...
        if '://' not in connection_string:
            raise InvalidConnectionStringError(
                "Connection string must be in format: dialect://..."
            )
        
        # Extract dialect
        dialect = connection_string.split('://')[0].lower()
        
        # Check if dialect is supported
        if not any(db in dialect for db in ConnectionStringValidator.SUPPORTED_DATABASES):
            raise InvalidConnectionStringError(
                f"Unsupported database type: {dialect}. "
                f"Supported types: {', '.join(ConnectionStringValidator.SUPPORTED_DATABASES)}"
            )


class SQLQueryValidator:
    """
    Validates and sanitizes SQL queries.
    """
    
    # Dangerous SQL keywords that should be restricted
    DANGEROUS_KEYWORDS = [
        'DROP', 'DELETE', 'TRUNCATE', 'ALTER', 'CREATE',
        'GRANT', 'REVOKE', 'EXEC', 'EXECUTE'
    ]
    
    @staticmethod
    def validate_length(query: str, max_length: Optional[int] = None) -> None:
        """
        Validate query length.
        
        Args:
            query: SQL query string
            max_length: Maximum allowed length
        
        Raises:
            QueryExecutionError: If query exceeds maximum length
        """
        if max_length is None:
            max_length = get_db_config().max_query_length
        
        if len(query) > max_length:
            raise QueryExecutionError(
                f"Query length ({len(query)}) exceeds maximum ({max_length})",
                query=query[:100]
            )
    
    @staticmethod
    def validate_safe(query: str, allow_modifications: bool = False) -> None:
        """
        Validate query doesn't contain dangerous operations.
        
        Args:
            query: SQL query string
            allow_modifications: Whether to allow modification queries
        
        Raises:
            QueryExecutionError: If query contains dangerous operations
        """
        if not allow_modifications:
            query_upper = query.upper()
            for keyword in SQLQueryValidator.DANGEROUS_KEYWORDS:
                # Use word boundaries to avoid false positives
                pattern = r'\b' + keyword + r'\b'
                if re.search(pattern, query_upper):
                    raise QueryExecutionError(
                        f"Query contains restricted keyword: {keyword}",
                        query=query[:100]
                    )
    
    @staticmethod
    def validate_all(
        query: str,
        max_length: Optional[int] = None,
        allow_modifications: bool = False
    ) -> None:
        """
        Run all query validations.
        
        Args:
            query: SQL query string
            max_length: Maximum allowed length
            allow_modifications: Whether to allow modification queries
        
        Raises:
            QueryExecutionError: If any validation fails
        """
        SQLQueryValidator.validate_length(query, max_length)
        SQLQueryValidator.validate_safe(query, allow_modifications)


class TableNameValidator:
    """
    Validates table names for database operations.
    """
    
    # Valid table name pattern (alphanumeric and underscores only)
    VALID_PATTERN = re.compile(r'^[a-zA-Z_][a-zA-Z0-9_]*$')
    
    @staticmethod
    def validate(table_name: str) -> None:
        """
        Validate table name format.
        
        Args:
            table_name: Table name to validate
        
        Raises:
            InvalidRequestError: If table name is invalid
        """
        if not table_name or not table_name.strip():
            raise InvalidRequestError("Table name cannot be empty")
        
        if not TableNameValidator.VALID_PATTERN.match(table_name):
            raise InvalidRequestError(
                f"Invalid table name: {table_name}. "
                "Table names must start with a letter or underscore and "
                "contain only letters, numbers, and underscores."
            )
        
        if len(table_name) > 64:
            raise InvalidRequestError(
                f"Table name too long: {len(table_name)} characters. "
                "Maximum is 64 characters."
            )


# Decorator for validating function arguments
def validate_args(**validators: Callable):
    """
    Decorator to validate function arguments.
    
    Args:
        **validators: Mapping of argument names to validator functions
    
    Example:
        >>> @validate_args(file_path=FileValidator().validate_all)
        >>> def upload_file(file_path: str):
        >>>     # file_path is validated before function executes
        >>>     pass
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            # Get function signature
            import inspect
            sig = inspect.signature(func)
            bound_args = sig.bind(*args, **kwargs)
            bound_args.apply_defaults()
            
            # Validate each argument
            for arg_name, validator in validators.items():
                if arg_name in bound_args.arguments:
                    value = bound_args.arguments[arg_name]
                    validator(value)
            
            return func(*args, **kwargs)
        return wrapper
    return decorator
