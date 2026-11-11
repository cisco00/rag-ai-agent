
import pandas as pd
import numpy as np
import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

def perform_forecast(
    df: pd.DataFrame,
    date_col: str,
    value_col: str,
    periods: int = 30,
    freq: str = 'D',
) -> Dict[str, Any]:
    """
    Time-series forecast with Prophet (primary) → Holt-Winters (fallback).

    Prophet returns native yhat_lower / yhat_upper (80 % CI by default,
    widened to 95 % via interval_width=0.95).  Holt-Winters falls back to a
    ±1.96σ·√h approximation so the chart always gets lower/upper bands.
    """
    # ── 1. Clean & validate ──────────────────────────────────────────────────
    try:
        df[date_col] = pd.to_datetime(df[date_col], errors='coerce')
        df = df.dropna(subset=[date_col, value_col])
        df[value_col] = pd.to_numeric(df[value_col], errors='coerce')
        df = df.dropna(subset=[value_col])
    except Exception as e:
        return {"error": f"Data preparation failed: {e}"}

    if df.empty:
        return {"error": "No valid data points after cleaning (check date/value formats)"}

    # ── 2. Try Prophet ───────────────────────────────────────────────────────
    _prophet_ok = False
    try:
        from prophet import Prophet
        import logging as _lg
        # Silence Prophet / Stan verbose output
        _lg.getLogger("prophet").setLevel(_lg.WARNING)
        _lg.getLogger("cmdstanpy").setLevel(_lg.WARNING)

        prophet_df = (
            df[[date_col, value_col]]
            .rename(columns={date_col: "ds", value_col: "y"})
            .groupby("ds", as_index=False)["y"].mean()
            .sort_values("ds")
        )

        # Map our freq aliases → Prophet freq strings
        freq_map = {"D": "D", "h": "h", "H": "h", "W": "W", "MS": "MS", "B": "B"}
        p_freq = freq_map.get(freq, "D")

        m = Prophet(
            interval_width=0.95,
            daily_seasonality=(p_freq in ("h", "H")),
            weekly_seasonality=(p_freq in ("D", "B")),
            yearly_seasonality=True,
        )
        m.fit(prophet_df)

        future = m.make_future_dataframe(periods=periods, freq=p_freq)
        fc = m.predict(future)

        # Build chart rows
        actual_map = dict(zip(prophet_df["ds"].dt.strftime("%Y-%m-%d"), prophet_df["y"]))
        result_rows = []
        for _, row in fc.iterrows():
            d_str = row["ds"].strftime("%Y-%m-%d")
            yhat  = round(float(row["yhat"]),       4)
            lower = round(float(row["yhat_lower"]), 4)
            upper = round(float(row["yhat_upper"]), 4)
            is_hist = d_str in actual_map
            entry: Dict[str, Any] = {"date": d_str}
            if is_hist:
                entry["actual"] = round(float(actual_map[d_str]), 4)
            else:
                entry["forecast"] = yhat
                entry["lower"]    = lower
                entry["upper"]    = upper
            result_rows.append(entry)

        result_rows.sort(key=lambda x: x["date"])
        _prophet_ok = True
        engine = "prophet"

    except Exception as e:
        logger.warning(f"Prophet unavailable, falling back to Holt-Winters: {e}")

    # ── 3. Fallback: Holt-Winters + ±1.96σ·√h CI ───────────────────────────
    if not _prophet_ok:
        try:
            from statsmodels.tsa.holtwinters import ExponentialSmoothing
        except ImportError:
            return {"error": "No forecasting library available (prophet / statsmodels)"}

        try:
            ts_raw  = df.set_index(date_col)[value_col].sort_index()
            ts_raw  = ts_raw.groupby(level=0).mean()
            ts_data = ts_raw.resample(freq).mean().ffill().bfill()

            if len(ts_data) < 5:
                inferred = pd.infer_freq(ts_raw.index)
                if inferred:
                    ts_data = ts_raw.asfreq(inferred).ffill().bfill()
                if len(ts_data) < 5:
                    return {"error": f"Not enough data points (found {len(ts_data)}, need min 5)"}

            seasonal_periods = 7 if freq.startswith("D") else (24 if freq.startswith("h") else None)
            try:
                model = ExponentialSmoothing(
                    ts_data,
                    seasonal_periods=seasonal_periods,
                    trend="add",
                    seasonal="add" if (seasonal_periods and len(ts_data) > 2 * seasonal_periods) else None,
                ).fit()
            except Exception:
                try:
                    model = ExponentialSmoothing(ts_data, trend="add", seasonal=None).fit()
                except Exception:
                    model = ExponentialSmoothing(ts_data, trend=None, seasonal=None).fit()

            forecast   = model.forecast(periods)
            resid_std  = float(np.sqrt(np.nanmean(model.resid.values ** 2)))

            fmt = "%Y-%m-%d %H:%M:%S" if not freq.startswith("D") else "%Y-%m-%d"
            merged: Dict[str, Any] = {}
            for d, v in zip(ts_data.index, ts_data.values):
                d_str = d.strftime(fmt)
                merged[d_str] = {"date": d_str, "actual": float(v) if not pd.isna(v) else None}

            for h, (d, v) in enumerate(zip(forecast.index, forecast.values), start=1):
                d_str   = d.strftime(fmt)
                fv      = float(v) if not pd.isna(v) else None
                ci_half = 1.96 * resid_std * float(np.sqrt(h)) if resid_std > 0 else 0.0
                entry   = {
                    "date":     d_str,
                    "forecast": fv,
                    "lower":    round(fv - ci_half, 4) if fv is not None else None,
                    "upper":    round(fv + ci_half, 4) if fv is not None else None,
                }
                if d_str in merged:
                    merged[d_str].update(entry)
                else:
                    merged[d_str] = entry

            result_rows = sorted(merged.values(), key=lambda x: x["date"])
            engine = "holt-winters"

        except Exception as e:
            logger.error(f"Forecasting failed: {e}", exc_info=True)
            return {"error": f"Forecasting engine error: {str(e)}"}

    # ── 4. Summary stats ─────────────────────────────────────────────────────
    actual_vals = [r["actual"]   for r in result_rows if r.get("actual")   is not None]
    fcast_vals  = [r["forecast"] for r in result_rows if r.get("forecast") is not None]
    trend_pct   = (
        round((fcast_vals[-1] - fcast_vals[0]) / abs(fcast_vals[0]) * 100, 1)
        if len(fcast_vals) > 1 and fcast_vals[0]
        else 0
    )

    return {
        "chart": result_rows,
        "engine": engine,
        "stats": {
            "actual_mean":    round(float(np.mean(actual_vals)), 2) if actual_vals else None,
            "actual_std":     round(float(np.std(actual_vals)),  2) if actual_vals else None,
            "forecast_end":   round(fcast_vals[-1], 2)              if fcast_vals  else None,
            "forecast_start": round(fcast_vals[0],  2)              if fcast_vals  else None,
            "trend_pct":      trend_pct,
            "periods":        periods,
            "freq":           freq,
            "value_column":   value_col,
            "engine":         engine,
        },
    }

