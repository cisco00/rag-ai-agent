
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

# ── Regression Analysis ───────────────────────────────────────────────────────

def perform_regression(
    df: pd.DataFrame,
    target_col: str,
    feature_cols: List[str],
    test_size: float = 0.2,
    include_residuals: bool = True,
) -> Dict[str, Any]:
    """
    Multiple linear regression.  Returns coefficients, R², RMSE, and
    a sample of actual-vs-predicted points for the scatter chart.
    """
    try:
        from sklearn.linear_model import LinearRegression
        from sklearn.model_selection import train_test_split
        from sklearn.metrics import mean_squared_error, r2_score
        from sklearn.preprocessing import StandardScaler

        cols = [target_col] + feature_cols
        df2 = df[cols].dropna().copy()
        for c in cols:
            df2[c] = pd.to_numeric(df2[c], errors='coerce')
        df2 = df2.dropna()

        if len(df2) < 10:
            return {"error": "Need at least 10 rows with numeric data for regression."}

        X = df2[feature_cols].values
        y = df2[target_col].values

        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=test_size, random_state=42
        )

        scaler = StandardScaler()
        X_train_s = scaler.fit_transform(X_train)
        X_test_s  = scaler.transform(X_test)

        model = LinearRegression()
        model.fit(X_train_s, y_train)

        y_pred   = model.predict(X_test_s)
        r2       = float(r2_score(y_test, y_pred))
        rmse     = float(np.sqrt(mean_squared_error(y_test, y_pred)))
        mae      = float(np.mean(np.abs(y_test - y_pred)))

        coefficients = [
            {"feature": f, "coefficient": float(c)}
            for f, c in zip(feature_cols, model.coef_)
        ]
        coefficients.sort(key=lambda x: abs(x["coefficient"]), reverse=True)

        # Scatter: actual vs predicted (capped at 300 points)
        scatter = [
            {"actual": float(a), "predicted": float(p)}
            for a, p in zip(y_test[:300], y_pred[:300])
        ]

        residuals = []
        if include_residuals:
            res = y_test - y_pred
            residuals = [
                {"predicted": float(p), "residual": float(r)}
                for p, r in zip(y_pred[:300], res[:300])
            ]

        return {
            "scatter": scatter,
            "residuals": residuals,
            "stats": {
                "r2":           round(r2, 4),
                "rmse":         round(rmse, 4),
                "mae":          round(mae, 4),
                "n_train":      int(len(X_train)),
                "n_test":       int(len(X_test)),
                "intercept":    round(float(model.intercept_), 4),
                "target_col":   target_col,
                "feature_cols": feature_cols,
            },
            "coefficients": coefficients,
        }

    except ImportError:
        return {"error": "scikit-learn is required for regression. Install with: pip install scikit-learn"}
    except Exception as e:
        logger.error(f"Regression failed: {e}", exc_info=True)
        return {"error": str(e)}


# ── Classification Analysis ───────────────────────────────────────────────────

