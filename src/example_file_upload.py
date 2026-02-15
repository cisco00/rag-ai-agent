"""
Example usage of the file_uploader module.

This script demonstrates how to upload Excel and CSV files to a database.
"""

import os
import sys
from dotenv import load_dotenv

# Add the current directory to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from database import DatabaseManager
from file_uploader import FileUploader, upload_file_to_database


def example_1_standalone_function():
    """
    Example 1: Using the standalone function to upload a CSV file.
    """
    print("\n=== Example 1: Upload CSV using standalone function ===")
    
    # Simple one-liner to upload a file
    result = upload_file_to_database(
        file_path='data/sales.csv',
        table_name='sales_data'
    )
    
    if result['success']:
        print(f"✓ Successfully imported {result['rows_imported']} rows into table '{result['table_name']}'")
        print(f"  Columns: {', '.join(result['column_names'])}")
    else:
        print(f"✗ Error: {result['error']}")


def example_2_excel_file():
    """
    Example 2: Upload an Excel file with a specific sheet.
    """
    print("\n=== Example 2: Upload Excel file (specific sheet) ===")
    
    db = DatabaseManager("sqlite:///identifier.sqlite.db")
    uploader = FileUploader(db)
    
    result = uploader.upload_file_to_db(
        file_path='data/financial_report.xlsx',
        table_name='q1_financials',
        sheet_name='Q1 2024',  # Specify which sheet to import
        if_exists='replace'
    )
    
    if result['success']:
        print(f"✓ Table '{result['table_name']}' created with {result['rows_imported']} rows")
        print(f"  Columns ({result['columns']}): {', '.join(result['column_names'])}")
    else:
        print(f"✗ Error: {result['error']}")
    
    db.close()


def example_3_multiple_sheets():
    """
    Example 3: Upload all sheets from an Excel file to separate tables.
    """
    print("\n=== Example 3: Upload all sheets from Excel file ===")
    
    db = DatabaseManager("sqlite:///identifier.sqlite.db")
    uploader = FileUploader(db)
    
    result = uploader.upload_multiple_sheets(
        excel_file_path='data/annual_report.xlsx',
        table_prefix='annual_2024'
    )
    
    if result['success']:
        print(f"✓ Processed {result['sheets_processed']}/{result['total_sheets']} sheets")
        for table_info in result['tables']:
            if table_info['result']['success']:
                print(f"  • {table_info['sheet_name']} → {table_info['table_name']} "
                      f"({table_info['result']['rows_imported']} rows)")
            else:
                print(f"  ✗ {table_info['sheet_name']}: {table_info['result']['error']}")
    else:
        print(f"✗ Error: {result['error']}")
    
    db.close()


def example_4_with_analytics_agent():
    """
    Example 4: Upload a file and then query it with the AnalyticsAgent.
    """
    print("\n=== Example 4: Upload and query with AnalyticsAgent ===")
    
    load_dotenv()
    hf_token = os.environ.get("HF_TOKEN")
    
    if not hf_token:
        print("✗ HF_TOKEN not found in environment")
        return
    
    # First, upload the data
    db = DatabaseManager("sqlite:///identifier.sqlite.db")
    uploader = FileUploader(db)
    
    result = uploader.upload_file_to_db(
        file_path='data/customer_data.csv',
        table_name='customers'
    )
    
    if result['success']:
        print(f"✓ Uploaded {result['rows_imported']} rows to '{result['table_name']}'")
        
        # Now query it with the analytics agent
        from main import AnalyticsAgent
        
        agent = AnalyticsAgent(hf_token)
        
        # Ask questions about the uploaded data
        response = agent.run_query("What are the top 5 customers by total purchases?")
        print(f"\nAgent Response:\n{response['text']}")
        
        agent.close()
    else:
        print(f"✗ Upload failed: {result['error']}")
    
    db.close()


def example_5_append_mode():
    """
    Example 5: Append data to an existing table.
    """
    print("\n=== Example 5: Append data to existing table ===")
    
    db = DatabaseManager("sqlite:///identifier.sqlite.db")
    uploader = FileUploader(db)
    
    # First upload
    result1 = uploader.upload_file_to_db(
        file_path='data/january_sales.csv',
        table_name='monthly_sales',
        if_exists='replace'
    )
    
    if result1['success']:
        print(f"✓ Initial upload: {result1['rows_imported']} rows")
    
    # Append more data
    result2 = uploader.upload_file_to_db(
        file_path='data/february_sales.csv',
        table_name='monthly_sales',
        if_exists='append'  # Append instead of replace
    )
    
    if result2['success']:
        print(f"✓ Appended: {result2['rows_imported']} more rows")
        
        # Check total rows
        total = db.execute_query("SELECT COUNT(*) as total FROM monthly_sales")
        print(f"  Total rows in table: {total[0]['total']}")
    
    db.close()


def create_sample_csv():
    """
    Helper function to create a sample CSV file for testing.
    """
    import pandas as pd
    
    # Create sample data
    data = {
        'Product': ['Laptop', 'Mouse', 'Keyboard', 'Monitor', 'Headphones'],
        'Price': [999.99, 29.99, 79.99, 299.99, 149.99],
        'Quantity': [50, 200, 150, 75, 100],
        'Category': ['Electronics', 'Accessories', 'Accessories', 'Electronics', 'Accessories']
    }
    
    df = pd.DataFrame(data)
    
    # Create data directory if it doesn't exist
    os.makedirs('data', exist_ok=True)
    
    # Save to CSV
    df.to_csv('data/sample_products.csv', index=False)
    print("✓ Created sample CSV file: data/sample_products.csv")
    
    return 'data/sample_products.csv'


def main():
    """
    Run all examples.
    """
    print("=" * 60)
    print("File Uploader Examples")
    print("=" * 60)
    
    # Create a sample file for testing
    sample_file = create_sample_csv()
    
    # Example: Upload the sample file
    print("\n=== Uploading Sample File ===")
    result = upload_file_to_database(
        file_path=sample_file,
        table_name='products'
    )
    
    if result['success']:
        print(f"\n✓ SUCCESS!")
        print(f"  Table Name: {result['table_name']}")
        print(f"  Rows Imported: {result['rows_imported']}")
        print(f"  Columns: {result['columns']}")
        print(f"  Column Names: {', '.join(result['column_names'])}")
        print(f"\n  Column Types:")
        for col_name, col_type in result['column_types']:
            print(f"    - {col_name}: {col_type}")
        
        # Verify the data
        print("\n=== Verifying Data ===")
        db = DatabaseManager("sqlite:///identifier.sqlite.db")
        
        # List all tables
        tables = db.list_tables()
        print(f"  Available tables: {', '.join(tables)}")
        
        # Query the data
        data = db.execute_query("SELECT * FROM products LIMIT 5")
        print(f"\n  Sample data from 'products' table:")
        for row in data:
            print(f"    {row}")
        
        db.close()
    else:
        print(f"\n✗ FAILED: {result['error']}")
    
    # Uncomment to run other examples:
    # example_2_excel_file()
    # example_3_multiple_sheets()
    # example_4_with_analytics_agent()
    # example_5_append_mode()


if __name__ == "__main__":
    main()