def detect_anomalies(
    df: pd.DataFrame,
    value_col: str,
    contamination: float = 0.05,
    columns: Optional[List[str]] = None,
    multivariate: bool = False,
) -> Dict[str, Any]:
    """
    Detect anomalies using Isolation Forest.

    Univariate mode (multivariate=False, default):
        Runs on `value_col` only.  Returns plot_data with {index, value, isAnomaly}.

    Multivariate mode (multivariate=True):
        Runs IsolationForest on `columns` (2–4 numeric columns).
        Returns plot_data with {index, <col>:..., isAnomaly, anomaly_score}
        plus a `pairs` list (all 2-column combinations) for the scatter matrix.
    """
    try:
        from sklearn.ensemble import IsolationForest
        from sklearn.preprocessing import StandardScaler
    except ImportError:
        logger.error("scikit-learn is not installed")
        return {"error": "Analytics dependencies not installed"}

    # ── 1. Column selection ──────────────────────────────────────────────────
    if multivariate and columns and len(columns) >= 2:
        feature_cols = [c for c in columns if c in df.columns]
        if len(feature_cols) < 2:
            return {"error": "At least 2 valid columns are required for multivariate mode"}
        feature_cols = feature_cols[:4]          # cap at 4
    else:
        feature_cols = [value_col]
        multivariate = False

    # ── 2. Prep & validate ───────────────────────────────────────────────────
    try:
        data = df[feature_cols].copy()
        for col in feature_cols:
            data[col] = pd.to_numeric(data[col], errors='coerce')
        data = data.dropna()
    except Exception as e:
        return {"error": f"Data preparation failed: {e}"}

    total_len = len(data)
    if total_len < 10:
        return {"error": f"Not enough data points (need ≥10, got {total_len})"}

    # ── 3. Isolation Forest ──────────────────────────────────────────────────
    try:
        scaler = StandardScaler()
        X = scaler.fit_transform(data[feature_cols].values)

        clf = IsolationForest(contamination=contamination, random_state=42)
        preds = clf.fit_predict(X)
        # decision_function: more negative = more anomalous → invert for "anomaly score"
        raw_scores = clf.decision_function(X)
        # Normalise to 0–1 (1 = most anomalous)
        s_min, s_max = raw_scores.min(), raw_scores.max()
        norm_scores = (raw_scores - s_max) / (s_min - s_max + 1e-9)

        data = data.copy()
        data['_is_anomaly']    = preds == -1
        data['_anomaly_score'] = norm_scores

    except Exception as e:
        logger.error(f"IsolationForest failed: {e}", exc_info=True)
        return {"error": str(e)}

    # ── 4. Downsample for browser ────────────────────────────────────────────
    max_points = 2000
    if total_len > max_points:
        step = total_len // max_points
        data_plot = data.iloc[::step].copy()
    else:
        data_plot = data.copy()

    # ── 5. Build plot_data ───────────────────────────────────────────────────
    plot_data: List[Dict[str, Any]] = []
    if not multivariate:
        # Univariate: simple {index, value, isAnomaly}
        for i, (_, row) in enumerate(data_plot.iterrows()):
            val = row[value_col]
            plot_data.append({
                "index":     int(i),
                "value":     float(val) if not pd.isna(val) else None,
                "isAnomaly": bool(row['_is_anomaly']),
            })
    else:
        # Multivariate: include all feature columns + score
        for i, (_, row) in enumerate(data_plot.iterrows()):
            pt: Dict[str, Any] = {
                "index":        int(i),
                "isAnomaly":    bool(row['_is_anomaly']),
                "anomalyScore": round(float(row['_anomaly_score']), 4),
            }
            for col in feature_cols:
                val = row[col]
                pt[col] = float(val) if not pd.isna(val) else None
            plot_data.append(pt)

    # ── 6. Build scatter pairs for multivariate drill-down ───────────────────
    pairs: List[Dict[str, str]] = []
    if multivariate:
        from itertools import combinations
        pairs = [{"x": a, "y": b} for a, b in combinations(feature_cols, 2)]

    # ── 7. Per-column stats ──────────────────────────────────────────────────
    anomaly_count = int(data['_is_anomaly'].sum())
    col_stats: Dict[str, Any] = {}
    for col in feature_cols:
        vals = data.loc[data[col].notna(), col]
        col_stats[col] = {
            "mean": round(float(vals.mean()), 2) if len(vals) else None,
            "std":  round(float(vals.std()),  2) if len(vals) else None,
            "min":  round(float(vals.min()),  2) if len(vals) else None,
            "max":  round(float(vals.max()),  2) if len(vals) else None,
        }

    primary_vals = data[value_col].dropna() if value_col in feature_cols else data[feature_cols[0]].dropna()

    return {
        "data":          plot_data,
        "pairs":         pairs,
        "feature_cols":  feature_cols,
        "multivariate":  multivariate,
        "total_points":  total_len,
        "anomaly_count": anomaly_count,
        "stats": {
            "total_points":   total_len,
            "anomaly_count":  anomaly_count,
            "anomaly_pct":    round(anomaly_count / total_len * 100, 1) if total_len else 0,
            "value_mean":     round(float(primary_vals.mean()), 2) if len(primary_vals) else None,
            "value_std":      round(float(primary_vals.std()),  2) if len(primary_vals) else None,
            "value_min":      round(float(primary_vals.min()),  2) if len(primary_vals) else None,
            "value_max":      round(float(primary_vals.max()),  2) if len(primary_vals) else None,
            "value_column":   value_col,
            "feature_cols":   feature_cols,
            "multivariate":   multivariate,
            "contamination":  contamination,
            "col_stats":      col_stats,
        },
    }

