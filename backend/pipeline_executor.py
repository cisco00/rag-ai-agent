"""
pipeline_executor.py — Execute a node-graph pipeline (DAG).

Each node carries a type and config; edges carry source/target node IDs
and optional handle names (which port on a multi-output node).

Node types
----------
source          table_name: str
transform       op: dict  (single Phase 1/2 operation)
branch          column, op, value  (filter — pass/fail split)
join            left_key, right_key, how
union           mode ("all"|"distinct"), column_strategy
output          table_name: str, if_exists ("replace"|"append")
error_sink      table_name: str  (receives "error" / "fail" edges)

Edge handle names
-----------------
source node     → "output"           (default / only port)
branch node     → "pass", "fail"
join/union node → "output"
transform node  → "output", "error"  (error = rows that raised an exception
                                       during the op; not currently used for
                                       row-level errors but reserved)
output/error_sink nodes have only input handles.
"""

from __future__ import annotations

import logging
from collections import defaultdict, deque
from typing import Any

import pandas as pd

logger = logging.getLogger(__name__)

NodeId   = str
Handle   = str   # "output" | "pass" | "fail" | "error" | "left" | "right"
DataFrame = pd.DataFrame


# ── Graph helpers ─────────────────────────────────────────────────────────────

def _topological_sort(nodes: list[dict], edges: list[dict]) -> list[str]:
    """
    Kahn's algorithm — returns node ids in execution order.
    Raises ValueError on cycles.
    """
    ids      = {n["id"] for n in nodes}
    in_degree: dict[str, int]              = {nid: 0 for nid in ids}
    children: dict[str, list[str]]         = defaultdict(list)

    for edge in edges:
        src, tgt = edge["source"], edge["target"]
        if src in ids and tgt in ids:
            children[src].append(tgt)
            in_degree[tgt] += 1

    queue  = deque(nid for nid, deg in in_degree.items() if deg == 0)
    result = []
    while queue:
        nid = queue.popleft()
        result.append(nid)
        for child in children[nid]:
            in_degree[child] -= 1
            if in_degree[child] == 0:
                queue.append(child)

    if len(result) != len(ids):
        raise ValueError("Pipeline graph contains a cycle")
    return result


# ── Node executor ─────────────────────────────────────────────────────────────

