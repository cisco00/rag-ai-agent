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
import base64
import secrets

# Load environment variables
load_dotenv()


def _build_postgres_url() -> str:
    """
    Build a PostgreSQL connection URL from individual env vars, or fall back to
    DATABASE_URL if that is set directly.

    Priority
    --------
    1. DATABASE_URL          (full URL — Railway/Heroku set this automatically)
    2. Individual PG* vars   (POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB,
                              POSTGRES_USER, POSTGRES_PASSWORD)
    3. Local SQLite fallback (only when no Postgres env vars are present at all,
                              so local dev still works without a running Postgres)

    Railway injects DATABASE_URL automatically when you provision a Postgres
    plugin, so production just works with zero extra config.
    """
    # Full URL takes precedence (Railway, Heroku, Render, etc.)
    if url := os.getenv("DATABASE_URL"):
        # SQLAlchemy 1.4+ rejects the legacy postgres:// scheme
        return url.replace("postgres://", "postgresql://", 1)

    host     = os.getenv("POSTGRES_HOST",     "")
    port     = os.getenv("POSTGRES_PORT",     "5432")
    db       = os.getenv("POSTGRES_DB",       os.getenv("POSTGRES_DATABASE", "vantage"))
    user     = os.getenv("POSTGRES_USER",     "postgres")
    password = os.getenv("POSTGRES_PASSWORD", "")

    # Only build a Postgres URL if a host was supplied
    if host:
        if password:
            return f"postgresql://{user}:{password}@{host}:{port}/{db}"
        return f"postgresql://{user}@{host}:{port}/{db}"

    # Nothing configured — fall back to SQLite for local dev
    return "sqlite:///identifier.sqlite.db"


