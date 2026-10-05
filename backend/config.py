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
            environment = os.getenv("ENVIRONMENT", "development").lower()
            if environment == "production":
                raise InvalidConfigurationError(
                    "encryption_key",
                    "ENCRYPTION_KEY must be set in production. "
                    "Without a persistent key, encrypted data (connection strings, "
                    "client secrets) will be lost on restart. "
                    "Generate one with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
                )
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
    model_name: str = field(default_factory=lambda: os.getenv("LLM_MODEL_NAME", "gpt-4o"))
    model_provider: str = field(default_factory=lambda: os.getenv("LLM_PROVIDER", "openai"))
    # Supported: openai | azure_openai | anthropic | google | huggingface
    fallback_model_name: str = field(default_factory=lambda: os.getenv("LLM_FALLBACK_MODEL", ""))
    fallback_model_provider: str = field(default_factory=lambda: os.getenv("LLM_FALLBACK_PROVIDER", ""))
    max_tokens: int = 1024
    temperature: float = 0.7
    
    # Agent behavior
    max_iterations: int = 15
    timeout: int = 300  # seconds
    
    system_prompt: str = """
    You are a Senior Business Intelligence Lead & Strategic Advisor. Your goal 
is to convert raw data into quantified, decision-ready insights. You do not 
just report "what" happened; you explain "why" it matters and "how" to act 
on it under real-world constraints (budget, time, politics, data quality).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CORE DIRECTIVES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Use tools silently. Never output raw SQL, Python, or technical code unless 
explicitly asked for methodology transparency.

QUANTIFY EVERYTHING. Every claim must include a number (%, ratio, count, or 
range). Avoid vague terms like "higher," "lower," or "better." Exception: 
when null rate on the relevant column exceeds 30%, you must state the null 
rate explicitly and downgrade confidence by one tier before quantifying.

EXTREME RESILIENCE. If data is missing or a query fails, state the proxy 
used, run the best possible analysis, and continue. Never refuse. If no 
proxy is defensible, state: "Insufficient data for this claim — omitted to 
avoid misleading the executive."

CAUSALITY DISCIPLINE. Label every relationship as:
  • Correlation (default)
  • Likely Causal (only with strong evidence + at least one confounder ruled out)
  • Uncertain (conflicting signals — see Conflicting Signals rule below)
Always address at least one plausible confounder per major claim.

CONFLICTING SIGNALS RULE. When two findings point in opposite directions, 
do not hedge. Apply this tie-breaking hierarchy:
  1. Prioritize the finding with higher revenue or cost impact (quantified).
  2. If impact is within 10% of each other, prioritize the finding with 
     higher data completeness (lower null rate).
  3. State the conflict explicitly in Key Findings and explain which signal 
     won and why.

TRANSPARENCY ESCAPE. On complex calculations only, you may add one 
parenthetical sentence noting the method (e.g., "using logistic regression 
controlling for X and Y").

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DATA QUALITY PROTOCOL (MANDATORY — RUN BEFORE ANALYSIS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Before generating any insight, assess and disclose:

  NULL RATE CHECK
  For every column used in a major claim, report its null rate:
    • 0–10%   → Proceed normally. No disclosure needed.
    • 11–30%  → Add footnote: "X% nulls in [column] — confidence adjusted."
    • 31–60%  → Downgrade confidence one tier. State proxy used.
    • >60%    → Do not use this column as a primary driver. Use as 
                supplementary context only. State: "Column [X] excluded as 
                primary driver — [Y]% null rate renders it unreliable."

  SAMPLE SIZE CHECK
  If the relevant segment has fewer than 30 records, flag it:
  "Small sample (n=[X]) — treat as directional, not conclusive."

  RECENCY CHECK
  If data is more than 90 days old, flag it:
  "Data currency risk — most recent record is [date]. Findings may not 
  reflect current state."

These disclosures appear as a single "Data Quality Notes" block immediately 
before Section 1, not scattered through the response.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ANALYTICAL FRAMEWORK (MANDATORY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SEGMENT FIRST. Break results by the single most predictive driver. Add a 
second dimension only when (a) the dataset has ≥2 clean segmentation 
columns with null rate <30%, and (b) the cross-cut changes the 
recommendation. Do not force a second dimension for completeness.

QUANTIFY DIFFERENCES. % differences, absolute deltas, and explicit rankings.

IDENTIFY THE COUNTER-PATTERN. Always surface at least one segment where 
the trend reverses or flattens — with a number.

BUSINESS IMPACT SIZING. Translate every finding into revenue, cost, time 
saved, or volume affected — with ranges, not point estimates.

SENSITIVITY TEST. Apply only to the top 1–2 highest-impact claims. 
Provide best/base/worst range. Do not apply mechanically to every paragraph.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ADVANCED DECISION LOGIC (MANDATORY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Explicitly call out the highest-impact segment ("where this matters most").
Identify thresholds or tipping points (where improvement accelerates or 
plateaus).
Evaluate trade-offs: cost vs impact, effort vs return, short-term vs 
long-term.
Test at least one alternative explanation (volume, complexity, data 
imbalance, external event).
Include visualization by default for comparisons, trends, or rankings.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RESPONSE STRUCTURE & WORD BUDGETS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DATA QUALITY NOTES          [50 words max]
  One block. Null rates, sample sizes, recency flags only.
  Omit entirely if all columns score 0–10% null and data is current.

1. DIRECT ANSWER             [40 words max]
  1–2 sentences. Lead with the single most important quantified result 
  and its business implication. Nothing else.

2. KEY FINDINGS              [250 words max]
  2–4 paragraphs. Numbers, segment-level insights, one clear outlier.
  Sensitivity range (best/base/worst) on top 1–2 claims only.
  Confidence label per paragraph: High (≥80%) | Medium (50–79%) | Low (<50%)
  Confidence degrades automatically per Data Quality Protocol above.

3. STRATEGIC INSIGHTS        [200 words max]
  Exactly 3–4 insights. Each labeled:
    [High Impact / Quick Win]
    [High Impact / Complex]
    [Risk / Anomaly]
    [Moderate Impact]

  Each insight format (strictly):
  → Observation (with numbers)
  → Business Impact (quantified range)
  → Specific Action (owner + deadline implied)

  Uncertainty & Scenarios (mandatory sub-section, 60 words max):
  How the recommendation changes under:
    Best case  (+20% upside assumption)
    Worst case (-20% downside assumption)

4. RECOMMENDED NEXT STEPS    [100 words max]
  Exactly 3 bullets:
  • VALIDATION → one analysis to confirm/challenge (owner + 7-day deadline)
  • EXPERIMENT → one test runnable within 14 days (owner + success metric)
  • DATA GAP   → one missing data point and the exact decision it would unlock

5. VISUALIZATION
  Use when showing comparisons, trends, or rankings.
  
  Preferred format:
  VISUALIZATION:
  {
    "type": "bar|line|pie|scatter|table",
    "title": "...",
    "description": "...",
    "data": {
      "labels": [...],
      "values": [...]
    }
  }

  Rules:
  • Max 12 data points per chart
  • Multiple charts allowed when they tell different parts of the story
  • Markdown table fallback only when JSON is impractical

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ANTI-GENERIC FILTER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Before finalizing output, run this self-check on every sentence:

  ✗ Could this sentence apply to any dataset?      → Rewrite with specific 
                                                      numbers and segments.
  ✗ Does it lack a number or decision implication? → Delete it.
  ✗ Does it not change what the executive should   → Discard it.
    do tomorrow?
  ✗ Is it hedging without a tie-breaking           → Apply Conflicting 
    resolution?                                      Signals Rule.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXECUTIVE RISK SCORE (FINAL LINE — MANDATORY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Score the recommendation using this rubric:

  RISK LEVEL
  • Low    — Recommended action has <15% chance of negative ROI if the 
             top assumption is wrong.
  • Medium — 15–35% chance of negative ROI if top assumption is wrong.
  • High   — >35% chance of negative ROI if top assumption is wrong, OR 
             the data has a null rate >30% on the primary driver, OR 
             sample size <30 on the key segment.

  CONFIDENCE IN ACTION
  Start at 90%. Apply deductions:
  • Primary driver null rate 11–30%  → –10%
  • Primary driver null rate 31–60%  → –25%
  • Sample size <30 on key segment   → –15%
  • Conflicting signals present       → –10%
  • Data older than 90 days          → –10%
  • No causal mechanism identified    → –5%

  Output format (one line, end of response):
  "Overall recommendation risk: [Low/Medium/High] | 
   Confidence in action: [X]% | 
   Primary assumption: [one sentence stating the assumption this 
   entire recommendation rests on]"
"""
    
    # ---------------------------------------------------------------------------
    # API Keys — resolved in priority order:
    #   1. LLM_API_KEY  (universal — injected by Secrets Manager in AWS deployments)
    #   2. Provider-specific key (OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY, HF_TOKEN)
    # ---------------------------------------------------------------------------
    llm_api_key: Optional[str] = field(default_factory=lambda: os.getenv("LLM_API_KEY"))
    hf_token: Optional[str] = field(default_factory=lambda: os.getenv("HF_TOKEN"))
    google_api_key: Optional[str] = field(default_factory=lambda: os.getenv("GOOGLE_API_KEY"))

    # Azure OpenAI — required only when model_provider == "azure_openai"
    azure_openai_endpoint: Optional[str] = field(default_factory=lambda: os.getenv("AZURE_OPENAI_ENDPOINT"))
    azure_openai_api_version: str = field(default_factory=lambda: os.getenv("AZURE_OPENAI_API_VERSION", "2024-08-01-preview"))

    def validate(self) -> None:
        """Validate agent configuration."""
        # In desktop mode the user configures the API key via the setup wizard
        # after installation, so we cannot require it at startup time.
        skip = bool(os.getenv("SKIP_KEY_VALIDATION")) or \
               os.getenv("ENVIRONMENT", "").lower() == "desktop"
        universal_key = self.llm_api_key

        if self.model_provider == "huggingface":
            if not self.hf_token:
                raise MissingConfigurationError("HF_TOKEN")

        elif self.model_provider == "openai":
            if not skip and not (universal_key or os.getenv("OPENAI_API_KEY")):
                raise MissingConfigurationError("LLM_API_KEY or OPENAI_API_KEY")

        elif self.model_provider == "azure_openai":
            if not skip and not (universal_key or os.getenv("AZURE_OPENAI_API_KEY")):
                raise MissingConfigurationError("LLM_API_KEY or AZURE_OPENAI_API_KEY")
            if not skip and not self.azure_openai_endpoint:
                raise MissingConfigurationError("AZURE_OPENAI_ENDPOINT")

        elif self.model_provider == "anthropic":
            if not skip and not (universal_key or os.getenv("ANTHROPIC_API_KEY")):
                raise MissingConfigurationError("LLM_API_KEY or ANTHROPIC_API_KEY")

        elif self.model_provider == "google":
            if not skip and not (universal_key or self.google_api_key):
                raise MissingConfigurationError("LLM_API_KEY or GOOGLE_API_KEY")

        # Fallback keys are checked at runtime to allow graceful degradation

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
        # "desktop" is a valid environment (Tauri sidecar sets ENVIRONMENT=desktop)
        if self.environment not in ["development", "staging", "production", "desktop"]:
            raise InvalidConfigurationError(
                "environment",
                "Must be one of: development, staging, production, desktop"
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


# Global configuration instance.
# We allow the server to start with an incomplete LLM config so that Railway/
# Docker deployments can boot and users can supply the key via the setup page.
# Endpoints that actually call the LLM check get_config() and return HTTP 503
# if the key is still missing.
import logging as _cfg_log
_cfg_logger = _cfg_log.getLogger(__name__)

def _load_config() -> 'AppConfig':
    try:
        return AppConfig.from_env()
    except MissingConfigurationError as exc:
        _cfg_logger.warning(
            "Server starting with incomplete configuration: %s. "
            "LLM features will be unavailable until the key is set "
            "via environment variables or the setup page.", exc
        )
        # Temporarily skip key validation so the process can boot.
        _prev = os.environ.get("SKIP_KEY_VALIDATION")
        os.environ["SKIP_KEY_VALIDATION"] = "1"
        try:
            return AppConfig.from_env()
        finally:
            if _prev is None:
                os.environ.pop("SKIP_KEY_VALIDATION", None)
            else:
                os.environ["SKIP_KEY_VALIDATION"] = _prev

config = _load_config()


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