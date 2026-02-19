
import unittest
import pandas as pd
import numpy as np
import sys
import os

# Add src to path
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'src'))

from transformations import DataTransformer

class TestFillNa(unittest.TestCase):
    
    def setUp(self):
        self.df = pd.DataFrame({
            'A': [1, 2, np.nan, 4, 5],
            'B': ['a', 'b', np.nan, 'a', 'b'],
            'W': [1, 2, 3, 4, 5], # Weights
            'V': [10, 20, 30, 40, 50]
        })
        
    def test_fill_value(self):
        op = {"type": "fill_na", "column": "A", "method": "value", "value": 0}
        df = DataTransformer.apply_transformations(self.df.copy(), [op])
        self.assertEqual(df['A'].iloc[2], 0)
        
    def test_fill_mean(self):
        op = {"type": "fill_na", "column": "A", "method": "mean"}
        df = DataTransformer.apply_transformations(self.df.copy(), [op])
        # Mean of [1, 2, 4, 5] is 3
        self.assertEqual(df['A'].iloc[2], 3)

    def test_fill_median(self):
        # [1, 2, 4, 5] -> median is 3
        op = {"type": "fill_na", "column": "A", "method": "median"}
        df = DataTransformer.apply_transformations(self.df.copy(), [op])
        self.assertEqual(df['A'].iloc[2], 3)
        
    def test_fill_mode(self):
        op = {"type": "fill_na", "column": "B", "method": "mode"}
        df = DataTransformer.apply_transformations(self.df.copy(), [op])
        # 'a' and 'b' appear twice. Mode default behavior picks one (usually first).
        self.assertIn(df['B'].iloc[2], ['a', 'b'])
        
    def test_fill_weighted_mean(self):
        # Weighted mean for A using W
        # A=[1, 2, 4, 5], W=[1, 2, 4, 5] (ignoring index 2 where A is nan)
        # sum(1*1 + 2*2 + 4*4 + 5*5) / sum(1+2+4+5)
        # (1 + 4 + 16 + 25) / 12 = 46/12 = 3.833...
        op = {"type": "fill_na", "column": "A", "method": "weighted_mean", "weight_column": "W"}
        df = DataTransformer.apply_transformations(self.df.copy(), [op])
        self.assertAlmostEqual(df['A'].iloc[2], 46/12, places=4)
        
    def test_fill_random(self):
        np.random.seed(42)
        op = {"type": "fill_na", "column": "A", "method": "random"}
        df = DataTransformer.apply_transformations(self.df.copy(), [op])
        self.assertFalse(df['A'].isna().any())
        self.assertIn(df['A'].iloc[2], [1, 2, 4, 5])

if __name__ == '__main__':
    unittest.main()
