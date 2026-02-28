"""
Configuration management for the RAG AI Agent application.

This module provides centralized configuration with environment variable support,
validation, and sensible defaults.
"""

import os
from typing import List, Optional
from dataclasses import dataclass, field
from pathlib import Path
from dotenv import load_dotenv

from exceptions import MissingConfigurationError, InvalidConfigurationError


# Load environment variables
load_dotenv()


@dataclass
class DatabaseConfig:
    """Database configuration settings."""
    
    # Default connection string
    default_connection_string: str = "sqlite:///identifier.sqlite.db"
    
    # Connection pool settings
    pool_size: int = 5
    max_overflow: int = 10
    pool_timeout: int = 30
    pool_recycle: int = 3600  # Recycle connections after 1 hour
    pool_pre_ping: bool = True  # Verify connections before using
    
    # Query settings
    query_timeout: int = 30  # seconds
    max_query_length: int = 10000  # characters
    
    # Retry settings
    max_retries: int = 3
    retry_delay: float = 1.0  # seconds
    retry_backoff: float = 2.0  # exponential backoff multiplier
    
    def validate(self) -> None:
        """Validate database configuration."""
        if self.pool_size < 1:
            raise InvalidConfigurationError("pool_size", "Must be at least 1")
        if self.query_timeout < 1:
            raise InvalidConfigurationError("query_timeout", "Must be at least 1")


@dataclass
class FileUploadConfig:
    """File upload configuration settings."""
    
    # File size limits
    max_file_size: int = 800 * 1024 * 1024  # 800MB in bytes
    max_batch_files: int = 20
    
    # Supported file types
    supported_extensions: List[str] = field(default_factory=lambda: ['.csv', '.xlsx', '.xls'])
    
    # Upload settings
    chunk_size: int = 8192  # bytes for streaming uploads
    temp_dir: str = "/tmp/rag_uploads"
    
    # Data validation
    max_columns: int = 1000
    max_rows: int = 2_000_000
    
    def validate(self) -> None:
        """Validate file upload configuration."""
        if self.max_file_size < 1024:  # At least 1KB
            raise InvalidConfigurationError("max_file_size", "Must be at least 1KB")
        if self.max_batch_files < 1:
            raise InvalidConfigurationError("max_batch_files", "Must be at least 1")
        if not self.supported_extensions:
            raise InvalidConfigurationError("supported_extensions", "Must not be empty")


@dataclass
class AgentConfig:
    """Analytics agent configuration settings."""
    
    # Model settings
    model_name: str = "gemini-2.0-flash"
    model_provider: str = "google" # "huggingface" or "google"
    fallback_model_name: str = "gemini-2.0-flash"
    fallback_model_provider: str = "google"
    max_tokens: int = 1024
    temperature: float = 0.7
    
    # Agent behavior
    max_iterations: int = 15
    timeout: int = 300  # seconds
    
    # System prompt
    system_prompt: str = """You are a friendly data analyst assistant. Your job is to answer questions about the user's data in plain, simple English.

RESPONSE STYLE:
- Give brief, clear answers in plain English — like you're explaining to a colleague
- Include the key numbers and insights
- Skip jargon and formalities
- If you're unsure, say so simply

WORKFLOW:
1. Use list_tables to see available tables (skip if schema already provided)
2. Use describe_table to understand table structure (skip if already known)
3. Use execute_query to run ONE well-crafted SQL query
4. Explain the results in simple language

SQL RULES:
- Write SQL compatible with the connected database (auto-detect from schema)
- For SQLite: use strftime(), julianday(), etc.
- For PostgreSQL: use TO_CHAR(), EXTRACT(), AGE(), etc.
- Always verify table/column names from the schema before querying
- Use LIMIT to keep result sets reasonable
- Never use SELECT * — pick specific columns

CHARTS — IMPORTANT:
When results have data that can be visualized (comparisons, trends, rankings, distributions), 
ALWAYS include a chart by adding a VISUALIZATION JSON block at the END of your response.

The format MUST be exactly:

VISUALIZATION: {"type": "bar", "title": "Chart Title", "description": "What this shows", "data": {"labels": ["Label1", "Label2"], "values": [10, 20]}}

Chart types: bar, line, pie, area, scatter
- Use "bar" for comparisons and rankings
- Use "line" for trends over time  
- Use "pie" for proportions (keep to 6 or fewer slices)
- Use "area" for cumulative trends
- Use "scatter" for correlations

Rules for chart data:
- "labels" = array of category names or dates (strings)
- "values" = array of numbers (same length as labels)
- Keep charts to 10-15 data points max for readability
- Title should describe the insight, not the chart type

DO NOT output Plotly code. DO NOT output Python code. Only use the VISUALIZATION JSON format above.
"""
    
    # Tokens
    hf_token: Optional[str] = field(default_factory=lambda: os.getenv("HF_TOKEN"))
    google_api_key: Optional[str] = field(default_factory=lambda: os.getenv("GOOGLE_API_KEY"))
    
    def validate(self) -> None:
        """Validate agent configuration."""
        if self.model_provider == "huggingface" and not self.hf_token:
            raise MissingConfigurationError("HF_TOKEN")
        
        # Only strict check Google key if it is the primary provider
        # but allow skipping validation via env var (for migrations/builds)
        if self.model_provider == "google" and not self.google_api_key:
            if not os.getenv("SKIP_KEY_VALIDATION"):
                raise MissingConfigurationError("GOOGLE_API_KEY")
        
        # Checking fallback keys is done at runtime during init to allow graceful degradation
            
        if self.max_iterations < 1:
            raise InvalidConfigurationError("max_iterations", "Must be at least 1")
        if self.timeout < 1:
            raise InvalidConfigurationError("timeout", "Must be at least 1")


