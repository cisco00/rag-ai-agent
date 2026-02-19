
import unittest
import pandas as pd
import numpy as np
import sys
import os

# Add src to path
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'src'))

from transformations import DataTransformer

class TestDataTransformer(unittest.TestCase):
    
    def setUp(self):
        self.df = pd.DataFrame({
            'a': [1, 2, 3, 4, 5],
            'b': [10, 20, 30, 40, 50],
            'cat': ['A', 'A', 'B', 'B', 'C'],
            'text': ['hello world', 'foo bar', 'baz', 'hello', 'world'],
            'date': ['2023-01-01', '2023-01-02', '2023-01-03', '2023-01-04', '2023-01-05']
        })
        
    def test_filter(self):
        op = {"type": "filter", "column": "a", "op": ">", "value": 3}
        df = DataTransformer.apply_transformations(self.df.copy(), [op])
        self.assertEqual(len(df), 2)
        self.assertTrue((df['a'] > 3).all())
        
    def test_normalize_minmax(self):
        op = {"type": "normalize", "column": "a", "method": "min-max"}
        df = DataTransformer.apply_transformations(self.df.copy(), [op])
        self.assertIn('a_scaled', df.columns)
        self.assertEqual(df['a_scaled'].min(), 0)
        self.assertEqual(df['a_scaled'].max(), 1)
        
    def test_normalize_zscore(self):
        op = {"type": "normalize", "column": "b", "method": "z-score"}
        df = DataTransformer.apply_transformations(self.df.copy(), [op])
        self.assertIn('b_zscore', df.columns)
        self.assertAlmostEqual(df['b_zscore'].mean(), 0)
        self.assertAlmostEqual(df['b_zscore'].std(), 1, places=1)
        
    def test_encode_onehot(self):
        op = {"type": "encode", "column": "cat", "method": "one-hot"}
        df = DataTransformer.apply_transformations(self.df.copy(), [op])
        self.assertIn('cat_A', df.columns)
        self.assertIn('cat_B', df.columns)
        self.assertIn('cat_C', df.columns)
        self.assertEqual(df['cat_A'].iloc[0], 1) # True usually, pandas might return bool or int depending on version
        
    def test_feature_interaction(self):
        op = {"type": "feature_engineering", "feature_type": "interaction", 
              "column1": "a", "column2": "b", "operation": "*", "new_col_name": "a_times_b"}
        df = DataTransformer.apply_transformations(self.df.copy(), [op])
        self.assertIn('a_times_b', df.columns)
        self.assertEqual(df['a_times_b'].iloc[0], 10)
        
    def test_time_component(self):
        # First ensure date type
        self.df['date'] = pd.to_datetime(self.df['date'])
        op = {"type": "feature_engineering", "feature_type": "time_component", 
              "column": "date", "component": "day"}
        df = DataTransformer.apply_transformations(self.df.copy(), [op])
        self.assertIn('date_day', df.columns)
        self.assertEqual(df['date_day'].iloc[0], 1)
        
    def test_text_features(self):
        op = {"type": "text_feature", "column": "text", "method": "len"}
        df = DataTransformer.apply_transformations(self.df.copy(), [op])
        self.assertIn('text_len', df.columns)
        self.assertEqual(df['text_len'].iloc[0], 11)

    def test_aggregate_groupby(self):
        op = {"type": "aggregate", "method": "groupby", "group_cols": ["cat"],
              "aggregations": {"a": ["sum", "mean"]}}
        df = DataTransformer.apply_transformations(self.df.copy(), [op])
        # Columns should be cat, a_sum, a_mean
        self.assertIn('a_sum', df.columns)
        self.assertEqual(len(df), 3) # A, B, C
        self.assertEqual(df[df['cat']=='A']['a_sum'].values[0], 3) # 1+2

if __name__ == '__main__':
    unittest.main()
