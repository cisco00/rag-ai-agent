"""
dag_executor.py — Execute a pipeline DAG produced by the React Flow canvas.

Node types
----------
  source      : reads a DB table into a DataFrame
  transform   : applies one operation; has two output ports (success / error)
  sink        : writes a DataFrame back to the DB as a named table
  error_sink  : receives bad rows; writes to an auto-named error table

Edge handle convention (matches React Flow source-handle names)
---------------------------------------------------------------
  sourceHandle = "success" | "error" | None (default = success)
  targetHandle = "input"   | None

Execution model
---------------
1. Topological sort of nodes.
2. Each node receives the DataFrame arriving on its "input" handle.
3. Transform nodes split output into (success_df, error_df).
4. Dataframes flow along matching edges.
5. Sink nodes write their incoming DataFrame to the database.
6. Returns execution_result dict (see execute()).
"""
from __future__ import annotations

import io
import logging
import os
import tempfile
import time
from collections import defaultdict, deque
from typing import Any

import pandas as pd

logger = logging.getLogger(__name__)

Op  = dict[str, Any]
Nid = str          # node id


# ── Export helpers ────────────────────────────────────────────────────────────

def _df_to_bytes(df: pd.DataFrame, fmt: str) -> tuple[bytes, str]:
    """
    Serialize *df* to bytes in the requested format.
    Returns (data_bytes, mimetype).
    """
    fmt = (fmt or "csv").lower()

    if fmt == "xlsx":
        buf = io.BytesIO()
        with pd.ExcelWriter(buf, engine="openpyxl") as w:
            df.to_excel(w, index=False, sheet_name="Data")
        return (
            buf.getvalue(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
    elif fmt == "json":
        return (
            df.to_json(orient="records", default_handler=str).encode("utf-8"),
            "application/json",
        )
    else:  # csv (default)
        return (
            df.to_csv(index=False).encode("utf-8"),
            "text/csv",
        )


def _extension(fmt: str) -> str:
    return {"xlsx": "xlsx", "json": "json", "csv": "csv"}.get((fmt or "csv").lower(), "csv")


# ── Per-op error capture ──────────────────────────────────────────────────────

def _split_filter(df: pd.DataFrame, op: Op):
    """Filter: success = rows that match, error = rows that don't."""
    col      = op.get("column", "")
    operator = op.get("op", op.get("operator", ">"))
    value    = op.get("value", 0)

    op_map = {">": "__gt__", "<": "__lt__", "==": "__eq__",
              "!=": "__ne__", ">=": "__ge__", "<=": "__le__"}
    method = op_map.get(str(operator))
    if not method or col not in df.columns:
        return df, pd.DataFrame(columns=df.columns)

    try:
        val = float(value)
    except (TypeError, ValueError):
        val = str(value)

    mask = getattr(df[col], method)(val)
    return df[mask].reset_index(drop=True), df[~mask].reset_index(drop=True)


def _split_change_type(df: pd.DataFrame, op: Op):
    """change_type: error = rows where the cast raises."""
    col      = op.get("column", "")
    new_type = op.get("new_type", "str")
    if col not in df.columns:
        return df, pd.DataFrame(columns=df.columns)

    _cast = {
        "int":      lambda v: int(float(v)),
        "float":    lambda v: float(v),
        "str":      lambda v: str(v),
        "bool":     lambda v: bool(v),
        "datetime": lambda v: pd.to_datetime(v),
    }.get(new_type, str)

    success_idx, error_idx = [], []
    for idx, val in df[col].items():
        try:
            _cast(val)
            success_idx.append(idx)
        except Exception:
            error_idx.append(idx)

    success_df = df.loc[success_idx].copy().reset_index(drop=True)
    error_df   = df.loc[error_idx].copy().reset_index(drop=True)

    # Apply cast only to success rows
    if success_df.shape[0]:
        if new_type == "datetime":
            success_df[col] = pd.to_datetime(success_df[col], errors="coerce")
        else:
            success_df[col] = success_df[col].apply(_cast)

    return success_df, error_df


def apply_op_with_error_capture(
    df: pd.DataFrame,
    op: Op,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Apply *op* to *df*.  Returns (success_df, error_df).

    Ops with meaningful error semantics get custom splits.
    All others: success = result, error = empty frame.
    """
    op_type = op.get("type", "")

    # Ops with native error ports
    if op_type == "filter":
        return _split_filter(df, op)
    if op_type == "change_type":
        return _split_change_type(df, op)

    # Everything else: try/except whole op
    from transformations import DataTransformer
    try:
        result = DataTransformer.apply_transformations(df.copy(), [op])
        return result, pd.DataFrame(columns=df.columns)
    except Exception as e:
        logger.warning(f"DAG op '{op_type}' failed on all rows: {e}")
        # Route entire frame to error port
        return pd.DataFrame(columns=df.columns), df


# ── Graph helpers ─────────────────────────────────────────────────────────────

def _build_graph(nodes: list, edges: list):
    """
    Returns adjacency and in-degree structures needed for topological sort.

    adjacency[src_id] = [(dst_id, source_handle)]
    in_degree[node_id] = int
    """
    ids = {n["id"] for n in nodes}

    adjacency: dict[Nid, list] = defaultdict(list)
    in_degree:  dict[Nid, int] = {n["id"]: 0 for n in nodes}

    for edge in edges:
        src = edge.get("source", "")
        dst = edge.get("target", "")
        handle = edge.get("sourceHandle") or "success"
        if src in ids and dst in ids:
            adjacency[src].append((dst, handle))
            in_degree[dst] = in_degree.get(dst, 0) + 1

    return adjacency, in_degree


def _topological_sort(nodes: list, adjacency: dict, in_degree: dict) -> list[Nid]:
    """Kahn's algorithm. Raises ValueError on a cycle."""
    queue = deque(nid for nid, deg in in_degree.items() if deg == 0)
    order: list[Nid] = []
    temp_deg = dict(in_degree)

    while queue:
        nid = queue.popleft()
        order.append(nid)
        for (child, _handle) in adjacency.get(nid, []):
            temp_deg[child] -= 1
            if temp_deg[child] == 0:
                queue.append(child)

    if len(order) != len(nodes):
        raise ValueError("Pipeline graph contains a cycle")
    return order


# ── Main executor ─────────────────────────────────────────────────────────────

class DAGExecutor:
    """
    Execute a React Flow pipeline DAG.

    Parameters
    ----------
    nodes : list of React Flow node dicts
        Each node has  {id, type, data: {...}}
        type ∈ {"source", "transform", "sink", "error_sink"}

    edges : list of React Flow edge dicts
        {id, source, target, sourceHandle, targetHandle}

    db_manager : DatabaseManager instance (caller is responsible for closing)
    """

    def __init__(self, nodes: list, edges: list, db_manager) -> None:
        self._nodes_by_id: dict[Nid, dict] = {n["id"]: n for n in nodes}
        self._edges       = edges
        self._db          = db_manager
        self._adjacency, self._in_degree = _build_graph(nodes, edges)
        self._sort_order  = _topological_sort(nodes, self._adjacency, self._in_degree)

        # slot[node_id]["input"] = incoming DataFrame
        self._slots: dict[Nid, dict[str, pd.DataFrame]] = defaultdict(dict)

    def execute(self) -> dict:
        """
        Run the DAG.

        Returns
        -------
        dict with keys:
          status          "ok" | "partial"
          outputs         {table_name: {rows, columns, preview[]}}
          error_outputs   {table_name: {rows, columns, preview[]}}
          exports         [{filename, format, size_bytes, data_b64}]
          stats           {total_time_ms, nodes_executed, error_rows_total}
          node_stats      {node_id: {time_ms, rows_in, rows_out, error_rows}}
          errors          [str]   — node-level warnings / soft errors
        """
        import base64

        t0 = time.monotonic()
        engine     = self._db.get_engine()
        node_stats = {}
        outputs:       dict[str, dict] = {}
        error_outputs: dict[str, dict] = {}
        exports:       list[dict]      = []
        exec_errors:   list[str]       = []

        # Collect export files for email attachment at end
        _export_files: list[dict] = []   # {filename, data, mimetype}

        # Track pipeline name from any email-node data
        _pipeline_name = "Pipeline"

        for nid in self._sort_order:
            node = self._nodes_by_id[nid]
            ntype = node.get("type", "")
            data  = node.get("data", {})
            ts    = time.monotonic()

            incoming = self._slots[nid].get("input", pd.DataFrame())

            try:
                # ── Source ────────────────────────────────────────────────────
                if ntype == "source":
                    table = data.get("table", "")
                    if not table:
                        exec_errors.append(f"Source node {nid}: no table selected")
                        success_df = error_df = pd.DataFrame()
                    else:
                        success_df = pd.read_sql(f'SELECT * FROM "{table}"', engine)
                        error_df   = pd.DataFrame(columns=success_df.columns)

                # ── Transform ─────────────────────────────────────────────────
                elif ntype == "transform":
                    op = data.get("operation", {})
                    if not op or not incoming.shape[0]:
                        success_df = incoming
                        error_df   = pd.DataFrame(columns=incoming.columns if not incoming.empty else [])
                    else:
                        success_df, error_df = apply_op_with_error_capture(incoming, op)

                # ── Sink / Error Sink ─────────────────────────────────────────
                elif ntype in ("sink", "error_sink"):
                    table_name = data.get("table") or (
                        f"pipeline_errors_{int(time.time())}" if ntype == "error_sink"
                        else f"pipeline_output_{int(time.time())}"
                    )
                    df_to_write = incoming
                    if not df_to_write.empty:
                        self._db.load_dataframe(df_to_write, table_name, if_exists="replace")

                    dest = error_outputs if ntype == "error_sink" else outputs
                    dest[table_name] = {
                        "rows":    len(df_to_write),
                        "columns": list(df_to_write.columns),
                        "preview": self._preview_rows(df_to_write),
                    }
                    success_df = error_df = pd.DataFrame()

                # ── Export Node (XLSX / CSV / JSON) ───────────────────────────
                elif ntype == "export":
                    fmt      = data.get("format", "csv").lower()
                    filename = data.get("filename") or f"export_{nid}.{_extension(fmt)}"

                    if not incoming.empty:
                        raw_bytes, mimetype = _df_to_bytes(incoming, fmt)
                        exports.append({
                            "filename":   filename,
                            "format":     fmt,
                            "size_bytes": len(raw_bytes),
                            "data_b64":   base64.b64encode(raw_bytes).decode("ascii"),
                        })
                        _export_files.append({
                            "filename": filename,
                            "data":     raw_bytes,
                            "mimetype": mimetype,
                        })
                        logger.info(f"DAG export node {nid}: {filename} ({len(raw_bytes)} bytes)")

                    success_df = incoming     # pass-through so downstream nodes still get data
                    error_df   = pd.DataFrame(columns=incoming.columns if not incoming.empty else [])

                # ── Conditional Node (gate on row count / error rate / column) ─
                elif ntype == "conditional":
                    condition   = data.get("condition", "row_count")
                    operator    = data.get("operator", ">")
                    threshold   = float(data.get("threshold", 0))
                    column      = data.get("column", "")

                    op_map = {
                        ">":  lambda a, b: a > b,
                        "<":  lambda a, b: a < b,
                        ">=": lambda a, b: a >= b,
                        "<=": lambda a, b: a <= b,
                        "==": lambda a, b: a == b,
                        "!=": lambda a, b: a != b,
                    }
                    cmp = op_map.get(operator, op_map[">"])

                    if condition == "row_count":
                        actual = float(len(incoming))
                    elif condition == "error_rate":
                        # error_rows / total_rows so far
                        total = max(len(incoming), 1)
                        err   = sum(
                            s.get("error_rows", 0)
                            for s in node_stats.values()
                        )
                        actual = err / total
                    elif condition == "column_sum" and column and column in incoming.columns:
                        actual = float(incoming[column].sum())
                    elif condition == "column_mean" and column and column in incoming.columns:
                        actual = float(incoming[column].mean())
                    else:
                        actual = float(len(incoming))

                    gate_open = cmp(actual, threshold)
                    logger.info(
                        f"DAG conditional {nid}: {condition} {operator} {threshold} "
                        f"→ actual={actual} → {'PASS' if gate_open else 'BLOCK'}"
                    )

                    if gate_open:
                        success_df = incoming
                        error_df   = pd.DataFrame(columns=incoming.columns if not incoming.empty else [])
                    else:
                        # Block: route everything to error port with reason column
                        error_df           = incoming.copy()
                        error_df["_condition_failed"] = (
                            f"{condition} {operator} {threshold} (actual={actual:.2f})"
                        )
                        success_df = pd.DataFrame(columns=incoming.columns if not incoming.empty else [])

                # ── Email Node ────────────────────────────────────────────────
                elif ntype == "email":
                    to_email      = data.get("to_email", "")
                    pipeline_name = data.get("pipeline_name", "Pipeline")
                    attach_export = data.get("attach_export", False)
                    _pipeline_name = pipeline_name

                    if to_email:
                        from email_service import send_pipeline_completion_email

                        t_now = time.monotonic()
                        elapsed_ms = round((t_now - t0) * 1000, 1)

                        current_stats = {
                            "total_time_ms":    elapsed_ms,
                            "nodes_executed":   len(node_stats),
                            "error_rows_total": sum(
                                s.get("error_rows", 0) for s in node_stats.values()
                            ),
                        }
                        out_tables = list(outputs.keys())

                        ok = send_pipeline_completion_email(
                            to_email=to_email,
                            pipeline_name=pipeline_name,
                            stats=current_stats,
                            output_tables=out_tables,
                            error_count=len(exec_errors),
                            attachments=_export_files if attach_export else None,
                        )
                        if not ok:
                            exec_errors.append(
                                f"Email node {nid}: delivery failed (check SMTP config)"
                            )
                        logger.info(f"DAG email node {nid}: sent={ok} → {to_email}")
                    else:
                        exec_errors.append(f"Email node {nid}: no to_email configured")

                    success_df = incoming
                    error_df   = pd.DataFrame(columns=incoming.columns if not incoming.empty else [])

                # ── Unknown ───────────────────────────────────────────────────
                else:
                    success_df = incoming
                    error_df   = pd.DataFrame()

            except Exception as exc:
                exec_errors.append(f"Node {nid} ({ntype}): {exc}")
                logger.error(f"DAG node error [{nid}]: {exc}", exc_info=True)
                success_df = incoming
                error_df   = pd.DataFrame()

            te = time.monotonic()
            node_stats[nid] = {
                "time_ms":    round((te - ts) * 1000, 1),
                "rows_in":    len(incoming),
                "rows_out":   len(success_df),
                "error_rows": len(error_df),
            }

            # Route outputs to downstream nodes
            for (child_id, handle) in self._adjacency.get(nid, []):
                routed = error_df if handle == "error" else success_df
                self._slots[child_id]["input"] = pd.concat(
                    [self._slots[child_id].get("input", pd.DataFrame()), routed],
                    ignore_index=True,
                )

        t1 = time.monotonic()
        total_errors = sum(s["error_rows"] for s in node_stats.values())

        return {
            "status":        "partial" if exec_errors else "ok",
            "outputs":        outputs,
            "error_outputs":  error_outputs,
            "exports":        exports,
            "stats": {
                "total_time_ms":    round((t1 - t0) * 1000, 1),
                "nodes_executed":   len(self._sort_order),
                "error_rows_total": total_errors,
            },
            "node_stats": node_stats,
            "errors":     exec_errors,
        }

    @staticmethod
    def _preview_rows(df: pd.DataFrame, n: int = 5) -> list[dict]:
        import math, numpy as np
        rows = []
        for rec in df.head(n).to_dict(orient="records"):
            cleaned = {}
            for k, v in rec.items():
                if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                    cleaned[k] = None
                elif isinstance(v, (np.int64, np.int32)):
                    cleaned[k] = int(v)
                else:
                    cleaned[k] = v
            rows.append(cleaned)
        return rows
