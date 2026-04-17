"""
Custom exceptions for the RAG AI Agent application.

This module provides a hierarchy of custom exceptions for better error handling
and more informative error messages throughout the application.
"""


class RAGAgentError(Exception):
    """Base exception for all RAG Agent errors."""
    def __init__(self, message: str, user_message: str = "An unexpected error occurred. Please try again later."):
        self.message = message
        self.user_message = user_message
        super().__init__(message)


# ============================================================================
# Database Exceptions
# ============================================================================

class DatabaseError(RAGAgentError):
    """Base exception for database-related errors."""
    def __init__(self, message: str, user_message: str = "Database operation failed. Please check your data or connection."):
        super().__init__(message, user_message=user_message)


class ConnectionError(DatabaseError):
    """Raised when database connection fails."""
    
    def __init__(self, message: str, connection_string: str = None):
        self.connection_string = connection_string
        msg = "We couldn't connect to the database. Please verify your credentials and host availability."
        super().__init__(message, user_message=msg)


class QueryExecutionError(DatabaseError):
    """Raised when SQL query execution fails."""
    
    def __init__(self, message: str, query: str = None):
        self.query = query
        msg = "The query failed to execute. Check for syntax errors or permission issues."
        # If it's a specific constraint violation, we can make it prettier
        if "UNIQUE constraint failed" in str(message):
            msg = "This record already exists in the database."
        elif "FOREIGN KEY constraint failed" in str(message):
            msg = "This operation would break data relationships. Check dependent records."
            
        super().__init__(message, user_message=msg)


class TableNotFoundError(DatabaseError):
    """Raised when a requested table does not exist."""
    
    def __init__(self, table_name: str):
        self.table_name = table_name
        super().__init__(f"Table '{table_name}' not found in database")


class InvalidConnectionStringError(DatabaseError):
    """Raised when database connection string is invalid."""
    pass


# ============================================================================
# File Upload Exceptions
# ============================================================================

class FileUploadError(RAGAgentError):
    """Base exception for file upload-related errors."""
    pass


class FileValidationError(FileUploadError):
    """Raised when file validation fails."""
    pass


class FileNotFoundError(FileValidationError):
    """Raised when the specified file does not exist."""
    
    def __init__(self, file_path: str):
        self.file_path = file_path
        super().__init__(f"File not found: {file_path}")


class FileSizeError(FileValidationError):
    """Raised when file size exceeds the allowed limit."""
    
    def __init__(self, file_size: int, max_size: int, file_path: str = None):
        self.file_size = file_size
        self.max_size = max_size
        self.file_path = file_path
        message = (
            f"File size ({file_size / (1024*1024):.2f}MB) exceeds "
            f"maximum allowed size ({max_size / (1024*1024):.2f}MB)"
        )
        if file_path:
            message = f"{message}: {file_path}"
        super().__init__(message)


class UnsupportedFileTypeError(FileValidationError):
    """Raised when file type is not supported."""
    
    def __init__(self, file_extension: str, supported_types: list = None):
        self.file_extension = file_extension
        self.supported_types = supported_types or ['.csv', '.xlsx', '.xls']
        message = (
            f"Unsupported file type: {file_extension}. "
            f"Supported types: {', '.join(self.supported_types)}"
        )
        super().__init__(message)


class EmptyFileError(FileValidationError):
    """Raised when file is empty or contains no data."""
    
    def __init__(self, file_path: str = None):
        message = "The file is empty or contains no data"
        if file_path:
            message = f"{message}: {file_path}"
        super().__init__(message)


class InvalidDataFrameError(FileUploadError):
    """Raised when DataFrame validation fails."""
    def __init__(self, message: str):
        super().__init__(message, user_message=f"The data format is invalid: {message}")


# ============================================================================
# Agent Exceptions
# ============================================================================

class AgentError(RAGAgentError):
    """Base exception for agent-related errors."""
    pass


class ModelAPIError(AgentError):
    """Raised when the AI model API call fails."""
    
    def __init__(self, message: str, model_name: str = None):
        self.model_name = model_name
        user_msg = "The AI service is temporarily unavailable or at its limit. Please try again in 30-60 seconds."
        if "402" in str(message):
            user_msg = "The AI provider's usage limit has been reached. Please upgrade your plan or check quota."
        super().__init__(message, user_message=user_msg)


class MaxIterationsError(AgentError):
    """Raised when agent reaches maximum iteration limit."""
    
    def __init__(self, max_iterations: int):
        self.max_iterations = max_iterations
        super().__init__(
            f"Agent reached maximum iterations ({max_iterations}) without completing the query",
            user_message="The analysis is taking too many steps. Try breaking your question into smaller, more specific parts."
        )


class VisualizationParseError(AgentError):
    """Raised when visualization data parsing fails."""
    
    def __init__(self, message: str, raw_data: str = None):
        self.raw_data = raw_data
        super().__init__(message)


class ToolExecutionError(AgentError):
    """Raised when a tool execution fails."""
    
    def __init__(self, tool_name: str, message: str):
        self.tool_name = tool_name
        super().__init__(f"Tool '{tool_name}' execution failed: {message}")


class VerificationRequired(AgentError):
    """Raised when a tool execution requires user verification."""
    
    def __init__(self, message: str, tool_name: str, tool_args: dict, explanation: str = None):
        self.tool_name = tool_name
        self.tool_args = tool_args
        self.explanation = explanation
        super().__init__(message)


# ============================================================================
# API Exceptions
# ============================================================================

class APIError(RAGAgentError):
    """Base exception for API-related errors."""
    pass


class AuthenticationError(APIError):
    """Raised when API authentication fails."""
    pass


class OrganizationNotFoundError(APIError):
    """Raised when organization is not found."""
    
    def __init__(self, identifier: str):
        self.identifier = identifier
        super().__init__(f"Organization not found: {identifier}")


class RateLimitError(APIError):
    """Raised when API rate limit is exceeded."""
    
    def __init__(self, retry_after: int = None):
        self.retry_after = retry_after
        message = "Rate limit exceeded"
        if retry_after:
            message = f"{message}. Retry after {retry_after} seconds"
        super().__init__(message)


class InvalidRequestError(APIError):
    """Raised when API request is invalid."""
    def __init__(self, message: str):
        super().__init__(message, user_message=message)


# ============================================================================
# Configuration Exceptions
# ============================================================================

class ConfigurationError(RAGAgentError):
    """Base exception for configuration-related errors."""
    pass


class MissingConfigurationError(ConfigurationError):
    """Raised when required configuration is missing."""
    
    def __init__(self, config_key: str):
        self.config_key = config_key
        super().__init__(f"Missing required configuration: {config_key}")


class InvalidConfigurationError(ConfigurationError):
    """Raised when configuration value is invalid."""
    
    def __init__(self, config_key: str, message: str):
        self.config_key = config_key
        super().__init__(f"Invalid configuration for '{config_key}': {message}")