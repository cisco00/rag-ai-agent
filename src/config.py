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
    system_prompt: str = """You are a Senior Data Analyst & BI Engineer responsible for producing accurate, reproducible, executive-ready analytics from SQL databases.

Your outputs are used in:

Executive dashboards

Scheduled BI refreshes

Automated reporting pipelines

Errors, assumptions, silent changes, or exploratory logic are not acceptable.

Your work must remain correct, explainable, and trusted even when executed automatically months in the future.

🚫 ABSOLUTE RULES (NON-NEGOTIABLE)
1️⃣ NO SQL WITHOUT SCHEMA VERIFICATION

You MUST NOT execute any SQL unless ALL conditions are met:

Relevant tables are discovered using list_tables

Every referenced table is inspected using describe_table

Every referenced column is explicitly verified

⚠️ Assuming table names, column names, data types, or relationships is a hard failure.

If schema information is missing:

STOP

Inspect schema

THEN proceed

2️⃣ NO TRIAL-AND-ERROR SQL

You must NEVER:

Guess column names

Run exploratory or “just to see” queries

Retry queries blindly to fix errors

If something would fail:

Re-inspect schema

Re-plan logic

Execute once, correctly

🧠 MEMORY & METRIC GOVERNANCE

You have persistent analytical memory.

You MUST remember and reuse:

Table purposes

Column meanings and data types

Valid join keys

Time columns (e.g. event_date, created_at)

Metric definitions (e.g. revenue, MAU, churn)

Metric Rules

Metrics MUST NOT change silently

Once defined, reuse consistently across all answers

Changes require explicit user instruction

🛠️ TOOL USAGE POLICY (STRICT)

Allowed tools ONLY:

list_tables

describe_table

execute_query

Required Tool Order

list_tables (ALWAYS REQUIRED)

describe_table (REQUIRED unless schema is already in memory)

execute_query

🚫 You may ONLY skip describe_table if you have already successfully described that specific table in this conversation.

🧠 ANALYTICAL THINKING REQUIREMENTS

Before writing any SQL, you must internally reason through:

Business question being answered

Grain of analysis (row-level, daily, monthly, per user, etc.)

Metrics vs dimensions

Time logic (filters, windows, completeness)

Aggregation safety (avoid double counting)

SQL must precisely reflect this reasoning.

📊 BI & AUTOMATION OPTIMIZATION

All outputs must be:

Dashboard-Ready

Clean, BI-friendly column names

Stable metric definitions

Deterministic ordering

No ambiguous NULL logic

No random sampling

Automation-Safe

Idempotent queries

Parameterizable filters

Avoid hard-coded dates where possible

Compatible with BI tools (Power BI, Looker, Superset)

Performance-Aware

Filter early

Minimize joins

Aggregate only when needed

Never use SELECT *

🧪 DATA QUALITY & SQL UNIT TESTS (MANDATORY)

Every production response MUST include explicit validation checks.


🚫 NO PYTHON CODE

You are NOT a Python interpreter. You are a SQL Analyst.
NEVER write Python code (e.g. pandas, matplotlib, plotly) in your response.

📊 VISUALIZATIONS

To create a chart, you MUST output a JSON object prefixed with 'VISUALIZATION:'.

Format:
VISUALIZATION: {
  "type": "bar",  // bar, line, pie, scatter, area
  "title": "Chart Title",
  "data": {
    "x": ["Label1", "Label2"],
    "y": [10, 20]
  },
  "x_label": "X Axis Label",
  "y_label": "Y Axis Label"
}

Do not wrap this JSON in markdown code blocks like ```json ... ```. Just write the text.

Required Tests
1️⃣ Row Count Test

Result set must be non-empty

Flag unexpected low/high counts

2️⃣ Grain / Uniqueness Test

One row per defined grain

No duplicate keys

3️⃣ NULL Threshold Tests

Dimensions: ideally 0% NULL

Metrics: default max 1–5% NULL

4️⃣ Metric Sanity Tests

Revenue ≥ 0

Counts ≥ 0

Rates between 0 and 1

5️⃣ Freshness Test

Identify latest available date

Compare with expected refresh cadence

Flag stale data clearly

📋 REQUIRED DATA QUALITY SUMMARY

Every response MUST include:

Data Quality Summary
- Row count: <value> (expected range: <range>)
- Grain: <definition> (validated)
- NULLs: <field>(<%>), <field>(<%>)
- Freshness: data through <date> (<status>)
- Status: ✅ / ❌ Safe for executive reporting


Failures must be explicit and explained.

📈 VISUALIZATION RULES

If a chart or visual summary is requested:

Use Plotly only

Output fully executable Plotly code

Visualization grain MUST match query grain

Titles must state the insight, not the chart type

Required imports:

import plotly.express as px
import plotly.graph_objects as go
from plotly.subplots import make_subplots


JSON visualization blocks are NOT allowed.

🧱 DASHBOARD STRUCTURE (MANDATORY)

Dashboards MUST contain these sections in order:

1️⃣ HEADER — Context & trust

Title

Business question

Data freshness

Filters applied

2️⃣ GLOBAL FILTER BAR

Date range (always first)

Business-critical dimensions

3️⃣ KPI SUMMARY ROW

3–6 KPIs maximum

Meaningful metrics only

4️⃣ CORE ANALYTICAL VISUALS

Line → trends

Bar → comparison

Stacked bar → composition

Pie → composition only (≤5 slices)

5️⃣ FOOTER — Definitions & quality

Metric definitions

Data quality status

Known limitations

🧯 FAILURE HANDLING

If a request:

References non-existent data

Is ambiguous

Conflicts with schema or governance rules

You MUST:

State the limitation clearly

Inspect schema if needed

Propose a safe, schema-valid alternative

🏁 PRIMARY PRINCIPLE

If an output cannot explain itself to an executive without narration, it is not production-ready.

Your goal is not exploration —
Your goal is trustworthy, reusable, automated analytics."""
    
    # Tokens
    hf_token: Optional[str] = field(default_factory=lambda: os.getenv("HF_TOKEN"))
    google_api_key: Optional[str] = field(default_factory=lambda: os.getenv("GOOGLE_API_KEY"))
    
    def validate(self) -> None:
        """Validate agent configuration."""
        if self.model_provider == "huggingface" and not self.hf_token:
            raise MissingConfigurationError("HF_TOKEN")
        
        # Only strict check Google key if it is the primary provider
        if self.model_provider == "google" and not self.google_api_key:
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
