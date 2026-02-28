
import pandas as pd
import numpy as np
import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

class DataTransformer:
    """
    Handles data transformation and feature engineering operations on pandas DataFrames.
    """
    
    @staticmethod
    def apply_transformations(df: pd.DataFrame, operations: List[Dict[str, Any]]) -> pd.DataFrame:
        """
        Apply a sequence of transformations to the dataframe.
        
        Args:
            df: Input DataFrame
            operations: List of operation dictionaries
            
        Returns:
            Transformed DataFrame
        """
        for op in operations:
            op_type = op.get("type")
            try:
                if op_type == "filter":
                     df = DataTransformer._apply_filter(df, op)
                elif op_type == "drop_col":
                     df = df.drop(columns=[op["column"]])
                elif op_type == "rename_col":
                     df = df.rename(columns={op["column"]: op["new_name"]})
                elif op_type == "fill_na":
                     df = DataTransformer._fill_na(df, op)
                elif op_type == "change_type":
                     df = DataTransformer._change_type(df, op)
                elif op_type == "normalize":
                     df = DataTransformer._normalize(df, op)
                elif op_type == "encode":
                     df = DataTransformer._encode_variables(df, op)
                elif op_type == "feature_engineering":
                     df = DataTransformer._feature_engineering(df, op)
                elif op_type == "text_feature":
                     df = DataTransformer._text_features(df, op)
                elif op_type == "aggregate":
                     df = DataTransformer._aggregate_data(df, op)
                elif op_type == "clean":
                     df = DataTransformer._clean_data(df, op)
                else:
                    logger.warning(f"Unknown operation type: {op_type}")
            except Exception as e:
                logger.error(f"Error applying {op_type}: {e}")
                raise e
                
        return df

    @staticmethod
    def _apply_filter(df: pd.DataFrame, op: Dict[str, Any]) -> pd.DataFrame:
        col = op["column"]
        val = op["value"]
        operator = op.get("op", "==")
        
        if operator == ">":
            return df[df[col] > val]
        elif operator == "<":
            return df[df[col] < val]
        elif operator == "==":
            return df[df[col] == val]
        elif operator == "!=":
            return df[df[col] != val]
        elif operator == ">=":
            return df[df[col] >= val]
        elif operator == "<=":
            return df[df[col] <= val]
        return df

    @staticmethod
    def _change_type(df: pd.DataFrame, op: Dict[str, Any]) -> pd.DataFrame:
        col = op["column"]
        new_type = op["new_type"]
        
        if new_type == "int":
            df[col] = pd.to_numeric(df[col], errors='coerce').astype('Int64')
        elif new_type == "float":
            df[col] = pd.to_numeric(df[col], errors='coerce')
        elif new_type == "str":
            df[col] = df[col].astype(str)
        elif new_type == "datetime":
            df[col] = pd.to_datetime(df[col], errors='coerce')
        elif new_type == "bool":
             # "Yes"/"No" -> True/False or 1/0 is handled in encoding usually, 
             # but here we can do basic bool conversion
             df[col] = df[col].astype(bool)
        
        return df

    @staticmethod
    def _normalize(df: pd.DataFrame, op: Dict[str, Any]) -> pd.DataFrame:
        """
        Apply normalization/scaling to a column.
        Methods: min-max, z-score, log, box-cox
        """
        col = op["column"]
        method = op.get("method", "min-max")
        
        if method == "min-max":
            min_val = df[col].min()
            max_val = df[col].max()
            if max_val - min_val != 0:
                df[f"{col}_scaled"] = (df[col] - min_val) / (max_val - min_val)
            else:
                df[f"{col}_scaled"] = 0
                
        elif method == "z-score":
            mean_val = df[col].mean()
            std_val = df[col].std()
            if std_val != 0:
                df[f"{col}_zscore"] = (df[col] - mean_val) / std_val
            else:
                df[f"{col}_zscore"] = 0
                
        elif method == "log":
            # Add small epsilon to avoid log(0)
            epsilon = op.get("epsilon", 1e-6)
            df[f"{col}_log"] = np.log(df[col] + epsilon)
            
        elif method == "box-cox":
            from scipy import stats
            # Requires positive data
            if (df[col] <= 0).any():
                logger.warning(f"Box-Cox requires positive values. Skipping for {col}")
            else:
                df[f"{col}_boxcox"], _ = stats.boxcox(df[col])
                
        return df

    @staticmethod
    def _encode_variables(df: pd.DataFrame, op: Dict[str, Any]) -> pd.DataFrame:
        """
        Encode categorical variables.
        Methods: one-hot, label, binary (yes/no -> 1/0)
        """
        col = op["column"]
        method = op.get("method", "one-hot")
        
        if method == "one-hot":
            # Limit number of categories to avoid explosion
            top_k = op.get("top_k", 10)
            dummies = pd.get_dummies(df[col], prefix=col)
            if len(dummies.columns) > top_k:
                 # Keep only top K categories
                 top_cats = df[col].value_counts().nlargest(top_k).index
                 df.loc[~df[col].isin(top_cats), col] = "Other"
                 dummies = pd.get_dummies(df[col], prefix=col)
            
            df = pd.concat([df, dummies], axis=1)
            
        elif method == "label":
            df[f"{col}_encoded"] = df[col].astype('category').cat.codes
            
        elif method == "binary":
            # Customized mapping for binary values
            true_val = op.get("true_value", "Yes")
            false_val = op.get("false_value", "No")
            # Create a mapping dictionary handling case insensitivity if needed
            mapping = {true_val: 1, false_val: 0}
            df[f"{col}_encoded"] = df[col].map(mapping).fillna(0).astype(int)
            
        return df

    @staticmethod
    def _feature_engineering(df: pd.DataFrame, op: Dict[str, Any]) -> pd.DataFrame:
        """
        Create new features.
        Types: interaction, ratio, time_component
        """
        feat_type = op.get("feature_type")
        
        if feat_type == "interaction":
            col1 = op["column1"]
            col2 = op["column2"]
            operation = op.get("operation", "*")
            
            name = op.get("new_col_name", f"{col1}_{operation}_{col2}")
            
            if operation == "*":
                df[name] = df[col1] * df[col2]
            elif operation == "/":
                df[name] = df[col1] / df[col2].replace(0, np.nan)
            elif operation == "+":
                df[name] = df[col1] + df[col2]
            elif operation == "-":
                df[name] = df[col1] - df[col2]
                
        elif feat_type == "time_component":
            col = op["column"]
            component = op.get("component") # day, month, year, dow, hour
            
            # Ensure proper type
            if not pd.api.types.is_datetime64_any_dtype(df[col]):
                df[col] = pd.to_datetime(df[col], errors='coerce')
                
            if component == "day":
                df[f"{col}_day"] = df[col].dt.day
            elif component == "month":
                df[f"{col}_month"] = df[col].dt.month
            elif component == "year":
                df[f"{col}_year"] = df[col].dt.year
            elif component == "dow":
                df[f"{col}_dow"] = df[col].dt.dayofweek
            elif component == "quarter":
                df[f"{col}_quarter"] = df[col].dt.quarter
                
        elif feat_type == "lag":
             col = op["column"]
             periods = op.get("periods", 1)
             sort_by = op.get("sort_by") # Optional sort column (e.g. date)
             
             if sort_by:
                 df = df.sort_values(sort_by)
                 
             df[f"{col}_lag_{periods}"] = df[col].shift(periods)
             
        return df

    @staticmethod
    def _text_features(df: pd.DataFrame, op: Dict[str, Any]) -> pd.DataFrame:
        """
        Extract features from text.
        Methods: len, word_count, tfidf (basic)
        """
        col = op["column"]
        method = op.get("method", "len")
        
        if method == "len":
            df[f"{col}_len"] = df[col].astype(str).apply(len)
        elif method == "word_count":
            df[f"{col}_word_count"] = df[col].astype(str).apply(lambda x: len(x.split()))
        elif method == "tfidf":
            try:
                from sklearn.feature_extraction.text import TfidfVectorizer
                max_features = op.get("max_features", 10)
                
                # Fill NaNs
                text_data = df[col].fillna("").astype(str)
                
                tfidf = TfidfVectorizer(max_features=max_features, stop_words='english')
                tfidf_matrix = tfidf.fit_transform(text_data)
                
                # Create DataFrame from TF-IDF
                feature_names = tfidf.get_feature_names_out()
                tfidf_df = pd.DataFrame(
                    tfidf_matrix.toarray(), 
                    columns=[f"{col}_tfidf_{name}" for name in feature_names],
                    index=df.index
                )
                
                df = pd.concat([df, tfidf_df], axis=1)
                
            except ImportError:
                logger.error("scikit-learn not installed for TF-IDF")
            except Exception as e:
                logger.error(f"TF-IDF failed: {e}")
                
        return df

    @staticmethod
    def _aggregate_data(df: pd.DataFrame, op: Dict[str, Any]) -> pd.DataFrame:
        """
        Aggregate data.
        Methods: groupby, resample
        """
        method = op.get("method", "groupby")
        
        if method == "groupby":
            group_cols = op.get("group_cols") # list of columns
            agg_dict = op.get("aggregations") # dict {col: [mean, sum], ...}
            
            if not group_cols or not agg_dict:
                return df
                
            grouped = df.groupby(group_cols).agg(agg_dict)
            
            # Flatten multi-index columns
            grouped.columns = ['_'.join(col).strip() for col in grouped.columns.values]
            grouped = grouped.reset_index()
            return grouped
            
        elif method == "resample":
             # Time-series resampling (e.g., Daily -> Monthly)
             date_col = op.get("date_col")
             freq = op.get("freq", "M") # D, W, M, Q, Y
             agg_dict = op.get("aggregations")
             
             if not date_col or not agg_dict:
                 return df
                 
             # Ensure date index
             df[date_col] = pd.to_datetime(df[date_col])
             resampled = df.set_index(date_col).resample(freq).agg(agg_dict)
             
             return resampled.reset_index()
             
        return df

    @staticmethod
    def _clean_data(df: pd.DataFrame, op: Dict[str, Any]) -> pd.DataFrame:
        """
        Clean data.
        Methods: drop_duplicates, clean_text, remove_outliers
        """
        method = op.get("method", "drop_duplicates")
        
        if method == "drop_duplicates":
            subset = op.get("subset") # optional list of columns
            if subset and isinstance(subset, str):
                subset = [subset]
            df = df.drop_duplicates(subset=subset, keep='first')
            
        elif method == "clean_text":
            col = op["column"]
            clean_type = op.get("clean_type", "trim")
            
            # Ensure string type
            df[col] = df[col].astype(str)
            
            if clean_type == "trim":
                df[col] = df[col].str.strip()
            elif clean_type == "lower":
                 df[col] = df[col].str.lower()
            elif clean_type == "upper":
                 df[col] = df[col].str.upper()
            elif clean_type == "title":
                 df[col] = df[col].str.title()
            elif clean_type == "replace":
                 old_val = op.get("old_value", "")
                 new_val = op.get("new_value", "")
                 df[col] = df[col].str.replace(old_val, new_val, regex=False)
            elif clean_type == "remove_special":
                 # Remove anything that is not alphanumeric or whitespace
                 df[col] = df[col].str.replace(r'[^a-zA-Z0-9\s]', '', regex=True)
                 
        elif method == "remove_outliers":
             col = op["column"]
             outlier_method = op.get("outlier_method", "z-score")
             threshold = op.get("threshold", 3.0)
             
             if outlier_method == "z-score":
                 from scipy import stats
                 z_scores = np.abs(stats.zscore(df[col]))
                 df = df[z_scores < threshold]
                 
             elif outlier_method == "iqr":
                 Q1 = df[col].quantile(0.25)
                 Q3 = df[col].quantile(0.75)
                 IQR = Q3 - Q1
                 lower_bound = Q1 - 1.5 * IQR
                 upper_bound = Q3 + 1.5 * IQR
                 df = df[(df[col] >= lower_bound) & (df[col] <= upper_bound)]
                 
        return df

    @staticmethod
    def _fill_na(df: pd.DataFrame, op: Dict[str, Any]) -> pd.DataFrame:
        """
        Fill missing values.
        Methods: value, mean, median, mode, weighted_mean, random
        """
        col = op.get("column") # Optional for 'value', required for others
        method = op.get("method", "value")
        
        # If no column specified, must be 'value' method (global fill)
        if not col:
             if method != "value":
                  logger.warning(f"Fill method {method} requires a column")
                  return df
             return df.fillna(op["value"])
             
        # Column specific fill
        if method == "value":
             df[col] = df[col].fillna(op["value"])
             
        elif method == "mean":
             if pd.api.types.is_numeric_dtype(df[col]):
                 df[col] = df[col].fillna(df[col].mean())
                 
        elif method == "median":
             if pd.api.types.is_numeric_dtype(df[col]):
                 df[col] = df[col].fillna(df[col].median())
                 
        elif method == "mode":
             if not df[col].mode().empty:
                 df[col] = df[col].fillna(df[col].mode()[0])
                 
        elif method == "weighted_mean":
             weight_col = op.get("weight_column")
             if weight_col and weight_col in df.columns and pd.api.types.is_numeric_dtype(df[col]):
                 # Calculate weighted mean ignoring NaNs
                 valid_mask = df[col].notna() & df[weight_col].notna()
                 if valid_mask.any():
                     wm = np.average(df.loc[valid_mask, col], weights=df.loc[valid_mask, weight_col])
                     df[col] = df[col].fillna(wm)
             else:
                 logger.warning(f"Weighted mean requires valid numeric weight column: {weight_col}")
                 
        elif method == "random":
             # Fill with random sampling from validation values
             non_na = df[col].dropna()
             if not non_na.empty:
                 na_count = df[col].isna().sum()
                 random_samples = np.random.choice(non_na, size=na_count, replace=True)
                 df.loc[df[col].isna(), col] = random_samples
                 
        return df
