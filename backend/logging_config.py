"""
Logging configuration for the RAG AI Agent application.

This module sets up structured logging with consistent formatting across
all modules, supporting both file and console output.
"""

import logging
import logging.handlers
import sys
from pathlib import Path
from typing import Optional
import json
from datetime import datetime


class JSONFormatter(logging.Formatter):
    """
    Custom JSON formatter for structured logging.
    
    Outputs log records as JSON for easier parsing and analysis.
    """
    
    def format(self, record: logging.LogRecord) -> str:
        """Format log record as JSON."""
        log_data = {
            "timestamp": datetime.utcnow().isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "function": record.funcName,
            "line": record.lineno,
        }
        
        # Add exception info if present
        if record.exc_info:
            log_data["exception"] = self.formatException(record.exc_info)
        
        # Add extra fields if present
        if hasattr(record, "extra_fields"):
            log_data.update(record.extra_fields)
        
        # Add any custom attributes
        for key, value in record.__dict__.items():
            if key not in [
                "name", "msg", "args", "created", "filename", "funcName",
                "levelname", "levelno", "lineno", "module", "msecs",
                "message", "pathname", "process", "processName",
                "relativeCreated", "thread", "threadName", "exc_info",
                "exc_text", "stack_info", "extra_fields"
            ]:
                log_data[key] = value
        
        return json.dumps(log_data)


class ColoredFormatter(logging.Formatter):
    """
    Custom formatter that adds colors to console output.
    """
    
    # ANSI color codes
    COLORS = {
        'DEBUG': '\033[36m',      # Cyan
        'INFO': '\033[32m',       # Green
        'WARNING': '\033[33m',    # Yellow
        'ERROR': '\033[31m',      # Red
        'CRITICAL': '\033[35m',   # Magenta
        'RESET': '\033[0m'        # Reset
    }
    
    def format(self, record: logging.LogRecord) -> str:
        """Format log record with colors."""
        # Add color to level name
        levelname = record.levelname
        if levelname in self.COLORS:
            record.levelname = (
                f"{self.COLORS[levelname]}{levelname}{self.COLORS['RESET']}"
            )
        
        # Format the message
        formatted = super().format(record)
        
        # Reset levelname for next use
        record.levelname = levelname
        
        return formatted


def setup_logging(
    name: Optional[str] = None,
    log_level: str = "INFO",
    log_to_file: bool = True,
    log_file: str = "logs/rag_agent.log",
    log_to_console: bool = True,
    json_format: bool = False,
    max_bytes: int = 10 * 1024 * 1024,  # 10MB
    backup_count: int = 5
) -> logging.Logger:
    """
    Set up logging configuration.
    
    Args:
        name: Logger name (defaults to root logger)
        log_level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        log_to_file: Whether to log to file
        log_file: Path to log file
        log_to_console: Whether to log to console
        json_format: Whether to use JSON format for file logs
        max_bytes: Maximum size of log file before rotation
        backup_count: Number of backup files to keep
    
    Returns:
        Configured logger instance
    """
    # Get or create logger
    logger = logging.getLogger(name)
    logger.setLevel(getattr(logging, log_level.upper()))
    
    # Remove existing handlers to avoid duplicates
    logger.handlers.clear()
    
    # Create formatters
    if json_format:
        file_formatter = JSONFormatter()
    else:
        file_formatter = logging.Formatter(
            fmt='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
    
    console_formatter = ColoredFormatter(
        fmt='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    # Add file handler if requested
    if log_to_file:
        # Create log directory if it doesn't exist
        log_path = Path(log_file)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Create rotating file handler
        file_handler = logging.handlers.RotatingFileHandler(
            log_file,
            maxBytes=max_bytes,
            backupCount=backup_count,
            encoding='utf-8'
        )
        file_handler.setLevel(getattr(logging, log_level.upper()))
        file_handler.setFormatter(file_formatter)
        logger.addHandler(file_handler)
    
    # Add console handler if requested
    if log_to_console:
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(getattr(logging, log_level.upper()))
        console_handler.setFormatter(console_formatter)
        logger.addHandler(console_handler)
    
    # Prevent propagation to root logger
    logger.propagate = False
    
    return logger


def get_logger(name: str) -> logging.Logger:
    """
    Get a logger instance with the application's configuration.
    
    Args:
        name: Name of the logger (typically __name__)
    
    Returns:
        Configured logger instance
    """
    # Import here to avoid circular dependency
    try:
        from config import get_logging_config
        log_config = get_logging_config()
        
        return setup_logging(
            name=name,
            log_level=log_config.log_level,
            log_to_file=log_config.log_to_file,
            log_file=log_config.log_file,
            log_to_console=log_config.log_to_console,
            max_bytes=log_config.max_log_size,
            backup_count=log_config.backup_count
        )
    except Exception:
        # Fallback to basic configuration if config module fails
        return setup_logging(name=name)


class LoggerAdapter(logging.LoggerAdapter):
    """
    Custom logger adapter that adds contextual information to log records.
    
    Useful for adding request IDs, user IDs, or other context to all logs.
    """
    
    def process(self, msg, kwargs):
        """Add extra context to log records."""
        # Add extra fields to the record
        if 'extra' not in kwargs:
            kwargs['extra'] = {}
        
        # Merge adapter's extra with call's extra
        kwargs['extra'].update(self.extra)
        
        return msg, kwargs


def create_context_logger(name: str, **context) -> LoggerAdapter:
    """
    Create a logger with additional context.
    
    Args:
        name: Logger name
        **context: Additional context to add to all log messages
    
    Returns:
        Logger adapter with context
    
    Example:
        >>> logger = create_context_logger(__name__, request_id="123", user_id="456")
        >>> logger.info("Processing request")
        # Logs will include request_id and user_id
    """
    logger = get_logger(name)
    return LoggerAdapter(logger, context)


# Initialize root logger when module is imported
_root_logger = get_logger("rag_agent")


def log_function_call(func):
    """
    Decorator to log function calls with arguments and return values.
    
    Example:
        >>> @log_function_call
        >>> def my_function(arg1, arg2):
        >>>     return arg1 + arg2
    """
    import functools
    
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        logger = get_logger(func.__module__)
        logger.debug(
            f"Calling {func.__name__}",
            extra={
                "function": func.__name__,
                "func_args": str(args)[:100],  # Limit length
                "func_kwargs": str(kwargs)[:100],
            }
        )
        
        try:
            result = func(*args, **kwargs)
            logger.debug(
                f"{func.__name__} completed successfully",
                extra={"function": func.__name__}
            )
            return result
        except Exception as e:
            logger.error(
                f"{func.__name__} failed with error: {str(e)}",
                exc_info=True,
                extra={"function": func.__name__}
            )
            raise
    
    return wrapper