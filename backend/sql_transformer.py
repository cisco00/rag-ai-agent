"""
sql_transformer.py — Compile transformation ops into a SQL CTE chain.

Pushes work into the database engine so rows never leave the DB until the
final SELECT.  Supports SQLite ≥3.25, PostgreSQL, MySQL 8+, and SQL Server.

Usage
-----
result = SQLTransformer.compile(
    table_name  = "sales",
    ops         = [...],          # backend canonical ops from mapOpForBackend()
    dialect     = "postgresql",   # inferred automatically in endpoints
    all_columns = ["id","amount","email"],
)

result keys
-----------
  sql             : str | None — full CTE query; None if nothing could compile
  params          : dict       — SQLAlchemy bind params  {:p0: value, ...}
  compiled_ops    : list       — ops successfully compiled to SQL
  skipped_ops     : list       — ops that need Pandas fallback
  output_columns  : list[str]  — column list after the last compiled step
  cte_count       : int
"""

from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)

Op     = dict[str, Any]
SQL    = str
Params = dict[str, Any]


# ── Ops that can always be compiled to pure SQL ──────────────────────────────

_ALWAYS_SQL = {
    "drop_col", "rename_col", "filter", "change_type",
    "feature_engineering", "text_feature", "drop_duplicates",
    "clean",   # forwarded from backend canonical clean_text
    "drop_row",
}

_SUBQUERY_SQL = {
    "fill_na", "normalize", "groupby", "aggregate",
}

ALL_SQL_OPS: set[str] = _ALWAYS_SQL | _SUBQUERY_SQL

# Ops that work row-by-row (safe to apply in chunks)
ROW_INDEPENDENT_OPS: set[str] = {
    "drop_col", "rename_col", "filter", "change_type",
    "clean_text", "clean", "drop_row",
}


# ── Dialect wrapper ──────────────────────────────────────────────────────────

class _Dialect:
    def __init__(self, name: str) -> None:
        self.name = name.lower()
        # Normalise driver suffix  postgresql+psycopg2 → postgresql
        if "+" in self.name:
            self.name = self.name.split("+")[0]

    def qi(self, identifier: str) -> str:
        """Quote an identifier (table / column name)."""
        if self.name == "mssql":
            return f"[{identifier}]"
        return f'"{identifier}"'

    def cast(self, expr: str, to_type: str) -> str:
        type_map: dict[str, str] = {
            "int":      "INTEGER",
            "float":    "REAL" if self.name == "sqlite" else "DOUBLE PRECISION",
            "str":      "TEXT" if self.name == "sqlite" else "VARCHAR(65535)",
            "datetime": "TEXT" if self.name == "sqlite" else "TIMESTAMP",
            "bool":     "INTEGER" if self.name == "sqlite" else "BOOLEAN",
        }
        return f"CAST({expr} AS {type_map.get(to_type, 'TEXT')})"

    def length(self, expr: str) -> str:
        return f"LEN({expr})" if self.name == "mssql" else f"LENGTH({expr})"

    def title_case(self, expr: str) -> str | None:
        """Return INITCAP expression, or None if unsupported."""
        if self.name == "postgresql":
            return f"INITCAP({expr})"
        return None   # caller must fall back to Pandas

    def coalesce(self, *args: str) -> str:
        return f"COALESCE({', '.join(args)})"


# ── Main compiler ────────────────────────────────────────────────────────────