def calculate_correlation(
    df: pd.DataFrame, 
    columns: Optional[List[str]] = None, 
    method: str = 'pearson'
) -> Dict[str, Any]:
    """
    Calculate correlation matrix.
    """
    try:
        # Filter columns if specified, otherwise use all numeric
        if columns:
            # simple validation
            valid_cols = [c for c in columns if c in df.columns]
            if not valid_cols:
                return {"error": "No valid columns found"}
            data = df[valid_cols]
        else:
            data = df.select_dtypes(include=[np.number])
            
        if data.empty:
            return {"error": "No numeric data available for correlation"}
            
        # method: {'pearson', 'kendall', 'spearman'}
        corr_matrix = data.corr(method=method)
        
        # Replace NaNs (if constant columns etc) with 0 or None for JSON
        corr_matrix = corr_matrix.astype(object).where(pd.notnull(corr_matrix), None)
        
        # Find strongest pair
        flat = corr_matrix.where(np.triu(np.ones(corr_matrix.shape), k=1).astype(bool))
        strongest_val = flat.abs().max().max()
        strongest_pair = None
        if not pd.isna(strongest_val):
            idx = flat.abs().stack().idxmax()
            strongest_pair = {"cols": list(idx), "r": round(float(flat.loc[idx]), 3)}

        return {
            "columns": corr_matrix.columns.tolist(),
            "correlation_matrix": corr_matrix.values.tolist(),
            "method": method,
            "stats": {
                "n_cols":          len(corr_matrix.columns),
                "method":          method,
                "strongest_pair":  strongest_pair,
                "avg_abs_corr":    round(float(flat.abs().stack().mean()), 3) if not flat.abs().stack().empty else None,
            }
        }
        
    except Exception as e:
        logger.error(f"Correlation failed: {e}", exc_info=True)
        return {"error": str(e)}