def perform_classification(
    df: pd.DataFrame,
    target_col: str,
    feature_cols: List[str],
    test_size: float = 0.2,
    max_depth: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Random Forest classification.  Returns accuracy, per-class precision/recall/F1,
    confusion matrix, and feature importances.
    """
    try:
        from sklearn.ensemble import RandomForestClassifier
        from sklearn.model_selection import train_test_split
        from sklearn.metrics import (
            accuracy_score, classification_report, confusion_matrix
        )
        from sklearn.preprocessing import LabelEncoder

        cols = [target_col] + feature_cols
        df2 = df[cols].dropna().copy()
        for f in feature_cols:
            df2[f] = pd.to_numeric(df2[f], errors='coerce')
        df2 = df2.dropna()

        if len(df2) < 10:
            return {"error": "Need at least 10 rows with numeric features for classification."}

        le = LabelEncoder()
        y = le.fit_transform(df2[target_col].astype(str))
        X = df2[feature_cols].values

        n_classes = len(le.classes_)
        if n_classes < 2:
            return {"error": "Target column must have at least 2 distinct classes."}
        if n_classes > 50:
            return {"error": "Too many classes (>50). Consider binning the target column first."}

        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=test_size, random_state=42, stratify=y if len(df2) >= 50 else None
        )

        depth = min(max_depth, 10) if max_depth else None
        model = RandomForestClassifier(n_estimators=100, max_depth=depth, random_state=42, n_jobs=-1)
        model.fit(X_train, y_train)

        y_pred   = model.predict(X_test)
        accuracy = float(accuracy_score(y_test, y_pred))

        report = classification_report(
            y_test, y_pred,
            target_names=[str(c) for c in le.classes_],
            output_dict=True, zero_division=0
        )
        per_class = [
            {
                "class":     str(cls),
                "precision": round(float(report[str(cls)]["precision"]), 3),
                "recall":    round(float(report[str(cls)]["recall"]),    3),
                "f1":        round(float(report[str(cls)]["f1-score"]),  3),
                "support":   int(report[str(cls)]["support"]),
            }
            for cls in le.classes_
            if str(cls) in report
        ]

        cm = confusion_matrix(y_test, y_pred).tolist()

        importances = [
            {"feature": f, "importance": round(float(imp), 4)}
            for f, imp in sorted(
                zip(feature_cols, model.feature_importances_),
                key=lambda x: x[1], reverse=True
            )
        ]

        return {
            "per_class": per_class,
            "confusion_matrix": cm,
            "class_labels": [str(c) for c in le.classes_],
            "feature_importances": importances,
            "stats": {
                "accuracy":     round(accuracy, 4),
                "n_train":      int(len(X_train)),
                "n_test":       int(len(X_test)),
                "n_classes":    n_classes,
                "target_col":   target_col,
                "feature_cols": feature_cols,
                "macro_f1":     round(float(report["macro avg"]["f1-score"]), 4),
                "weighted_f1":  round(float(report["weighted avg"]["f1-score"]), 4),
            },
        }

    except ImportError:
        return {"error": "scikit-learn is required. Install with: pip install scikit-learn"}
    except Exception as e:
        logger.error(f"Classification failed: {e}", exc_info=True)
        return {"error": str(e)}


# ── Principal Component Analysis ──────────────────────────────────────────────

def perform_pca(
    df: pd.DataFrame,
    columns: Optional[List[str]],
    n_components: int = 2,
) -> Dict[str, Any]:
    """
    PCA on numeric columns.  Returns explained variance, loadings, and
    a 2-D scatter of the first two components for visualisation.
    """
    try:
        from sklearn.decomposition import PCA
        from sklearn.preprocessing import StandardScaler

        if columns:
            df2 = df[columns].copy()
        else:
            df2 = df.select_dtypes(include=[np.number]).copy()

        df2 = df2.dropna()
        for c in df2.columns:
            df2[c] = pd.to_numeric(df2[c], errors='coerce')
        df2 = df2.dropna()

        if df2.shape[0] < 5:
            return {"error": "Need at least 5 rows for PCA."}
        if df2.shape[1] < 2:
            return {"error": "Need at least 2 numeric columns for PCA."}

        n_comp = min(n_components, df2.shape[1], df2.shape[0])
        feature_names = list(df2.columns)

        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(df2.values)

        pca = PCA(n_components=n_comp, random_state=42)
        X_pca = pca.fit_transform(X_scaled)

        evr  = [round(float(v), 4) for v in pca.explained_variance_ratio_]
        cum  = [round(float(v), 4) for v in np.cumsum(pca.explained_variance_ratio_)]

        loadings = []
        for i, comp in enumerate(pca.components_):
            for j, feat in enumerate(feature_names):
                loadings.append({
                    "component": f"PC{i+1}",
                    "feature":   feat,
                    "loading":   round(float(comp[j]), 4),
                })

        # 2-D scatter of PC1 vs PC2 (capped at 500 points)
        scatter = [
            {"pc1": round(float(X_pca[i, 0]), 4),
             "pc2": round(float(X_pca[i, 1]), 4) if n_comp > 1 else 0.0}
            for i in range(min(len(X_pca), 500))
        ]

        variance_per_component = [
            {"component": f"PC{i+1}", "explained_variance": evr[i], "cumulative": cum[i]}
            for i in range(len(evr))
        ]

        return {
            "scatter": scatter,
            "variance_per_component": variance_per_component,
            "loadings": loadings,
            "stats": {
                "n_components":          n_comp,
                "total_variance_explained": round(float(sum(evr)), 4),
                "n_samples":             int(df2.shape[0]),
                "n_features":            int(df2.shape[1]),
                "feature_names":         feature_names,
            },
        }

    except ImportError:
        return {"error": "scikit-learn is required. Install with: pip install scikit-learn"}
    except Exception as e:
        logger.error(f"PCA failed: {e}", exc_info=True)
        return {"error": str(e)}


# ── Hypothesis Testing ────────────────────────────────────────────────────────

def perform_hypothesis_test(
    df: pd.DataFrame,
    col1: str,
    col2: Optional[str],
    test_type: str,
    alpha: float,
    popmean: float,
) -> Dict[str, Any]:
    """
    Statistical hypothesis tests: ttest_ind, ttest_1samp, mannwhitneyu, chi2.
    Returns statistic, p_value, decision, effect_size where applicable.
    """
    try:
        from scipy import stats

        def _clean(col: str) -> np.ndarray:
            s = pd.to_numeric(df[col], errors='coerce').dropna()
            return s.values

        if test_type == "ttest_1samp":
            a = _clean(col1)
            if len(a) < 3:
                return {"error": "Need at least 3 data points for one-sample t-test."}
            stat, p = stats.ttest_1samp(a, popmean)
            effect_size = round(float((np.mean(a) - popmean) / np.std(a, ddof=1)), 4) if np.std(a, ddof=1) else None
            return _hypothesis_response(test_type, stat, p, alpha, {
                "sample_mean":   round(float(np.mean(a)), 4),
                "sample_std":    round(float(np.std(a, ddof=1)), 4),
                "population_mean_tested": popmean,
                "n":             int(len(a)),
                "cohens_d":      effect_size,
            })

        elif test_type == "ttest_ind":
            if not col2:
                return {"error": "Two-sample t-test requires a second column."}
            a, b = _clean(col1), _clean(col2)
            if len(a) < 3 or len(b) < 3:
                return {"error": "Need at least 3 data points per group."}
            stat, p = stats.ttest_ind(a, b)
            pooled_std = np.sqrt((np.std(a, ddof=1)**2 + np.std(b, ddof=1)**2) / 2)
            d = round(float((np.mean(a) - np.mean(b)) / pooled_std), 4) if pooled_std else None
            return _hypothesis_response(test_type, stat, p, alpha, {
                "group1_mean": round(float(np.mean(a)), 4),
                "group2_mean": round(float(np.mean(b)), 4),
                "group1_std":  round(float(np.std(a, ddof=1)), 4),
                "group2_std":  round(float(np.std(b, ddof=1)), 4),
                "group1_n":    int(len(a)),
                "group2_n":    int(len(b)),
                "cohens_d":    d,
            })

        elif test_type == "mannwhitneyu":
            if not col2:
                return {"error": "Mann-Whitney U test requires a second column."}
            a, b = _clean(col1), _clean(col2)
            if len(a) < 3 or len(b) < 3:
                return {"error": "Need at least 3 data points per group."}
            stat, p = stats.mannwhitneyu(a, b, alternative='two-sided')
            r = round(float(stat / (len(a) * len(b))), 4)   # rank-biserial correlation
            return _hypothesis_response(test_type, stat, p, alpha, {
                "group1_median": round(float(np.median(a)), 4),
                "group2_median": round(float(np.median(b)), 4),
                "group1_n":      int(len(a)),
                "group2_n":      int(len(b)),
                "rank_biserial_r": r,
            })

        elif test_type == "chi2":
            if not col2:
                return {"error": "Chi-square test requires a second column."}
            ct = pd.crosstab(df[col1].astype(str), df[col2].astype(str))
            if ct.shape[0] < 2 or ct.shape[1] < 2:
                return {"error": "Chi-square test requires at least 2 categories in each variable."}
            stat, p, dof, expected = stats.chi2_contingency(ct)
            cramers = round(float(np.sqrt(stat / (len(df) * (min(ct.shape) - 1)))), 4) if len(df) > 0 else None
            return _hypothesis_response(test_type, stat, p, alpha, {
                "degrees_of_freedom": int(dof),
                "cramers_v":          cramers,
                "table_shape":        list(ct.shape),
            })

        else:
            return {"error": f"Unknown test_type: '{test_type}'. Use ttest_ind, ttest_1samp, mannwhitneyu, or chi2."}

    except ImportError:
        return {"error": "scipy is required. Install with: pip install scipy"}
    except Exception as e:
        logger.error(f"Hypothesis test failed: {e}", exc_info=True)
        return {"error": str(e)}


def _hypothesis_response(
    test_type: str,
    stat: float,
    p: float,
    alpha: float,
    extra: dict,
) -> Dict[str, Any]:
    reject = bool(p < alpha)
    labels = {
        "ttest_1samp":  "One-sample t-test",
        "ttest_ind":    "Independent samples t-test",
        "mannwhitneyu": "Mann-Whitney U test",
        "chi2":         "Chi-square test of independence",
    }
    return {
        "stats": {
            "test_type":   test_type,
            "test_label":  labels.get(test_type, test_type),
            "statistic":   round(float(stat), 4),
            "p_value":     round(float(p), 6),
            "alpha":       alpha,
            "reject_null": reject,
            "decision":    "Reject H₀" if reject else "Fail to reject H₀",
            **extra,
        }
    }