class PipelineExecutor:
    """
    Execute a node-graph pipeline.

    Parameters
    ----------
    nodes       : list of node dicts  {id, type, data: {...}}
    edges       : list of edge dicts  {id, source, target,
                                       sourceHandle, targetHandle}
    db_manager  : DatabaseManager instance (must stay open for the run)

    Returns
    -------
    result dict  {status, nodes_executed, output_tables, error_tables,
                  node_stats: {node_id: {rows_in, rows_out, time_ms, ...}}}
    """

    def __init__(self, nodes: list[dict], edges: list[dict], db_manager: Any) -> None:
        self._nodes: dict[str, dict] = {n["id"]: n for n in nodes}
        self._edges     = edges
        self._db        = db_manager
        # Outputs produced by each (node_id, handle) pair
        self._outputs:  dict[tuple[str, Handle], DataFrame] = {}
        self._stats:    dict[str, dict]  = {}
        self._results:  list[dict]       = []

    # ── Routing helpers ───────────────────────────────────────────────────────

    def _inputs_for(self, node_id: NodeId) -> dict[Handle, DataFrame]:
        """
        Return all DataFrames arriving at node_id, keyed by targetHandle.
        When targetHandle is absent/None the key is "default".
        """
        result: dict[str, list[DataFrame]] = defaultdict(list)
        for edge in self._edges:
            if edge["target"] != node_id:
                continue
            src_key = (edge["source"], edge.get("sourceHandle") or "output")
            df      = self._outputs.get(src_key)
            if df is None:
                continue
            tgt_handle = edge.get("targetHandle") or "default"
            result[tgt_handle].append(df)
        # Concat multiple frames arriving on the same handle
        return {
            h: pd.concat(dfs, ignore_index=True) if len(dfs) > 1 else dfs[0]
            for h, dfs in result.items()
        }

    def _emit(self, node_id: NodeId, handle: Handle, df: DataFrame) -> None:
        self._outputs[(node_id, handle)] = df

    # ── Individual node executors ─────────────────────────────────────────────

    def _exec_source(self, node: dict) -> None:
        import time
        t0    = time.monotonic()
        table = node["data"].get("table_name", "")
        if not table:
            raise ValueError(f"Source node {node['id']}: table_name is required")
        df = pd.read_sql(f'SELECT * FROM "{table}"', self._db.get_engine())
        self._emit(node["id"], "output", df)
        self._stats[node["id"]] = {
            "rows_out": len(df), "time_ms": round((time.monotonic()-t0)*1000, 1)
        }

    def _exec_transform(self, node: dict) -> None:
        import time
        from transformations import DataTransformer
        t0     = time.monotonic()
        inputs = self._inputs_for(node["id"])
        df     = inputs.get("default") or inputs.get("output")
        if df is None:
            raise ValueError(f"Transform node {node['id']}: no input data")

        op = node["data"].get("op", {})
        # Inject right table for join/union ops
        op_type = op.get("type", "")
        if op_type in ("join", "union"):
            right_table = op.get("right_table", "")
            if right_table:
                try:
                    op = {**op, "_right_df": pd.read_sql(f'SELECT * FROM "{right_table}"', self._db.get_engine())}
                except Exception as e:
                    logger.warning(f"Could not load right table '{right_table}': {e}")

        rows_in = len(df)
        pass_df = DataTransformer.apply_transformations(df.copy(), [op])
        self._emit(node["id"], "output", pass_df)
        self._stats[node["id"]] = {
            "rows_in": rows_in, "rows_out": len(pass_df),
            "time_ms": round((time.monotonic()-t0)*1000, 1),
        }

    def _exec_branch(self, node: dict) -> None:
        """Filter split: matching rows → 'pass', non-matching → 'fail'."""
        import time, operator as op_mod
        t0     = time.monotonic()
        inputs = self._inputs_for(node["id"])
        df     = inputs.get("default") or inputs.get("output")
        if df is None:
            raise ValueError(f"Branch node {node['id']}: no input data")

        col      = node["data"].get("column", "")
        operator = node["data"].get("op", ">")
        value    = node["data"].get("value", 0)
        rows_in  = len(df)

        # Try numeric comparison first
        op_map = {">": op_mod.gt, "<": op_mod.lt, "==": op_mod.eq,
                  "!=": op_mod.ne, ">=": op_mod.ge, "<=": op_mod.le}
        fn = op_map.get(operator, op_mod.eq)

        try:
            casted = pd.to_numeric(df[col], errors="raise")
            mask   = fn(casted, float(value))
        except (ValueError, TypeError):
            mask   = fn(df[col].astype(str), str(value))

        pass_df = df[mask].reset_index(drop=True)
        fail_df = df[~mask].reset_index(drop=True)

        self._emit(node["id"], "pass", pass_df)
        self._emit(node["id"], "fail", fail_df)
        self._stats[node["id"]] = {
            "rows_in": rows_in,
            "rows_pass": len(pass_df), "rows_fail": len(fail_df),
            "time_ms": round((time.monotonic()-t0)*1000, 1),
        }

    def _exec_join(self, node: dict) -> None:
        import time
        t0     = time.monotonic()
        inputs = self._inputs_for(node["id"])
        left   = inputs.get("left") or inputs.get("default")
        right  = inputs.get("right")
        if left is None:
            raise ValueError(f"Join node {node['id']}: left input missing")

        # If right input not wired to a live node, load from right_table
        if right is None:
            right_table = node["data"].get("right_table", "")
            if not right_table:
                raise ValueError(f"Join node {node['id']}: right input or right_table required")
            right = pd.read_sql(f'SELECT * FROM "{right_table}"', self._db.get_engine())

        left_key  = node["data"].get("left_key", "")
        right_key = node["data"].get("right_key", left_key)
        how       = node["data"].get("how", "inner")

        rows_in = len(left)
        df = left.merge(right, left_on=left_key, right_on=right_key, how=how, suffixes=("", "_right"))
        self._emit(node["id"], "output", df)
        self._stats[node["id"]] = {
            "rows_in": rows_in, "rows_right": len(right), "rows_out": len(df),
            "time_ms": round((time.monotonic()-t0)*1000, 1),
        }

    def _exec_union(self, node: dict) -> None:
        import time
        t0     = time.monotonic()
        inputs = self._inputs_for(node["id"])
        top    = inputs.get("top") or inputs.get("default")
        bottom = inputs.get("bottom")

        if top is None:
            raise ValueError(f"Union node {node['id']}: top input missing")

        if bottom is None:
            right_table = node["data"].get("right_table", "")
            if not right_table:
                raise ValueError(f"Union node {node['id']}: bottom input or right_table required")
            bottom = pd.read_sql(f'SELECT * FROM "{right_table}"', self._db.get_engine())

        strategy = node["data"].get("column_strategy", "intersect")
        mode     = node["data"].get("mode", "all")
        rows_in  = len(top)

        if strategy == "intersect":
            common = [c for c in top.columns if c in bottom.columns]
            df     = pd.concat([top[common], bottom[common]], ignore_index=True)
        else:
            df = pd.concat([top, bottom], ignore_index=True)

        if mode == "distinct":
            df = df.drop_duplicates()

        self._emit(node["id"], "output", df)
        self._stats[node["id"]] = {
            "rows_in": rows_in, "rows_bottom": len(bottom), "rows_out": len(df),
            "time_ms": round((time.monotonic()-t0)*1000, 1),
        }

    def _exec_output(self, node: dict, handle_key: str = "default") -> None:
        import time
        t0     = time.monotonic()
        inputs = self._inputs_for(node["id"])
        df     = inputs.get(handle_key) or next(iter(inputs.values()), None)
        if df is None:
            logger.warning(f"Output node {node['id']}: no rows to write")
            return

        table    = node["data"].get("table_name", "")
        if_exists = node["data"].get("if_exists", "replace")
        node_type = node.get("type", "output")

        if not table:
            raise ValueError(f"Output node {node['id']}: table_name is required")

        self._db.load_dataframe(df, table, if_exists=if_exists)
        self._results.append({
            "node_id":    node["id"],
            "node_type":  node_type,
            "table":      table,
            "rows":       len(df),
            "if_exists":  if_exists,
        })
        self._stats[node["id"]] = {
            "rows_in": len(df), "table": table,
            "time_ms": round((time.monotonic()-t0)*1000, 1),
        }

    # ── Main run loop ─────────────────────────────────────────────────────────

    def run(self) -> dict:
        import time
        t_total = time.monotonic()

        nodes_list  = list(self._nodes.values())
        exec_order  = _topological_sort(nodes_list, self._edges)
        executed    = 0

        for node_id in exec_order:
            node      = self._nodes[node_id]
            node_type = node.get("type", "")
            try:
                if node_type == "source":
                    self._exec_source(node)
                elif node_type == "transform":
                    self._exec_transform(node)
                elif node_type == "branch":
                    self._exec_branch(node)
                elif node_type == "join":
                    self._exec_join(node)
                elif node_type == "union":
                    self._exec_union(node)
                elif node_type in ("output", "error_sink"):
                    self._exec_output(node)
                else:
                    logger.warning(f"Unknown node type '{node_type}' — skipping")
                    continue
                executed += 1
            except Exception as e:
                logger.error(f"Node '{node_id}' ({node_type}) failed: {e}", exc_info=True)
                self._stats[node_id] = {"error": str(e)}

        output_tables = [r["table"] for r in self._results if r["node_type"] == "output"]
        error_tables  = [r["table"] for r in self._results if r["node_type"] == "error_sink"]

        return {
            "status":          "done",
            "nodes_total":     len(nodes_list),
            "nodes_executed":  executed,
            "output_tables":   output_tables,
            "error_tables":    error_tables,
            "written":         self._results,
            "node_stats":      self._stats,
            "total_time_ms":   round((time.monotonic()-t_total)*1000, 1),
        }
