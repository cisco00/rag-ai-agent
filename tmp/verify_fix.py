import pandas as pd
import sys
import os
import json

# Add backend to path
sys.path.append(os.path.join(os.getcwd(), 'backend'))

from database import DatabaseManager

def test_flattening_load():
    # Setup test DB
    db_path = "sqlite:///test_flatten.db"
    db = DatabaseManager(db_path)
    
    # Create test data with nested dicts (simulating AviationStack)
    data = {
        'id': [1],
        'flight_date': ['2026-03-23'],
        'departure': [{
            'airport': 'Beijing Capital',
            'timezone': 'Asia/Shanghai',
            'details': {'terminal': '3', 'gate': 'C10'}
        }],
        'tags': [['international', 'long-haul']]
    }
    df = pd.DataFrame(data)
    
    print("Original DataFrame columns:", df.columns.tolist())
    
    try:
        # Attempt to load
        db.load_dataframe(df, "aviation_test", if_exists='replace')
        print("\nLoad successful!")
        
        # Verify columns in DB
        results = db.execute_query("SELECT * FROM aviation_test")
        row = results[0]
        print("\nColumns in DB:", row.keys())
        
        # Check for flattened columns
        expected_cols = [
            'id', 'flight_date', 
            'departure_airport', 'departure_timezone', 
            'departure_details_terminal', 'departure_details_gate',
            'tags'
        ]
        for col in expected_cols:
            assert col in row, f"Missing expected column: {col}"
            
        print("\nFlattening Check Passed!")
        print(f"Departure Airport: {row['departure_airport']}")
        print(f"Terminal: {row['departure_details_terminal']}")
        
        # Check that tags (list) remained a string
        assert isinstance(row['tags'], str)
        print(f"Tags (serialized): {row['tags']}")
            
        print("\nVerification successful: Data is correctly flattened and serialized.")
    except Exception as e:
        print(f"\nVerification failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        # Cleanup
        if os.path.exists("test_flatten.db"):
            try:
                os.remove("test_flatten.db")
            except:
                pass

if __name__ == "__main__":
    test_flattening_load()
