
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
    freq: str = 'D'
) -> Dict[str, Any]:
    """
    Perform time series forecasting using Exponential Smoothing (Holt-Winters).
    """
    try:
        from statsmodels.tsa.holtwinters import ExponentialSmoothing
    except ImportError:
        logger.error("statsmodels is not installed")
        return {"error": "Analytics dependencies not installed"}
        
    try:
        # Prepare data
        df[date_col] = pd.to_datetime(df[date_col], errors='coerce')
        df = df.dropna(subset=[date_col, value_col])
        
        if df.empty:
            return {"error": "No valid data points after cleaning (check date/value formats)"}

        ts_raw = df.set_index(date_col)[value_col].sort_index()
        ts_raw = ts_raw.groupby(level=0).mean()
        
        # 1. Resample to the requested frequency 'freq'
        ts_data = ts_raw.resample(freq).mean().ffill().bfill()
        
        # 2. Check if we have enough data at this frequency
        if len(ts_data) < 5:
             # Fallback: Try to use inferred frequency if requested was too sparse
             inferred = pd.infer_freq(ts_raw.index)
             if inferred and inferred != freq:
                 ts_data = ts_raw.asfreq(inferred).ffill().bfill()
                 logger.info(f"Falling back to inferred frequency: {inferred}")
             
             if len(ts_data) < 5:
                  return {"error": f"Not enough data points (found {len(ts_data)}, need min 5)"}

        # 3. Model fitting
        try:
            # Full Holt-Winters (Trend + Seasonal)
            seasonal_periods = 7 if freq.startswith('D') else (24 if freq.startswith('h') else None)
            model = ExponentialSmoothing(
                ts_data, 
                seasonal_periods=seasonal_periods,
                trend='add', 
                seasonal='add' if (seasonal_periods and len(ts_data) > 2 * seasonal_periods) else None
            ).fit()
        except Exception as e:
            logger.warning(f"Full HW failed, trying trend only: {e}")
            try:
                model = ExponentialSmoothing(ts_data, trend='add', seasonal=None).fit()
            except:
                model = ExponentialSmoothing(ts_data, trend=None, seasonal=None).fit()
        
        # 4. Forecast the requested number of periods (at current ts_data frequency)
        forecast = model.forecast(periods)
        
        # 5. Merge for output
        merged_data = {}
        for d, v in zip(ts_data.index, ts_data.values):
            d_str = d.strftime('%Y-%m-%d %H:%M:%S') if not freq.startswith('D') else d.strftime('%Y-%m-%d')
            merged_data[d_str] = {
                "date": d_str,
                "actual": float(v) if not pd.isna(v) else None
            }
            
        # ── Confidence band (±1.96σ · √h approximation) ──────────────────────
        try:
            resid_std = float(np.sqrt(np.nanmean(model.resid.values ** 2)))
        except Exception:
            resid_std = 0.0

        for h, (d, v) in enumerate(zip(forecast.index, forecast.values), start=1):
            d_str = d.strftime('%Y-%m-%d %H:%M:%S') if not freq.startswith('D') else d.strftime('%Y-%m-%d')
            ci_half = 1.96 * resid_std * float(np.sqrt(h)) if resid_std > 0 else 0.0
            fv = float(v) if not pd.isna(v) else None
            entry = {
                "date": d_str,
                "forecast": fv,
                "lower": round(fv - ci_half, 4) if fv is not None else None,
                "upper": round(fv + ci_half, 4) if fv is not None else None,
            }
            if d_str in merged_data:
                merged_data[d_str].update(entry)
            else:
                merged_data[d_str] = entry

        result_rows = sorted(merged_data.values(), key=lambda x: x['date'])

        # ── Summary stats for AI insights ─────────────────────────────────
        actual_vals  = [r["actual"]   for r in result_rows if r.get("actual")   is not None]
        fcast_vals   = [r["forecast"] for r in result_rows if r.get("forecast") is not None]
        trend_pct = round((fcast_vals[-1] - fcast_vals[0]) / abs(fcast_vals[0]) * 100, 1) if len(fcast_vals) > 1 and fcast_vals[0] else 0

        return {
            "chart": result_rows,
            "stats": {
                "actual_mean":    round(float(np.mean(actual_vals)), 2) if actual_vals else None,
                "actual_std":     round(float(np.std(actual_vals)),  2) if actual_vals else None,
                "forecast_end":   round(fcast_vals[-1], 2)              if fcast_vals  else None,
                "forecast_start": round(fcast_vals[0],  2)              if fcast_vals  else None,
                "trend_pct":      trend_pct,
                "periods":        periods,
                "freq":           freq,
                "value_column":   value_col,
            }
        }
        
    except Exception as e:
        logger.error(f"Forecasting failed: {e}", exc_info=True)
        return {"error": f"Forecasting engine error: {str(e)}"}

def detect_anomalies(
    df: pd.DataFrame, 
    value_col: str, 
    contamination: float = 0.05
) -> Dict[str, Any]:
    """
    Detect anomalies using Isolation Forest.
    """
    try:
        from sklearn.ensemble import IsolationForest
    except ImportError:
        logger.error("scikit-learn is not installed")
        return {"error": "Analytics dependencies not installed"}

    try:
        data = df[[value_col]].dropna()
        
        if len(data) < 10:
            return {"error": "Not enough data points for anomaly detection"}

        clf = IsolationForest(contamination=contamination, random_state=42)
        preds = clf.fit_predict(data)
        
        # -1 indicates anomaly, 1 indicates normal
        data['is_anomaly'] = preds == -1
        
        # Prepare data for frontend - Downsample if too large to prevent browser crash
        max_points = 2000
        total_len = len(data)
        
        if total_len > max_points:
            step = total_len // max_points
            data_to_plot = data.iloc[::step].copy()
        else:
            data_to_plot = data.copy()

        plot_data = []
        for i, (idx, row) in enumerate(data_to_plot.iterrows()):
            val = row[value_col]
            plot_data.append({
                "index": int(i),
                "value": float(val) if not pd.isna(val) else None,
                "isAnomaly": bool(row['is_anomaly'])
            })
            
        anomaly_count = int(data['is_anomaly'].sum())
        all_vals = data[value_col].dropna()
        return {
            "data": plot_data,
            "total_points": total_len,
            "anomaly_count": anomaly_count,
            "stats": {
                "total_points":    total_len,
                "anomaly_count":   anomaly_count,
                "anomaly_pct":     round(anomaly_count / total_len * 100, 1) if total_len else 0,
                "value_mean":      round(float(all_vals.mean()), 2) if len(all_vals) else None,
                "value_std":       round(float(all_vals.std()),  2) if len(all_vals) else None,
                "value_min":       round(float(all_vals.min()),  2) if len(all_vals) else None,
                "value_max":       round(float(all_vals.max()),  2) if len(all_vals) else None,
                "value_column":    value_col,
                "contamination":   contamination,
            }
        }
        
    except Exception as e:
        logger.error(f"Anomaly detection failed: {e}", exc_info=True)
        return {"error": str(e)}

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