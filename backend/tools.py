"""
Database tools for the Analytics Agent.

Enhanced in this version:
- get_foreign_keys  : discovers FK relationships (explicit + heuristic)
- get_join_schema   : one-shot full relational map (schema + relationships)
Both tools ground the agent's JOIN reasoning in real column/relationship data.
"""

from typing import Dict, List, Tuple, Any, Optional
from database import DatabaseManager
from analytics import calculate_correlation
from logging_config import get_logger

logger = get_logger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# FK Detection helper  (used by both new tools)
# ─────────────────────────────────────────────────────────────────────────────

def _detect_foreign_keys(
    db: DatabaseManager,
    allowed_tables: Optional[List[str]] = None,
) -> List[Dict[str, str]]:
    """
    Discover foreign-key relationships via two strategies:

    1. Explicit constraints — PRAGMA foreign_key_list (SQLite) or
       information_schema.table_constraints (PostgreSQL).
    2. Heuristic name matching — a column called <X>_id in table T is
       treated as a candidate FK to table X (singular/plural variants).

    Returns a deduplicated list of dicts:
      { from_table, from_col, to_table, to_col, source: "explicit_fk"|"heuristic" }
    """
    relationships: List[Dict[str, str]] = []
    seen: set = set()

    try:
        all_tables = db.list_tables()
        tables = [t for t in all_tables if not allowed_tables or t in allowed_tables]
        dialect = db.engine.dialect.name

        # ── 1. Explicit FK constraints ────────────────────────────────────────
        if dialect == "sqlite":
            for table in tables:
                try:
                    rows = db.execute_query(f'PRAGMA foreign_key_list("{table}")')
                    for row in rows:
                        key = (table, row["from"], row["table"], row["to"])
                        if key not in seen:
                            seen.add(key)
                            relationships.append({
                                "from_table": table,
                                "from_col":   row["from"],
                                "to_table":   row["table"],
                                "to_col":     row["to"],
                                "source":     "explicit_fk",
                            })
                except Exception:
                    pass

        elif dialect == "postgresql":
            try:
                fk_sql = """
                    SELECT
                        tc.table_name   AS from_table,
                        kcu.column_name AS from_col,
                        ccu.table_name  AS to_table,
                        ccu.column_name AS to_col
                    FROM information_schema.table_constraints AS tc
                    JOIN information_schema.key_column_usage  AS kcu
                      ON tc.constraint_name = kcu.constraint_name
                     AND tc.table_schema    = kcu.table_schema
                    JOIN information_schema.constraint_column_usage AS ccu
                      ON ccu.constraint_name = tc.constraint_name
                     AND ccu.table_schema    = tc.table_schema
                    WHERE tc.constraint_type = 'FOREIGN KEY'
                      AND tc.table_schema    = 'public'
                """
                for row in db.execute_query(fk_sql):
                    if allowed_tables and (
                        row["from_table"] not in allowed_tables
                        and row["to_table"] not in allowed_tables
                    ):
                        continue
                    key = (row["from_table"], row["from_col"], row["to_table"], row["to_col"])
                    if key not in seen:
                        seen.add(key)
                        relationships.append({**row, "source": "explicit_fk"})
            except Exception:
                pass

        # ── 2. Heuristic name matching ────────────────────────────────────────
        table_set = set(tables)
        schemas: Dict[str, Dict[str, str]] = {}
        for t in tables:
            try:
                schemas[t] = {col[0]: col[1] for col in db.describe_table(t)}
            except Exception:
                schemas[t] = {}

        for table, schema in schemas.items():
            for col_name in schema:
                if not col_name.lower().endswith("_id"):
                    continue
                ref_base = col_name.lower()[:-3]             # strip "_id"
                candidates = {ref_base, ref_base + "s"}      # singular + plural
                if ref_base.endswith("s"):
                    candidates.add(ref_base[:-1])            # de-plural

                for cand in candidates:
                    if cand not in table_set or cand == table:
                        continue
                    ref_col = next(
                        (c for c in schemas.get(cand, {}) if c.lower() == "id"), None
                    )
                    if ref_col:
                        key = (table, col_name, cand, ref_col)
                        if key not in seen:
                            seen.add(key)
                            relationships.append({
                                "from_table": table,
                                "from_col":   col_name,
                                "to_table":   cand,
                                "to_col":     ref_col,
                                "source":     "heuristic",
                            })

    except Exception as e:
        logger.warning(f"FK detection error: {e}")

    return relationships


