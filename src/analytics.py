
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
        df[date_col] = pd.to_datetime(df[date_col])
        ts_data = df.set_index(date_col)[value_col].sort_index()
        
        # Handle duplicates by taking mean
        ts_data = ts_data.groupby(level=0).mean()
        
        # Fill missing values if any (needed for TSA)
        ts_data = ts_data.asfreq(freq).ffill()
        
        # Fit model
        # Use simple exponential smoothing if data is short, otherwise Holt-Winters
        if len(ts_data) < 10:
             logger.warning("Not enough data for forecasting")
             return {"error": "Not enough data points (min 10 required)"}

        model = ExponentialSmoothing(
            ts_data, 
            seasonal_periods=7 if freq=='D' else None,
            trend='add', 
            seasonal='add' if len(ts_data) > 14 else None
        ).fit()
        
        # Forecast
        forecast = model.forecast(periods)
        
        return {
            "historical": {
                "dates": ts_data.index.strftime('%Y-%m-%d').tolist(),
                "values": ts_data.values.tolist()
            },
            "forecast": {
                "dates": forecast.index.strftime('%Y-%m-%d').tolist(),
                "values": forecast.values.tolist()
            },
            "model_type": "ExponentialSmoothing"
        }
        
    except Exception as e:
        logger.error(f"Forecasting failed: {e}", exc_info=True)
        return {"error": str(e)}

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
        
        anomalies = data[data['is_anomaly']]
        
        return {
            "anomalies": {
                "indices": anomalies.index.tolist(),
                "values": anomalies[value_col].tolist()
            },
            "total_points": len(data),
            "anomaly_count": len(anomalies)
        }
        
    except Exception as e:
        logger.error(f"Anomaly detection failed: {e}", exc_info=True)
        return {"error": str(e)}