@dataclass
class APIConfig:
    """API configuration settings."""
    
    # Server settings
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False
    
    # CORS settings
    cors_origins: List[str] = field(default_factory=lambda: ["*"])
    
    # Rate limiting
    rate_limit_enabled: bool = False
    rate_limit_requests: int = 100
    rate_limit_period: int = 60  # seconds
    
    # Admin database
    admin_db_url: str = "sqlite:///./admin.db"
    
    # Static files
    static_dir: str = "./static"
    
    # Shared reports
    default_report_expiry_days: int = 30
    
    def validate(self) -> None:
        """Validate API configuration."""
        if self.port < 1 or self.port > 65535:
            raise InvalidConfigurationError("port", "Must be between 1 and 65535")
        if self.rate_limit_enabled and self.rate_limit_requests < 1:
            raise InvalidConfigurationError("rate_limit_requests", "Must be at least 1")


@dataclass
class LoggingConfig:
    """Logging configuration settings."""
    
    # Log levels
    log_level: str = field(default_factory=lambda: os.getenv("LOG_LEVEL", "INFO"))
    
    # Log format
    log_format: str = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    date_format: str = "%Y-%m-%d %H:%M:%S"
    
    # Log files
    log_to_file: bool = True
    log_file: str = "logs/rag_agent.log"
    max_log_size: int = 10 * 1024 * 1024  # 10MB
    backup_count: int = 5
    
    # Console logging
    log_to_console: bool = True
    
    def validate(self) -> None:
        """Validate logging configuration."""
        valid_levels = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
        if self.log_level.upper() not in valid_levels:
            raise InvalidConfigurationError(
                "log_level", 
                f"Must be one of {', '.join(valid_levels)}"
            )


@dataclass
class AppConfig:
    """Main application configuration."""
    
    database: DatabaseConfig = field(default_factory=DatabaseConfig)
    file_upload: FileUploadConfig = field(default_factory=FileUploadConfig)
    agent: AgentConfig = field(default_factory=AgentConfig)
    api: APIConfig = field(default_factory=APIConfig)
    logging: LoggingConfig = field(default_factory=LoggingConfig)
    
    # Environment
    environment: str = field(default_factory=lambda: os.getenv("ENVIRONMENT", "development"))
    
    def __post_init__(self):
        """Validate all configuration after initialization."""
        self.validate()
    
    def validate(self) -> None:
        """Validate all configuration sections."""
        self.database.validate()
        self.file_upload.validate()
        self.agent.validate()
        self.api.validate()
        self.logging.validate()
        
        # Environment-specific validation
        if self.environment not in ["development", "staging", "production"]:
            raise InvalidConfigurationError(
                "environment",
                "Must be one of: development, staging, production"
            )
    
    @classmethod
    def from_env(cls) -> 'AppConfig':
        """Create configuration from environment variables."""
        config = cls()
        
        # Override with environment variables if present
        if db_url := os.getenv("DATABASE_URL"):
            config.database.default_connection_string = db_url
        
        if max_file_size := os.getenv("MAX_FILE_SIZE"):
            config.file_upload.max_file_size = int(max_file_size)
        
        if api_port := os.getenv("PORT"):
            config.api.port = int(api_port)
        
        if debug := os.getenv("DEBUG"):
            config.api.debug = debug.lower() in ("true", "1", "yes")
        
        return config


# Global configuration instance
config = AppConfig.from_env()


# Convenience functions for accessing configuration
def get_config() -> AppConfig:
    """Get the global configuration instance."""
    return config


def get_db_config() -> DatabaseConfig:
    """Get database configuration."""
    return config.database


def get_file_upload_config() -> FileUploadConfig:
    """Get file upload configuration."""
    return config.file_upload


def get_agent_config() -> AgentConfig:
    """Get agent configuration."""
    return config.agent


def get_api_config() -> APIConfig:
    """Get API configuration."""
    return config.api


def get_logging_config() -> LoggingConfig:
    """Get logging configuration."""
    return config.logging
