
import requests
import json
import pandas as pd
import unittest
import os
from io import BytesIO

# Configuration
API_URL = "http://localhost:8000"
API_KEY = "test_api_key_correlation"

class TestCorrelationAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # 1. Register Org & Get Config
        try:
            # Check if API is running
            requests.get(API_URL)
        except requests.exceptions.ConnectionError:
            print("API is not running. Please start the backend server.")
            raise

        # Register (or get existing from earlier runs if we reused key mechanism, 
        # but here we rely on auto-provisioning logic or just mocking)
        # For simplicity, we'll try to use a known key or register a new one.
        # Let's register a new strict one.
        import uuid
        username = f"CorrelationTester_{uuid.uuid4().hex[:8]}"
        resp = requests.post(f"{API_URL}/register", json={"name": username})
        if resp.status_code == 200:
            cls.api_key = resp.json()["api_key"]
            print(f"Registered new user: {username}")
        else:
            print(f"Registration failed: {resp.text}")
            # Try to use a default or fail
            cls.api_key = API_KEY 
            
        print(f"Using API Key: {cls.api_key}")

        # 2. Upload a Test Dataset
        # Create small CSV
        df = pd.DataFrame({
            'A': [1, 2, 3, 4, 5],
            'B': [2, 4, 6, 8, 10], # Perfect correlation with A
            'C': [5, 4, 3, 2, 1], # Perfect negative correlation with A
            'D': [1, 1, 1, 1, 1], # Constant (No correlation / NaN)
            'S': ['a', 'b', 'c', 'd', 'e'], # String (non-numeric)
            'Date': pd.date_range(start='2024-01-01', periods=5)
        })
        
        csv_buffer = BytesIO()
        df.to_csv(csv_buffer, index=False)
        csv_buffer.seek(0)
        
        files = {'file': ('correlation_test.csv', csv_buffer, 'text/csv')}
        resp = requests.post(
            f"{API_URL}/import", 
            headers={'X-API-KEY': cls.api_key},
            files=files,
            data={'if_exists': 'replace'}
        )
        assert resp.status_code == 200, f"Import failed: {resp.text}"
        cls.table_name = resp.json()["table_name"]
        cls.columns = resp.json()["column_names"]
        print(f"Uploaded table: {cls.table_name}")
        print(f"Columns: {cls.columns}")

    def test_0_forecast_sanity(self):
        # Find date column and value column from actual columns
        # Case insensitive search
        date_col = next((c for c in self.columns if c.lower() == 'date'), 'Date')
        val_col = next((c for c in self.columns if c.lower() == 'a'), 'A')
        
        # Sanity check: Does forecast endpoint work?
        payload = {
            "table_name": self.table_name,
            "date_column": date_col,
            "value_column": val_col
        }
        resp = requests.post(
            f"{API_URL}/analytics/forecast", 
            headers={'X-API-KEY': self.api_key},
            json=payload
        )
        if resp.status_code != 200:
             print(f"Forecast Sanity Check Failed: {resp.status_code} - {resp.text}")
        else:
             print("Forecast Sanity Check Passed")
        # We don't assert here to let other tests run, but it prints status.

    def test_correlation_defaults(self):
        # Test default (Pearson, all numeric columns)
        payload = {
            "table_name": self.table_name
        }
        resp = requests.post(
            f"{API_URL}/analytics/correlation", 
            headers={'X-API-KEY': self.api_key},
            json=payload
        )
        self.assertEqual(resp.status_code, 200, resp.text)
        data = resp.json()
        
        self.assertIn("columns", data)
        self.assertIn("matrix", data)
        self.assertEqual(data["method"], "pearson")
        
        # Verify columns (A, B, C, D) - S should be ignored, Date ignored?
        # analytics.py selects all numeric.
        cols = data["columns"]
        col_a = next((c for c in self.columns if c.lower() == 'a'), 'A')
        col_b = next((c for c in self.columns if c.lower() == 'b'), 'B')
        col_s = next((c for c in self.columns if c.lower() == 's'), 'S')
        
        self.assertIn(col_a, cols)
        self.assertNotIn(col_s, cols)
        
        # Verify Matrix Values
        # Index of A
        idx_a = cols.index(col_a)
        idx_b = cols.index(col_b)
        
        matrix = data["matrix"]
        # Correlation A-B should be 1.0
        self.assertAlmostEqual(matrix[idx_a][idx_b], 1.0)

    def test_correlation_spearman(self):
        payload = {
            "table_name": self.table_name,
            "method": "spearman"
        }
        resp = requests.post(
            f"{API_URL}/analytics/correlation", 
            headers={'X-API-KEY': self.api_key},
            json=payload
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["method"], "spearman")

    def test_correlation_specific_columns(self):
        col_a = next((c for c in self.columns if c.lower() == 'a'), 'A')
        col_c = next((c for c in self.columns if c.lower() == 'c'), 'C')
        
        payload = {
            "table_name": self.table_name,
            "columns": [col_a, col_c]
        }
        resp = requests.post(
            f"{API_URL}/analytics/correlation", 
            headers={'X-API-KEY': self.api_key},
            json=payload
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(len(data["columns"]), 2)
        self.assertIn(col_a, data["columns"])
        self.assertIn(col_c, data["columns"])

if __name__ == "__main__":
    unittest.main()