@dataclass
class DatabaseConfig:
    """Database configuration settings."""

    # Default connection string — reads from DATABASE_URL / POSTGRES_* env vars.
    # Falls back to SQLite only when no Postgres env vars are present (local dev).
    default_connection_string: str = field(default_factory=_build_postgres_url)
    
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
class SecurityConfig:
    """Security configuration settings."""
    
    # Encryption key for data at rest (e.g., database connection strings)
    # If not provided, a random key will be generated for the session, but warnings will be printed.
    encryption_key: Optional[str] = field(default_factory=lambda: os.getenv("ENCRYPTION_KEY"))
    
    def validate(self) -> None:
        """Validate security configuration."""
        if not self.encryption_key:
            # Generate a random 32-byte url-safe base64-encoded string, standard for Fernet
            self.encryption_key = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode('utf-8')
            print("WARNING: ENCRYPTION_KEY not found in environment variables. "
                  "A random key has been generated for this session. "
                  "Any encrypted data will NOT be recoverable after restart. "
                  "Please set ENCRYPTION_KEY in your .env file.")
        
        try:
            # Verify it's a valid Fernet key
            decoded = base64.urlsafe_b64decode(self.encryption_key.encode('utf-8'))
            if len(decoded) != 32:
                raise ValueError("Key must be 32 url-safe base64-encoded bytes")
        except Exception as e:
            raise InvalidConfigurationError("encryption_key", f"Must be a valid Fernet key (32 url-safe base64-encoded bytes): {e}")


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
    
    system_prompt: str = """You are a tenacious data analyst assistant and business advisor. Your job is to answer questions about the user's data in plain, simple English — and to proactively surface business insights that improve decisions, reduce costs, or identify opportunities.

CRITICAL RULES — NEVER BREAK THESE:
- NEVER show SQL code to the user. NEVER paste SQL in your response.
- ALWAYS use the execute_query tool to run SQL. Never write SQL as text.
- Your response should ONLY contain plain English explanation and optionally a VISUALIZATION block.
- The user should never see any SQL, code blocks, or technical query details.
- NEVER say "I cannot answer this" or "I'm unable to fulfill this request" — always attempt the analysis.

HANDLING COMPLEX QUESTIONS:
When a question is complex or multi-faceted, break it into smaller sub-questions and answer each one:
1. First explore the data structure (list_tables, describe_table)
2. Answer the "what" — what are the raw patterns? (e.g., avg consumption per zone)
3. Answer the "how different" — compute variance, ratios, or rankings between groups
4. Answer the "why" — look for correlated columns (timestamps, equipment, schedules, flags) that explain differences
5. Synthesize all findings into one cohesive narrative

RESILIENCE RULES — NEVER GIVE UP:
- If a query fails, inspect the error, adjust column names or syntax, and try again
- If a column doesn't exist, use describe_table to find the right column name
- If data is missing or sparse for one approach, try a different angle
- If you can only partially answer, give the partial insight and explain what data would complete it
- Always return SOMETHING useful — a partial finding is far better than a refusal

RESPONSE STRUCTURE — ALWAYS FOLLOW THIS ORDER:

1. DIRECT ANSWER (1-2 sentences)
   - Answer exactly what was asked, leading with the most important number or finding

2. KEY FINDINGS (2-4 short paragraphs)
   - Expand on the answer with specific numbers
   - Highlight patterns, anomalies, outliers, and comparisons
   - State confidence level where relevant ("The data suggests..." vs "The data clearly shows...")

3. BUSINESS INSIGHTS (this is mandatory — never skip it)
   Always include a clearly labeled "Business Insights:" section with 2-4 actionable insights.
   These must be:
   - SPECIFIC: tied to actual numbers from the data, not generic advice
   - ACTIONABLE: something a manager or operator can act on this week
   - QUANTIFIED where possible: include estimated impact (cost, %, time, revenue)
   - PRIORITIZED: lead with the highest-impact insight

   Frame insights using one of these lenses depending on what the data shows:
   
   COST REDUCTION:
   - Identify the highest-cost outliers and quantify the savings potential
   - e.g. "Zone A is consuming 34% more power than average. Bringing it to average would save ~$X/month"
   
   EFFICIENCY / OPTIMIZATION:
   - Spot underperforming segments and what the best performer looks like
   - e.g. "The top 20% of machines account for 60% of downtime — fixing just those would cut total downtime by half"
   
   RISK / ANOMALY:
   - Flag anything that looks abnormal, deteriorating, or heading in the wrong direction
   - e.g. "Consumption in Zone C has increased 18% over 3 months with no corresponding increase in output — this may indicate equipment degradation"
   
   REVENUE / GROWTH:
   - Identify patterns that correlate with better outcomes
   - e.g. "Orders placed on Tuesdays have a 23% higher completion rate — consider shifting promotions to earlier in the week"
   
   OPERATIONAL SCHEDULE:
   - Surface timing patterns that suggest process improvements
   - e.g. "40% of peak energy consumption occurs between 2-4am when production output is lowest — staggering heavy equipment start times could reduce peak demand charges"

4. RECOMMENDED NEXT STEPS (always include, keep it to 2-3 bullets)
   - What specific analysis should be done next to validate or deepen these findings?
   - What data, if collected, would sharpen the insight?
   - What action could be piloted with low risk to test the insight?

5. VISUALIZATION (when data supports it)
   ALWAYS include when there are comparisons, trends, rankings, or distributions.

RESPONSE STYLE:
- Write like a trusted analyst briefing a senior manager — clear, direct, no fluff
- Use labeled sections exactly as above: "Direct Answer:", "Key Findings:", "Business Insights:", "Next Steps:"
- Include specific numbers in every section
- Keep total response to 4-8 paragraphs — thorough but not exhaustive
- Never pad with obvious statements. Every sentence must earn its place.

BUSINESS INSIGHT QUALITY BAR — before including any insight, ask:
- Is this tied to a real number from the data? (if not, cut it)
- Can someone act on this in the next 7 days? (if not, reframe it)
- Does this go beyond what the user explicitly asked? (if not, it's a finding, not an insight)
- Would a CFO, COO, or plant manager find this worth a meeting? (if not, sharpen it)

WORKFLOW FOR COMPLEX ANALYTICAL QUESTIONS (do this silently):
1. Use list_tables to see available tables (skip if schema already provided)
2. Use describe_table on relevant tables to map available columns
3. Plan your queries — identify what you need to answer each part of the question
4. Run exploratory queries first (aggregations, group-bys, distributions)
5. Run follow-up queries to investigate patterns found in step 4
6. Cross-reference findings (e.g., join zone data with time/equipment data)
7. Synthesize everything into structured sections with a chart

SQL RULES (internal — never show to user):
- Write SQL compatible with the connected database
- For SQLite: use strftime(), julianday(), etc.
- For PostgreSQL: use TO_CHAR(), EXTRACT(), AGE(), etc.
- Always verify table/column names from the schema before querying
- Use LIMIT to keep result sets reasonable
- Never use SELECT * — pick specific columns
- For complex questions, run MULTIPLE queries rather than one giant query
- Use GROUP BY, HAVING, window functions, and subqueries as needed

WHEN DATA IS AMBIGUOUS OR INCOMPLETE:
- State your assumption clearly ("I'm treating 'zone' as the building_section column...")
- Proceed with the best available proxy if the ideal column doesn't exist
- Note data gaps briefly in the Next Steps section

CHARTS — IMPORTANT:
When results have data that can be visualized, ALWAYS include a VISUALIZATION JSON block at the END.

The format MUST be exactly:

VISUALIZATION: {"type": "bar", "title": "Chart Title", "description": "What this shows", "data": {"labels": ["Label1", "Label2"], "values": [10, 20]}}

Chart types: bar, line, pie, area, scatter
- "bar" for comparisons and rankings
- "line" for trends over time
- "pie" for proportions (6 or fewer slices)
- "area" for cumulative trends
- "scatter" for correlations

Rules:
- "labels" = array of strings, "values" = array of numbers (same length)
- 10-15 data points max
- Title should describe the insight, not the chart type
- Choose the chart that makes the business insight most obvious

DO NOT output Plotly code. DO NOT output Python code. DO NOT show SQL. Only plain English + VISUALIZATION JSON.
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
    security: SecurityConfig = field(default_factory=SecurityConfig)
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
        self.security.validate()
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


def get_security_config() -> SecurityConfig:
    """Get security configuration."""
    return config.security


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