# ─────────────────────────────────────────────────────────────────────────────
# Main tool factory
# ─────────────────────────────────────────────────────────────────────────────

def get_db_tools(
    db: DatabaseManager,
    tables: Optional[List[str]] = None,
) -> Tuple[List[Dict], Dict[str, Any]]:
    """
    Returns tool schemas and function mappings for database operations.

    Args:
        db:     DatabaseManager instance
        tables: Optional allowlist — agent may only access these tables.

    Returns:
        (tools_schema, tool_map)
    """
    logger.debug(f"Creating database tools (restricted tables: {tables})")

    tools_schema = [
        # ── Existing tools ────────────────────────────────────────────────────
        {
            "type": "function",
            "function": {
                "name": "list_tables",
                "description": (
                    "List all available tables in the database. "
                    "Use this first to discover what data exists before querying."
                ),
                "parameters": {"type": "object", "properties": {}, "required": []},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "describe_table",
                "description": (
                    "Get column names and data types for a single table. "
                    "Always call this before writing queries to use correct column names."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "table_name": {
                            "type": "string",
                            "description": "Name of the table to inspect.",
                        }
                    },
                    "required": ["table_name"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "execute_query",
                "description": (
                    "Execute a SQL SELECT query and return the results (max 200 rows). "
                    "Use only verified column names. Never show SQL to the user."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "sql": {
                            "type": "string",
                            "description": "A valid SQL SELECT statement.",
                        }
                    },
                    "required": ["sql"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "calculate_correlation",
                "description": (
                    "Calculate the correlation matrix between numeric columns in a table. "
                    "Use when the user asks about relationships or correlations."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "table_name": {
                            "type": "string",
                            "description": "The table to analyse.",
                        },
                        "columns": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Columns to include. Omit to use all numeric columns.",
                        },
                        "method": {
                            "type": "string",
                            "enum": ["pearson", "spearman", "kendall"],
                            "description": "Correlation method. Default: pearson.",
                        },
                    },
                    "required": ["table_name"],
                },
            },
        },

        # ── New multi-table tools ─────────────────────────────────────────────
        {
            "type": "function",
            "function": {
                "name": "get_foreign_keys",
                "description": (
                    "Discover how tables are related. Returns every foreign-key "
                    "relationship detected — both explicit DB constraints and "
                    "heuristic column-name matches (e.g. orders.customer_id → customers.id). "
                    "ALWAYS call this before writing any JOIN query so you know exactly "
                    "which columns to join on. Do not guess join columns."
                ),
                "parameters": {"type": "object", "properties": {}, "required": []},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_join_schema",
                "description": (
                    "One-shot call returning ALL tables with their columns AND all detected "
                    "relationships between them. More efficient than calling list_tables + "
                    "describe_table + get_foreign_keys separately. "
                    "Use this whenever the question might span more than one table."
                ),
                "parameters": {"type": "object", "properties": {}, "required": []},
            },
        },
    ]

    # ── Wrapper implementations ───────────────────────────────────────────────

    def list_tables_fn():
        logger.info("Tool: list_tables")
        result = db.list_tables()
        if tables:
            result = [t for t in result if t in tables]
        logger.debug(f"list_tables → {len(result)} tables")
        return result

    def describe_table_fn(table_name: str):
        logger.info(f"Tool: describe_table({table_name})")
        if tables and table_name not in tables:
            return {"error": f"Table '{table_name}' not in allowed list: {tables}"}
        result = db.describe_table(table_name)
        logger.debug(f"describe_table({table_name}) → {len(result)} cols")
        return result

    def execute_query_fn(sql: str):
        logger.info(f"Tool: execute_query sql={sql[:120]}...")
        result = db.execute_query(sql, max_rows=200)
        logger.debug(f"execute_query → {len(result)} rows")
        return result

    def calculate_correlation_fn(
        table_name: str,
        columns: Optional[List[str]] = None,
        method: str = "pearson",
    ):
        logger.info(f"Tool: calculate_correlation({table_name}, method={method})")
        if tables and table_name not in tables:
            return {"error": f"Table '{table_name}' not in allowed list: {tables}"}
        df = db.get_table_data(table_name)
        return calculate_correlation(df, columns, method)

    def get_foreign_keys_fn():
        logger.info("Tool: get_foreign_keys")
        rels = _detect_foreign_keys(db, allowed_tables=tables)
        logger.debug(f"get_foreign_keys → {len(rels)} relationships")
        if not rels:
            return {
                "message": (
                    "No foreign-key relationships detected automatically. "
                    "Tables may be unrelated, or joins may need to be on non-id columns "
                    "(e.g. matching on email or name). Use describe_table to inspect columns."
                ),
                "relationships": [],
                "join_hints": [],
            }
        hints = [
            f'{r["from_table"]}.{r["from_col"]} = {r["to_table"]}.{r["to_col"]}  [{r["source"]}]'
            for r in rels
        ]
        return {
            "relationships": rels,
            "join_hints": hints,
            "count": len(rels),
        }

    def get_join_schema_fn():
        logger.info("Tool: get_join_schema")
        all_tables = db.list_tables()
        if tables:
            all_tables = [t for t in all_tables if t in tables]

        schema_map: Dict[str, List[Dict]] = {}
        for t in all_tables:
            try:
                cols = db.describe_table(t)
                schema_map[t] = [{"column": c[0], "type": c[1]} for c in cols]
            except Exception:
                schema_map[t] = []

        rels = _detect_foreign_keys(db, allowed_tables=tables)
        hints = [
            f'{r["from_table"]}.{r["from_col"]} = {r["to_table"]}.{r["to_col"]}  [{r["source"]}]'
            for r in rels
        ]

        logger.debug(f"get_join_schema → {len(all_tables)} tables, {len(rels)} rels")
        return {
            "tables": schema_map,
            "relationships": rels,
            "join_hints": hints,
            "summary": (
                f"{len(all_tables)} tables, {len(rels)} relationship(s) detected. "
                "Use join_hints to construct accurate JOIN queries."
            ),
        }

    # ─────────────────────────────────────────────────────────────────────────
    tool_map = {
        "list_tables":           list_tables_fn,
        "describe_table":        describe_table_fn,
        "execute_query":         execute_query_fn,
        "calculate_correlation": calculate_correlation_fn,
        "get_foreign_keys":      get_foreign_keys_fn,
        "get_join_schema":       get_join_schema_fn,
    }

    logger.debug(f"Created {len(tools_schema)} database tools")
    return tools_schema, tool_map


# ─────────────────────────────────────────────────────────────────────────────
# Argument validation helper (called from QueryProcessor)
# ─────────────────────────────────────────────────────────────────────────────

def validate_tool_call(tool_name: str, arguments: Dict[str, Any]) -> None:
    if tool_name == "describe_table":
        if "table_name" not in arguments:
            raise ValueError("describe_table requires 'table_name'")
        if not isinstance(arguments["table_name"], str):
            raise ValueError("table_name must be a string")
    elif tool_name == "execute_query":
        if "sql" not in arguments:
            raise ValueError("execute_query requires 'sql'")
        if not isinstance(arguments["sql"], str):
            raise ValueError("sql must be a string")
        if not arguments["sql"].strip():
            raise ValueError("sql cannot be empty")
    elif tool_name in ("list_tables", "get_foreign_keys", "get_join_schema"):
        pass   # no required args
    else:
        raise ValueError(f"Unknown tool: {tool_name}")