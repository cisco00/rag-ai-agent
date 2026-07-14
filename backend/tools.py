"""
tools.py — Database tools for the Analytics Agent.

Fixes applied
─────────────
Bug #14 — Added get_foreign_keys and get_join_schema tools. main.py's system
           prompt instructs the agent to call these before writing JOIN queries,
           but they were missing from the tool_map, causing ToolExecutionError
           on every multi-table query attempt.
Bug #19 — validate_tool_call now recognises get_foreign_keys and get_join_schema
           instead of raising ValueError("Unknown tool").
           Also removed duplicate 'from typing import ...' line.
"""

from typing import Dict, List, Tuple, Any, Optional

from sqlalchemy import inspect as sa_inspect

from database import DatabaseManager
from analytics import calculate_correlation
from logging_config import get_logger

logger = get_logger(__name__)


def get_db_tools(db: DatabaseManager, tables: Optional[List[str]] = None) -> Tuple[List[Dict], Dict[str, Any]]:
    """
    Returns tool schemas and function mappings for database operations.

    Args:
        db:     DatabaseManager instance
        tables: Optional list of tables to restrict the agent to.

    Returns:
        Tuple of (tools_schema, tool_map)
    """
    logger.debug(f"Creating database tools (restricted tables: {tables})")

    tools_schema = [
        {
            "type": "function",
            "function": {
                "name": "list_tables",
                "description": (
                    "List all tables in the database. "
                    "Use this to discover what data is available before querying."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {},
                    "required": []
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "describe_table",
                "description": (
                    "Get the schema of a specific table, including column names and types. "
                    "Use this to understand the structure of a table before writing queries."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "table_name": {
                            "type": "string",
                            "description": "The name of the table to describe."
                        }
                    },
                    "required": ["table_name"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "execute_query",
                "description": (
                    "Execute a SQL query and return the results. "
                    "Always use SELECT queries for data retrieval. "
                    "Results are limited to 200 rows."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "sql": {
                            "type": "string",
                            "description": "The SQL query to execute."
                        }
                    },
                    "required": ["sql"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "calculate_correlation",
                "description": (
                    "Calculate the correlation matrix between numeric columns in a table. "
                    "Use this when the user asks about relationships or correlations between variables."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "table_name": {
                            "type": "string",
                            "description": "The name of the table to analyze."
                        },
                        "columns": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Optional list of columns to include. If omitted, all numeric columns are used."
                        },
                        "method": {
                            "type": "string",
                            "enum": ["pearson", "spearman", "kendall"],
                            "description": "Correlation method. Default is 'pearson'."
                        }
                    },
                    "required": ["table_name"]
                }
            }
        },
        # ── Bug #14: New JOIN-support tools ──────────────────────────────────
        {
            "type": "function",
            "function": {
                "name": "get_foreign_keys",
                "description": (
                    "Get foreign key relationships for a specific table. "
                    "Use this before writing a JOIN query to find the exact columns "
                    "to join on. Returns a list of FK constraints with the local "
                    "column, the referenced table, and the referenced column."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "table_name": {
                            "type": "string",
                            "description": "The table whose foreign keys you want to inspect."
                        }
                    },
                    "required": ["table_name"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "get_join_schema",
                "description": (
                    "Get the full schema of all tables AND their detected relationships "
                    "in a single call. Use this as the FIRST step whenever a query might "
                    "involve more than one table. Returns table columns plus join_hints "
                    "that show the exact columns to use in JOIN conditions."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {},
                    "required": []
                }
            }
        },
    ]

    # ── Tool implementations ──────────────────────────────────────────────────

    def list_tables_with_logging():
        logger.info("Tool called: list_tables")
        try:
            result = db.list_tables()
            if tables:
                result = [t for t in result if t in tables]
            logger.debug(f"list_tables returned {len(result)} tables")
            return result
        except Exception as e:
            logger.error(f"list_tables failed: {e}", exc_info=True)
            raise

    def describe_table_with_logging(table_name: str):
        logger.info(f"Tool called: describe_table(table_name={table_name})")
        if tables and table_name not in tables:
            msg = f"Table '{table_name}' is not in the allowed list: {tables}"
            logger.warning(msg)
            return {"error": msg}
        try:
            result = db.describe_table(table_name)
            logger.debug(f"describe_table returned {len(result)} columns")
            return result
        except Exception as e:
            logger.error(f"describe_table failed for '{table_name}': {e}", exc_info=True)
            raise

    def execute_query_with_logging(sql: str):
        logger.info(f"Tool called: execute_query(sql={sql[:100]}...)")
        try:
            result = db.execute_query(sql, max_rows=200, allow_modifications=False)
            logger.debug(f"execute_query returned {len(result)} rows")
            return result
        except Exception as e:
            logger.error(f"execute_query failed: {e}", exc_info=True)
            raise

    def calculate_correlation_with_logging(table_name: str,
                                           columns: Optional[List[str]] = None,
                                           method: str = "pearson"):
        logger.info(f"Tool called: calculate_correlation(table={table_name}, method={method})")
        if tables and table_name not in tables:
            msg = f"Table '{table_name}' is not in the allowed list: {tables}"
            logger.warning(msg)
            return {"error": msg}
        try:
            df     = db.get_table_data(table_name)
            result = calculate_correlation(df, columns, method)
            if "error" not in result:
                logger.info("Correlation calculation successful")
            return result
        except Exception as e:
            logger.error(f"calculate_correlation failed: {e}", exc_info=True)
            raise

    # ── Bug #14: get_foreign_keys implementation ──────────────────────────────
    def get_foreign_keys_impl(table_name: str) -> dict:
        """
        Return foreign key constraints for a table using SQLAlchemy inspector.
        Works on both SQLite and PostgreSQL.
        """
        logger.info(f"Tool called: get_foreign_keys(table_name={table_name})")
        if tables and table_name not in tables:
            msg = f"Table '{table_name}' is not in the allowed list: {tables}"
            logger.warning(msg)
            return {"error": msg}
        try:
            inspector = sa_inspect(db.engine)
            raw_fks   = inspector.get_foreign_keys(table_name)
            # Normalise to a flat list for the LLM
            fk_list = []
            for fk in raw_fks:
                for local_col, ref_col in zip(
                    fk.get("constrained_columns", []),
                    fk.get("referred_columns", [])
                ):
                    fk_list.append({
                        "local_table":  table_name,
                        "local_column": local_col,
                        "ref_table":    fk.get("referred_table"),
                        "ref_column":   ref_col,
                        "hint": f"{table_name}.{local_col} = {fk.get('referred_table')}.{ref_col} [explicit_fk]",
                    })
            logger.debug(f"get_foreign_keys: {len(fk_list)} FK(s) for {table_name}")
            return {"table": table_name, "foreign_keys": fk_list}
        except Exception as e:
            logger.error(f"get_foreign_keys failed for '{table_name}': {e}", exc_info=True)
            raise

    # ── Bug #14: get_join_schema implementation ───────────────────────────────
    def get_join_schema_impl() -> dict:
        """
        Return the schema for every table plus a flat list of join_hints built
        from detected foreign keys.  Covers both explicit FK constraints and
        common naming conventions (id / <table>_id heuristic).
        """
        logger.info("Tool called: get_join_schema")
        try:
            inspector   = sa_inspect(db.engine)
            all_tables  = db.list_tables()
            if tables:
                all_tables = [t for t in all_tables if t in tables]

            schema_info: Dict[str, Any] = {}
            join_hints:  List[str]      = []

            for table in all_tables:
                try:
                    cols  = db.describe_table(table)
                    raw_fks = inspector.get_foreign_keys(table)

                    fk_list = []
                    for fk in raw_fks:
                        for lc, rc in zip(
                            fk.get("constrained_columns", []),
                            fk.get("referred_columns", [])
                        ):
                            hint = f"{table}.{lc} = {fk['referred_table']}.{rc} [explicit_fk]"
                            fk_list.append(hint)
                            join_hints.append(hint)

                    # Heuristic: look for <other_table>_id columns
                    col_names = [c[0] for c in cols] if cols else []
                    for col in col_names:
                        if col.endswith("_id"):
                            inferred_table = col[:-3]  # strip _id
                            if inferred_table in all_tables:
                                hint = (
                                    f"{table}.{col} = {inferred_table}.id "
                                    f"[inferred_naming_convention]"
                                )
                                # Only add if no explicit FK already covers this
                                if not any(f"{table}.{col}" in h for h in join_hints):
                                    join_hints.append(hint)

                    schema_info[table] = {
                        "columns":      cols,
                        "foreign_keys": fk_list,
                    }
                except Exception as tbl_err:
                    logger.warning(f"get_join_schema: skipping table '{table}': {tbl_err}")
                    schema_info[table] = {"columns": [], "foreign_keys": [], "error": str(tbl_err)}

            logger.debug(f"get_join_schema: {len(all_tables)} tables, {len(join_hints)} hints")
            return {
                "schema":     schema_info,
                "join_hints": join_hints,
                "hint": (
                    "Use the join_hints to build JOIN conditions. "
                    "Prefer explicit_fk hints over inferred ones. "
                    "If no hint exists between two tables, check if they share a common business key."
                ),
            }
        except Exception as e:
            logger.error(f"get_join_schema failed: {e}", exc_info=True)
            raise

    # ── Tool map ──────────────────────────────────────────────────────────────
    tool_map = {
        "list_tables":         list_tables_with_logging,
        "describe_table":      describe_table_with_logging,
        "execute_query":       execute_query_with_logging,
        "calculate_correlation": calculate_correlation_with_logging,
        "get_foreign_keys":    get_foreign_keys_impl,    # Bug #14
        "get_join_schema":     get_join_schema_impl,     # Bug #14
    }

    logger.debug(f"Created {len(tools_schema)} database tools")
    return tools_schema, tool_map


def validate_tool_call(tool_name: str, arguments: Dict[str, Any]) -> None:
    """
    Validate tool call arguments.

    Fix #19: Now recognises get_foreign_keys and get_join_schema instead of
    raising ValueError("Unknown tool") for them.
    """
    if tool_name == "describe_table":
        if "table_name" not in arguments:
            raise ValueError("describe_table requires 'table_name' argument")
        if not isinstance(arguments["table_name"], str):
            raise ValueError("table_name must be a string")

    elif tool_name == "execute_query":
        if "sql" not in arguments:
            raise ValueError("execute_query requires 'sql' argument")
        if not isinstance(arguments["sql"], str):
            raise ValueError("sql must be a string")
        if not arguments["sql"].strip():
            raise ValueError("sql cannot be empty")
        if arguments.get("allow_modifications", False) is True:
            raise ValueError("LLM is not permitted to execute structural changes or modifications.")

    elif tool_name == "list_tables":
        pass  # no required arguments

    elif tool_name == "calculate_correlation":
        if "table_name" not in arguments:
            raise ValueError("calculate_correlation requires 'table_name' argument")

    elif tool_name == "get_foreign_keys":
        if "table_name" not in arguments:
            raise ValueError("get_foreign_keys requires 'table_name' argument")
        if not isinstance(arguments["table_name"], str):
            raise ValueError("table_name must be a string")

    elif tool_name == "get_join_schema":
        pass  # no required arguments

    else:
        raise ValueError(f"Unknown tool: {tool_name}")