
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
            
        for d, v in zip(forecast.index, forecast.values):
            d_str = d.strftime('%Y-%m-%d %H:%M:%S') if not freq.startswith('D') else d.strftime('%Y-%m-%d')
            if d_str in merged_data:
                merged_data[d_str]["forecast"] = float(v) if not pd.isna(v) else None
            else:
                merged_data[d_str] = {
                    "date": d_str,
                    "forecast": float(v) if not pd.isna(v) else None
                }
            
        return sorted(merged_data.values(), key=lambda x: x['date'])
        
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
            
        return {
            "data": plot_data,
            "total_points": total_len,
            "anomaly_count": int(data['is_anomaly'].sum())
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
        
        return {
            "columns": corr_matrix.columns.tolist(),
            "correlation_matrix": corr_matrix.values.tolist(), # List of lists
            "method": method
        }
        
    except Exception as e:
        logger.error(f"Correlation failed: {e}", exc_info=True)
        return {"error": str(e)}
