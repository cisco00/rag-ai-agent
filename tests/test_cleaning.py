
import unittest
import pandas as pd
import numpy as np
import sys
import os

# Add src to path
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'src'))

from transformations import DataTransformer

class TestDataCleaning(unittest.TestCase):
    
    def setUp(self):
        self.df = pd.DataFrame({
            'text': ['  hello ', 'WORLD', 'Foo Bar', 'Test 123!', '  junk  '],
            'vals': [1, 2, 3, 1000, 2], # 1000 is outlier
            'dup_col': ['A', 'A', 'B', 'B', 'C']
        })
        
    def test_clean_duplicates(self):
        # Create df with actual duplicate rows
        df = pd.DataFrame({'a': [1, 1, 2], 'b': [1, 1, 3]})
        op = {"type": "clean", "method": "drop_duplicates"}
        cleaned = DataTransformer.apply_transformations(df.copy(), [op])
        self.assertEqual(len(cleaned), 2)
        
    def test_clean_text_trim(self):
        op = {"type": "clean", "method": "clean_text", "column": "text", "clean_type": "trim"}
        df = DataTransformer.apply_transformations(self.df.copy(), [op])
        self.assertEqual(df['text'].iloc[0], 'hello')
        self.assertEqual(df['text'].iloc[4], 'junk')

    def test_clean_text_case(self):
        op = {"type": "clean", "method": "clean_text", "column": "text", "clean_type": "lower"}
        df = DataTransformer.apply_transformations(self.df.copy(), [op])
        self.assertEqual(df['text'].iloc[1], 'world')
        
    def test_clean_text_remove_special(self):
        op = {"type": "clean", "method": "clean_text", "column": "text", "clean_type": "remove_special"}
        df = DataTransformer.apply_transformations(self.df.copy(), [op])
        # 'Test 123!' -> 'Test 123'
        self.assertEqual(df['text'].iloc[3], 'Test 123')

    def test_remove_outliers_zscore(self):
        op = {"type": "clean", "method": "remove_outliers", "column": "vals", "outlier_method": "z-score", "threshold": 1.5}
        df = DataTransformer.apply_transformations(self.df.copy(), [op])
        # 1000 should be removed
        self.assertNotIn(1000, df['vals'].values)
        self.assertEqual(len(df), 4)

    def test_remove_outliers_iqr(self):
        op = {"type": "clean", "method": "remove_outliers", "column": "vals", "outlier_method": "iqr"}
        df = DataTransformer.apply_transformations(self.df.copy(), [op])
        self.assertNotIn(1000, df['vals'].values)
        self.assertEqual(len(df), 4)

if __name__ == '__main__':
    unittest.main()