class SQLTransformer:
    """
    Compile a list of ops to a CTE chain.

    Call the class method ``compile``; do not instantiate directly.
    """

    def __init__(self, table_name: str, dialect_name: str) -> None:
        self._table_name = table_name
        self._d          = _Dialect(dialect_name)
        self._params: Params = {}
        self._ctr        = 0

    # ── Bind parameter helper ────────────────────────────────────────────────

    def _p(self, value: Any) -> str:
        name = f"p{self._ctr}"
        self._ctr += 1
        self._params[name] = value
        return f":{name}"

    # ── Per-op compilers ─────────────────────────────────────────────────────
    # Each returns (sql_fragment | None, new_column_list)
    # sql_fragment may contain __PREV__ as a placeholder for the previous CTE
    # name; the caller replaces it.

    def _drop_col(self, op: Op, cols: list[str]) -> tuple[SQL, list[str]]:
        col      = op.get("column", "")
        new_cols = [c for c in cols if c != col]
        select   = ", ".join(self._d.qi(c) for c in new_cols)
        return f"SELECT {select} FROM __PREV__", new_cols

    def _rename_col(self, op: Op, cols: list[str]) -> tuple[SQL, list[str]]:
        old      = op.get("column", "")
        new      = op.get("new_name", old)
        new_cols = []
        parts    = []
        for c in cols:
            if c == old:
                parts.append(f"{self._d.qi(c)} AS {self._d.qi(new)}")
                new_cols.append(new)
            else:
                parts.append(self._d.qi(c))
                new_cols.append(c)
        return f"SELECT {', '.join(parts)} FROM __PREV__", new_cols

    def _filter(self, op: Op, cols: list[str]) -> tuple[SQL, list[str]]:
        col      = self._d.qi(op.get("column", ""))
        operator = op.get("op", op.get("operator", ">"))
        value    = op.get("value", 0)

        op_map   = {">": ">", "<": "<", "==": "=", "!=": "<>", ">=": ">=", "<=": "<="}
        sql_op   = op_map.get(str(operator), "=")

        try:
            bound = self._p(float(value))
        except (TypeError, ValueError):
            bound = self._p(str(value))

        return f"SELECT * FROM __PREV__ WHERE {col} {sql_op} {bound}", cols

    def _drop_row(self, op: Op, cols: list[str]) -> tuple[SQL | None, list[str]]:
        """
        Compile drop_row to SQL WHERE clause (inverse of _filter).

        mode = "null"      → WHERE col IS NOT NULL  (or drop any-null row)
        mode = "condition" → WHERE NOT (col op value)  (inverse filter)
        mode = "empty_str" → WHERE TRIM(CAST(col AS TEXT)) <> ''
        mode = "outlier"   → Pandas only (needs stddev subquery; too dialect-sensitive)
        """
        mode   = op.get("mode", "null")
        col_id = op.get("column", "")

        if mode == "null":
            if col_id:
                q = self._d.qi(col_id)
                return f"SELECT * FROM __PREV__ WHERE {q} IS NOT NULL", cols
            else:
                # Drop rows with ANY null: use NOT EXISTS trick across cols
                # Fallback to Pandas for >4 columns (verbose SQL)
                if len(cols) > 4:
                    return None, cols
                conditions = " AND ".join(f"{self._d.qi(c)} IS NOT NULL" for c in cols)
                return f"SELECT * FROM __PREV__ WHERE {conditions}", cols

        elif mode == "condition":
            operator = op.get("op") or op.get("operator", "==")
            value    = op.get("value", 0)
            if not col_id:
                return None, cols
            q      = self._d.qi(col_id)
            op_map = {">": ">", "<": "<", "==": "=", "!=": "<>", ">=": ">=", "<=": "<="}
            sql_op = op_map.get(str(operator), "=")
            try:
                bound = self._p(float(value))
            except (TypeError, ValueError):
                bound = self._p(str(value))
            # Drop rows WHERE condition matches → keep WHERE NOT (match)
            return f"SELECT * FROM __PREV__ WHERE NOT ({q} {sql_op} {bound})", cols

        elif mode == "empty_str":
            if not col_id:
                return None, cols
            q = self._d.qi(col_id)
            return f"SELECT * FROM __PREV__ WHERE TRIM(CAST({q} AS TEXT)) <> ''", cols

        # outlier → Pandas
        return None, cols

    def _change_type(self, op: Op, cols: list[str]) -> tuple[SQL, list[str]]:
        col      = op.get("column", "")
        new_type = op.get("new_type", "str")
        parts    = []
        for c in cols:
            if c == col:
                parts.append(f"{self._d.cast(self._d.qi(c), new_type)} AS {self._d.qi(c)}")
            else:
                parts.append(self._d.qi(c))
        return f"SELECT {', '.join(parts)} FROM __PREV__", cols

    def _clean_text(self, op: Op, cols: list[str]) -> tuple[SQL | None, list[str]]:
        col        = op.get("column", "")
        clean_type = op.get("clean_type", op.get("method", "lower"))
        q          = self._d.qi(col)
        parts      = []
        for c in cols:
            if c == col:
                if clean_type == "lower":
                    expr = f"LOWER({q})"
                elif clean_type == "upper":
                    expr = f"UPPER({q})"
                elif clean_type == "trim":
                    expr = f"TRIM({q})"
                elif clean_type == "title":
                    expr = self._d.title_case(q)
                    if expr is None:
                        return None, cols  # needs Pandas
                else:
                    return None, cols
                parts.append(f"{expr} AS {self._d.qi(c)}")
            else:
                parts.append(self._d.qi(c))
        return f"SELECT {', '.join(parts)} FROM __PREV__", cols

    def _fill_na(self, op: Op, cols: list[str]) -> tuple[SQL | None, list[str]]:
        col    = op.get("column", "")
        method = op.get("method", "value")
        value  = op.get("value", "")
        q      = self._d.qi(col)

        if method == "value":
            if value == "" or value is None:
                return None, cols
            fill_expr = self._d.coalesce(q, self._p(value))
        elif method in ("mean", "avg"):
            fill_expr = self._d.coalesce(q, f"(SELECT AVG({q}) FROM __PREV__)")
        elif method == "min":
            fill_expr = self._d.coalesce(q, f"(SELECT MIN({q}) FROM __PREV__)")
        elif method == "max":
            fill_expr = self._d.coalesce(q, f"(SELECT MAX({q}) FROM __PREV__)")
        elif method == "mode":
            fill_expr = self._d.coalesce(
                q,
                f"(SELECT {q} FROM __PREV__ WHERE {q} IS NOT NULL "
                f"GROUP BY {q} ORDER BY COUNT(*) DESC LIMIT 1)"
            )
        else:
            return None, cols  # median etc. → Pandas

        parts = []
        for c in cols:
            if c == col:
                parts.append(f"{fill_expr} AS {self._d.qi(c)}")
            else:
                parts.append(self._d.qi(c))
        return f"SELECT {', '.join(parts)} FROM __PREV__", cols

    def _drop_duplicates(self, op: Op, cols: list[str]) -> tuple[SQL, list[str]]:
        subset_raw = op.get("subset", "")
        sub_cols   = [c.strip() for c in subset_raw.split(",") if c.strip()] if subset_raw else cols
        all_sel    = ", ".join(self._d.qi(c) for c in cols)
        part_expr  = ", ".join(self._d.qi(c) for c in sub_cols)
        # ROW_NUMBER with ORDER BY (SELECT 1) is portable across SQLite/PG/MySQL
        sql = (
            f"SELECT {all_sel} FROM ("
            f"  SELECT *, ROW_NUMBER() OVER (PARTITION BY {part_expr} "
            f"  ORDER BY (SELECT 1)) AS __rn__ FROM __PREV__"
            f") __t__ WHERE __rn__ = 1"
        )
        return sql, cols

    def _normalize(self, op: Op, cols: list[str]) -> tuple[SQL | None, list[str]]:
        norm_cols = op.get("columns", [])
        if isinstance(norm_cols, str):
            norm_cols = [c.strip() for c in norm_cols.split(",") if c.strip()]
        if not norm_cols:
            return None, cols

        method = op.get("method", "minmax")
        parts  = []

        if method == "minmax":
            for c in cols:
                if c in norm_cols:
                    q = self._d.qi(c)
                    # (col - MIN) / (MAX - MIN), guarded against zero range
                    expr = (
                        f"CASE WHEN (SELECT MAX({q}) FROM __PREV__) = "
                        f"(SELECT MIN({q}) FROM __PREV__) THEN 0.0 "
                        f"ELSE CAST({q} - (SELECT MIN({q}) FROM __PREV__) AS REAL) / "
                        f"((SELECT MAX({q}) FROM __PREV__) - (SELECT MIN({q}) FROM __PREV__)) END"
                    )
                    parts.append(f"{expr} AS {self._d.qi(c)}")
                else:
                    parts.append(self._d.qi(c))
            return f"SELECT {', '.join(parts)} FROM __PREV__", cols

        elif method == "zscore":
            for c in cols:
                if c in norm_cols:
                    q = self._d.qi(c)
                    expr = (
                        f"CASE WHEN (SELECT AVG(({q} - (SELECT AVG({q}) FROM __PREV__)) * "
                        f"({q} - (SELECT AVG({q}) FROM __PREV__)) FROM __PREV__) = 0 THEN 0.0 "
                        f"ELSE CAST({q} - (SELECT AVG({q}) FROM __PREV__) AS REAL) / "
                        f"SQRT((SELECT AVG(({q} - (SELECT AVG({q}) FROM __PREV__)) * "
                        f"({q} - (SELECT AVG({q}) FROM __PREV__)) FROM __PREV__)) END"
                    )
                    parts.append(f"{expr} AS {self._d.qi(c)}")
                else:
                    parts.append(self._d.qi(c))
            return f"SELECT {', '.join(parts)} FROM __PREV__", cols

        return None, cols  # log transform → Pandas

    def _groupby(self, op: Op, cols: list[str]) -> tuple[SQL | None, list[str]]:
        group_cols   = [c.strip() for c in op.get("group_cols", "").split(",") if c.strip()]
        aggs_raw     = op.get("aggregations", {})
        if isinstance(aggs_raw, str):
            try:
                aggs_raw = json.loads(aggs_raw)
            except Exception:
                aggs_raw = {}
        if not group_cols:
            return None, cols

        _agg_fn = {
            "sum": "SUM", "mean": "AVG", "avg": "AVG",
            "min": "MIN", "max": "MAX", "count": "COUNT",
        }
        select_parts = [self._d.qi(c) for c in group_cols]
        new_cols     = list(group_cols)

        for agg_col, funcs in (aggs_raw or {}).items():
            if isinstance(funcs, str):
                funcs = [funcs]
            for fn in funcs:
                sql_fn = _agg_fn.get(fn.lower())
                if not sql_fn:
                    continue
                alias = f"{agg_col}_{fn}"
                select_parts.append(f"{sql_fn}({self._d.qi(agg_col)}) AS {self._d.qi(alias)}")
                new_cols.append(alias)

        group_expr  = ", ".join(self._d.qi(c) for c in group_cols)
        select_expr = ", ".join(select_parts)
        return f"SELECT {select_expr} FROM __PREV__ GROUP BY {group_expr}", new_cols

    def _feature_engineering(self, op: Op, cols: list[str]) -> tuple[SQL | None, list[str]]:
        feat_type = op.get("feature_type", op.get("feat_type", "interaction"))
        if feat_type != "interaction":
            return None, cols
        c1   = op.get("column1", "")
        c2   = op.get("column2", "")
        oper = op.get("operation", "*")
        if not c1 or not c2:
            return None, cols
        op_map = {"*": "*", "/": "/", "+": "+", "-": "-"}
        sql_op = op_map.get(oper, "*")
        alias  = f"{c1}_{oper}_{c2}".replace("/", "_div_").replace("*", "_mul_")
        expr   = f"CAST({self._d.qi(c1)} AS REAL) {sql_op} CAST({self._d.qi(c2)} AS REAL)"
        all_sel = ", ".join(self._d.qi(c) for c in cols)
        return f"SELECT {all_sel}, {expr} AS {self._d.qi(alias)} FROM __PREV__", cols + [alias]

    def _text_feature(self, op: Op, cols: list[str]) -> tuple[SQL | None, list[str]]:
        col    = op.get("column", "")
        method = op.get("method", op.get("feature", "len"))
        if method != "len" or not col:
            return None, cols
        alias   = f"{col}_length"
        all_sel = ", ".join(self._d.qi(c) for c in cols)
        return f"SELECT {all_sel}, {self._d.length(self._d.qi(col))} AS {self._d.qi(alias)} FROM __PREV__", cols + [alias]

    # ── Phase 2 SQL compilers ─────────────────────────────────────────────────

    def _sample(self, op: Op, cols: list[str]) -> tuple[SQL | None, list[str]]:
        """TABLESAMPLE / ORDER BY RANDOM() LIMIT — deterministic per dialect."""
        method = op.get("method", "n")
        if method == "pct":
            pct = max(1, min(100, int(float(op.get("pct", 10)))))
            # PostgreSQL TABLESAMPLE BERNOULLI; fall back to Pandas for others
            if self._d.name == "postgresql":
                return f"SELECT * FROM __PREV__ TABLESAMPLE BERNOULLI({pct})", cols
            return None, cols   # → Pandas
        else:
            n = max(1, int(op.get("n", 100)))
            if self._d.name in ("sqlite", "postgresql"):
                return f"SELECT * FROM __PREV__ ORDER BY RANDOM() LIMIT {n}", cols
            elif self._d.name == "mysql":
                return f"SELECT * FROM __PREV__ ORDER BY RAND() LIMIT {n}", cols
            elif self._d.name == "mssql":
                return f"SELECT TOP {n} * FROM __PREV__ ORDER BY NEWID()", cols
            return None, cols

    def _union_sql(self, op: Op, cols: list[str]) -> tuple[SQL | None, list[str]]:
        """UNION ALL / UNION DISTINCT with a second table."""
        right_table = op.get("right_table", "")
        if not right_table:
            return None, cols
        mode = op.get("mode", "all")
        keyword = "UNION ALL" if mode == "all" else "UNION"
        select = ", ".join(self._d.qi(c) for c in cols)
        return f"SELECT {select} FROM __PREV__ {keyword} SELECT {select} FROM {self._d.qi(right_table)}", cols

    def _join_sql(self, op: Op, cols: list[str]) -> tuple[SQL | None, list[str]]:
        """JOIN two tables via SQL."""
        right_table = op.get("right_table", "")
        left_key    = op.get("left_key", "")
        right_key   = op.get("right_key", left_key)
        how         = op.get("how", "inner").upper()
        if not right_table or not left_key:
            return None, cols
        how_map = {"INNER": "INNER", "LEFT": "LEFT", "RIGHT": "RIGHT", "OUTER": "FULL OUTER"}
        sql_how = how_map.get(how, "INNER")
        # We don't know right table's columns here; return None so Pandas handles it
        # (column list merging is non-trivial in SQL without schema info)
        return None, cols   # always Pandas for join — avoids column name collisions

    # ── Dispatch ─────────────────────────────────────────────────────────────

    def _dispatch(self, op: Op, cols: list[str]) -> tuple[SQL | None, list[str]]:
        t = op.get("type", "")
        # Handle backend canonical "clean" type
        if t == "clean":
            m = op.get("method", "")
            if m == "clean_text":
                return self._clean_text(op, cols)
            elif m in ("drop_duplicates", "dedup"):
                return self._drop_duplicates(op, cols)
            return None, cols

        # Handle backend canonical "aggregate" type
        if t == "aggregate":
            if op.get("method") == "groupby":
                return self._groupby(op, cols)
            return None, cols

        dispatch = {
            "drop_col":           self._drop_col,
            "rename_col":         self._rename_col,
            "filter":             self._filter,
            "change_type":        self._change_type,
            "clean_text":         self._clean_text,
            "fill_na":            self._fill_na,
            "drop_duplicates":    self._drop_duplicates,
            "normalize":          self._normalize,
            "groupby":            self._groupby,
            "feature_engineering":self._feature_engineering,
            "text_feature":       self._text_feature,
            # Phase 2
            "sample":             self._sample,
            "union":              self._union_sql,
            # join → always Pandas (column collision safety)
            "join":               self._join_sql,
            # Phase 4
            "drop_row":           self._drop_row,
            # Pandas-only Phase 2 ops — return None immediately
            "regex_extract":      lambda op, cols: (None, cols),
            "formula_col":        lambda op, cols: (None, cols),
            "pivot":              lambda op, cols: (None, cols),
            "unpivot":            lambda op, cols: (None, cols),
        }
        fn = dispatch.get(t)
        if fn:
            return fn(op, cols)
        return None, cols

    # ── Main entry point ─────────────────────────────────────────────────────

    @classmethod
    def compile(
        cls,
        table_name:  str,
        ops:         list[Op],
        dialect:     str = "sqlite",
        all_columns: list[str] | None = None,
    ) -> dict:
        """
        Compile *ops* to a CTE chain.

        Returns dict with keys:
          sql, params, compiled_ops, skipped_ops, output_columns, cte_count
        """
        inst      = cls(table_name, dialect)
        d         = inst._d
        ctes:     list[tuple[str, str]] = []
        cur_cols  = list(all_columns or [])
        compiled: list[Op] = []
        skipped:  list[Op] = []
        prev_ref  = d.qi(table_name)   # changes after each CTE added

        for op in ops:
            frag, new_cols = inst._dispatch(op, cur_cols)
            if frag is None:
                skipped.append(op)
                continue

            cte_name = f"_step_{len(ctes)}"
            # Replace __PREV__ placeholder with the actual previous CTE / table ref
            frag     = frag.replace("__PREV__", prev_ref)
            ctes.append((cte_name, frag))
            prev_ref = d.qi(cte_name)
            cur_cols = new_cols
            compiled.append(op)

        if not ctes:
            return {
                "sql": None, "params": {}, "compiled_ops": [],
                "skipped_ops": ops, "output_columns": all_columns or [],
                "cte_count": 0,
            }

        cte_defs = ",\n".join(
            f"  {d.qi(name)} AS (\n    {body}\n  )"
            for name, body in ctes
        )
        full_sql = f"WITH\n{cte_defs}\nSELECT * FROM {prev_ref}"

        return {
            "sql":           full_sql,
            "params":        inst._params,
            "compiled_ops":  compiled,
            "skipped_ops":   skipped,
            "output_columns": cur_cols,
            "cte_count":     len(ctes),
        }

    @staticmethod
    def dialect_from_connection_string(conn: str) -> str:
        """Infer dialect name from a SQLAlchemy connection string."""
        prefix = conn.split("://")[0].split("+")[0].lower()
        return prefix   # "sqlite", "postgresql", "mysql", "mssql", ...