def perform_cluster(
    df: pd.DataFrame,
    x_col: str,
    y_col: str,
    n_clusters: int = 3,
    color_col: Optional[str] = None,
) -> Dict[str, Any]:
    """
    K-Means clustering on two numeric columns.
    Returns labelled points + centroids + per-cluster stats.
    """
    try:
        from sklearn.cluster import KMeans
        from sklearn.preprocessing import StandardScaler
    except ImportError:
        return {"error": "scikit-learn is not installed"}

    try:
        needed = [x_col, y_col] + ([color_col] if color_col and color_col in df.columns else [])
        sub = df[needed].dropna()

        if len(sub) < n_clusters * 2:
            return {"error": f"Not enough data points (need at least {n_clusters * 2}, got {len(sub)})"}

        X = sub[[x_col, y_col]].values
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        km = KMeans(n_clusters=n_clusters, random_state=42, n_init="auto")
        labels = km.fit_predict(X_scaled)

        # Centroids back in original space
        centroids_scaled = km.cluster_centers_
        centroids_orig   = scaler.inverse_transform(centroids_scaled)

        # Downsample for large datasets
        max_pts = 2000
        if len(sub) > max_pts:
            step = len(sub) // max_pts
            sub   = sub.iloc[::step]
            labels = labels[::step]

        points = []
        for i, (_, row) in enumerate(sub.iterrows()):
            pt = {
                "x":       float(row[x_col]),
                "y":       float(row[y_col]),
                "cluster": int(labels[i]),
            }
            if color_col and color_col in row.index:
                pt["label"] = str(row[color_col])
            points.append(pt)

        centroids = [
            {"x": round(float(c[0]), 4), "y": round(float(c[1]), 4), "cluster": i}
            for i, c in enumerate(centroids_orig)
        ]

        # Per-cluster size
        unique, counts = np.unique(labels, return_counts=True)
        cluster_sizes = {int(k): int(v) for k, v in zip(unique, counts)}

        inertia = round(float(km.inertia_), 2)

        return {
            "points":        points,
            "centroids":     centroids,
            "n_clusters":    n_clusters,
            "cluster_sizes": cluster_sizes,
            "stats": {
                "n_points":    len(points),
                "n_clusters":  n_clusters,
                "inertia":     inertia,
                "x_column":    x_col,
                "y_column":    y_col,
                "largest_cluster":  int(max(cluster_sizes.values())),
                "smallest_cluster": int(min(cluster_sizes.values())),
            }
        }

    except Exception as e:
        logger.error(f"Clustering failed: {e}", exc_info=True)
        return {"error": str(e)}