"""
File upload module for the RAG AI Agent.

This module provides robust file upload functionality with comprehensive validation,
error handling, and progress tracking for CSV and Excel files.
"""

import pandas as pd
import os
from pathlib import Path
from typing import Union, Optional, Dict, Any, Callable
from contextlib import contextmanager

from database import DatabaseManager
from exceptions import (
    FileUploadError,
    FileValidationError,
    EmptyFileError,
    InvalidDataFrameError
)
from logging_config import get_logger
from config import get_file_upload_config
from validators import FileValidator, DataFrameValidator, TableNameValidator

# Initialize logger
logger = get_logger(__name__)


class FileUploader:
    """
    Handles uploading Excel or CSV files and creating/populating database tables.
    
    Features:
    - Comprehensive file validation
    - Automatic column name cleaning
    - Progress tracking for large files
    - Detailed error messages
    - Support for single and multiple file uploads
    """
    
    def __init__(
        self,
        db_manager: DatabaseManager,
        file_validator: Optional[FileValidator] = None,
        df_validator: Optional[DataFrameValidator] = None
    ):
        """
        Initialize the FileUploader with a DatabaseManager instance.
        
        Args:
            db_manager: An instance of DatabaseManager to handle database operations
            file_validator: Optional custom file validator
            df_validator: Optional custom DataFrame validator
        """
        self.db = db_manager
        self.file_validator = file_validator or FileValidator()
        self.df_validator = df_validator or DataFrameValidator()
        
        logger.info("FileUploader initialized")
    
    def upload_file_to_db(
        self,
        file_path: str,
        table_name: Optional[str] = None,
        if_exists: str = 'replace',
        sheet_name: Union[str, int] = 0,
        cleaning_options: Optional[Dict[str, str]] = None,
        progress_callback: Optional[Callable[[str, int], None]] = None
    ) -> Dict[str, Any]:
        """
        Upload an Excel or CSV file to the database.
        
        This function:
        1. Validates the file (existence, size, type)
        2. Reads the file (Excel or CSV)
        3. Validates the DataFrame
        4. Cleans column names
        5. Creates a table in the database with appropriate schema
        6. Populates the table with data from the file
        
        Args:
            file_path: Path to the Excel (.xlsx, .xls) or CSV (.csv) file
            table_name: Name for the database table. If None, uses the filename without extension
            if_exists: What to do if table exists: 'fail', 'replace', or 'append'
            sheet_name: For Excel files, which sheet to read (default: 0 - first sheet)
            progress_callback: Optional callback function(message, progress_percent)
        
        Returns:
            dict: Status information including success/failure, table name, rows imported, etc.
        """
        logger.info(
            f"Starting file upload",
            extra={
                "file_path": file_path,
                "table_name": table_name,
                "if_exists": if_exists
            }
        )
        
        try:
            # Step 1: Validate file
            self._report_progress(progress_callback, "Validating file", 10)
            self._validate_file(file_path)
            
            # Step 2: Read file
            self._report_progress(progress_callback, "Reading file", 30)
            df = self._read_file(file_path, sheet_name)
            
            # Step 3: Validate DataFrame
            self._report_progress(progress_callback, "Validating data", 50)
            self._validate_dataframe(df, file_path)
            
            # Step 3.5: Apply cleaning strategies if provided
            if cleaning_options:
                self._report_progress(progress_callback, "Cleaning data", 55)
                df = self._clean_data(df, cleaning_options)
            
            # Step 4: Generate and validate table name
            self._report_progress(progress_callback, "Preparing table", 60)
            table_name = self._generate_table_name(file_path, table_name)
            TableNameValidator.validate(table_name)
            
            # Step 5: Clean column names
            df.columns = [self._clean_column_name(col) for col in df.columns]
            
            # Step 6: Load into database
            self._report_progress(progress_callback, "Loading to database", 80)
            success = self.db.load_dataframe(df, table_name, if_exists=if_exists)
            
            if not success:
                raise FileUploadError("Failed to load data into database")
            
            # Step 7: Get column information
            self._report_progress(progress_callback, "Finalizing", 95)
            columns = self.db.describe_table(table_name)
            
            self._report_progress(progress_callback, "Complete", 100)
            
            result = {
                "success": True,
                "table_name": table_name,
                "rows_imported": len(df),
                "columns": len(df.columns),
                "column_names": list(df.columns),
                "column_types": columns,
                "action": if_exists
            }
            
            logger.info(
                f"File uploaded successfully",
                extra={
                    "table": table_name,
                    "rows": len(df),
                    "columns": len(df.columns)
                }
            )
            
            return result
        
        except (FileValidationError, InvalidDataFrameError) as e:
            # These are expected validation errors
            logger.warning(f"File validation failed: {e}")
            return {
                "success": False,
                "error": str(e)
            }
        
        except Exception as e:
            # Unexpected errors
            logger.error(f"Error processing file: {e}", exc_info=True)
            return {
                "success": False,
                "error": f"Error processing file: {str(e)}"
            }
    
    def upload_multiple_sheets(
        self,
        excel_file_path: str,
        table_prefix: Optional[str] = None,
        if_exists: str = 'replace',
        progress_callback: Optional[Callable[[str, int], None]] = None
    ) -> Dict[str, Any]:
        """
        Upload all sheets from an Excel file to separate database tables.
        
        Args:
            excel_file_path: Path to the Excel file
            table_prefix: Prefix for table names. If None, uses filename
            if_exists: What to do if table exists: 'fail', 'replace', or 'append'
            progress_callback: Optional callback function(message, progress_percent)
        
        Returns:
            dict: Status information for each sheet/table
        """
        logger.info(
            f"Starting multi-sheet upload",
            extra={"file_path": excel_file_path, "table_prefix": table_prefix}
        )
        
        try:
            # Validate file
            self._report_progress(progress_callback, "Validating Excel file", 5)
            self._validate_file(excel_file_path)
            
            file_extension = Path(excel_file_path).suffix.lower()
            if file_extension not in ['.xlsx', '.xls']:
                return {
                    "success": False,
                    "error": "This function only works with Excel files (.xlsx, .xls)"
                }
            
            # Read all sheet names
            self._report_progress(progress_callback, "Reading sheet names", 10)
            excel_file = pd.ExcelFile(excel_file_path)
            sheet_names = excel_file.sheet_names
            
            logger.info(f"Found {len(sheet_names)} sheets in Excel file")
            
            # Generate prefix if not provided
            if table_prefix is None:
                table_prefix = Path(excel_file_path).stem.lower().replace(' ', '_').replace('-', '_')
            
            results = {
                "success": True,
                "sheets_processed": 0,
                "total_sheets": len(sheet_names),
                "tables": []
            }
            
            # Process each sheet
            for idx, sheet_name in enumerate(sheet_names):
                progress = 10 + int((idx / len(sheet_names)) * 85)
                self._report_progress(
                    progress_callback,
                    f"Processing sheet: {sheet_name}",
                    progress
                )
                
                table_name = f"{table_prefix}_{sheet_name.lower().replace(' ', '_').replace('-', '_')}"
                
                result = self.upload_file_to_db(
                    excel_file_path,
                    table_name=table_name,
                    if_exists=if_exists,
                    sheet_name=sheet_name
                )
                
                if result["success"]:
                    results["sheets_processed"] += 1
                
                results["tables"].append({
                    "sheet_name": sheet_name,
                    "table_name": table_name,
                    "result": result
                })
            
            self._report_progress(progress_callback, "All sheets processed", 100)
            
            logger.info(
                f"Multi-sheet upload complete",
                extra={
                    "total_sheets": len(sheet_names),
                    "successful": results["sheets_processed"]
                }
            )
            
            return results
        
        except Exception as e:
            logger.error(f"Error processing Excel file: {e}", exc_info=True)
            return {
                "success": False,
                "error": f"Error processing Excel file: {str(e)}"
            }
    
    def _validate_file(self, file_path: str) -> None:
        """
        Validate file using FileValidator.
        
        Args:
            file_path: Path to the file
        
        Raises:
            FileValidationError: If validation fails
        """
        self.file_validator.validate_all(file_path)
    
    def _validate_dataframe(self, df: pd.DataFrame, file_path: str = None) -> None:
        """
        Validate DataFrame using DataFrameValidator.
        
        Args:
            df: DataFrame to validate
            file_path: Optional file path for error messages
        
        Raises:
            InvalidDataFrameError: If validation fails
        """
        self.df_validator.validate_all(df)
    
    def _read_file(self, file_path: str, sheet_name: Union[str, int] = 0) -> pd.DataFrame:
        """
        Read file into a pandas DataFrame.
        
        Args:
            file_path: Path to the file
            sheet_name: For Excel files, which sheet to read
        
        Returns:
            pandas DataFrame
        
        Raises:
            FileUploadError: If file reading fails
        """
        file_extension = Path(file_path).suffix.lower()
        
        try:
            if file_extension in ['.xlsx', '.xls']:
                logger.debug(f"Reading Excel file: {file_path}, sheet: {sheet_name}")
                df = pd.read_excel(file_path, sheet_name=sheet_name)
            elif file_extension == '.csv':
                logger.debug(f"Reading CSV file: {file_path}")
                df = pd.read_csv(file_path)
            else:
                # This should have been caught by validation, but just in case
                raise FileUploadError(
                    f"Unsupported file type: {file_extension}. "
                    f"Only .xlsx, .xls, and .csv are supported."
                )
            
            logger.debug(f"File read successfully: {len(df)} rows, {len(df.columns)} columns")
            return df
        
        except pd.errors.EmptyDataError:
            raise EmptyFileError(file_path)
        except Exception as e:
            raise FileUploadError(f"Error reading file: {str(e)}") from e
    
    def _generate_table_name(self, file_path: str, table_name: Optional[str]) -> str:
        """
        Generate table name from file path if not provided.
        
        Args:
            file_path: Path to the file
            table_name: Optional table name
        
        Returns:
            Table name
        """
        if table_name is None:
            table_name = Path(file_path).stem.lower().replace(' ', '_').replace('-', '_')
        
        return table_name
    
    def _clean_column_name(self, col_name: str) -> str:
        """
        Clean column names to be database-friendly.
        
        Args:
            col_name: Original column name
        
        Returns:
            str: Cleaned column name
        """
        # Convert to string if not already
        col_name = str(col_name)
        
        # Replace spaces and special characters with underscores
        cleaned = col_name.strip().lower()
        cleaned = cleaned.replace(' ', '_').replace('-', '_').replace('.', '_')
        
        # Remove any characters that aren't alphanumeric or underscore
        cleaned = ''.join(c if c.isalnum() or c == '_' else '_' for c in cleaned)
        
        # Remove consecutive underscores
        while '__' in cleaned:
            cleaned = cleaned.replace('__', '_')
        
        # Remove leading/trailing underscores
        cleaned = cleaned.strip('_')
        
        # Ensure it doesn't start with a number
        if cleaned and cleaned[0].isdigit():
            cleaned = 'col_' + cleaned
        
        # Handle empty column names
        if not cleaned:
            cleaned = 'unnamed_column'
        
        return cleaned
    
    def _clean_data(self, df: pd.DataFrame, options: Dict[str, str]) -> pd.DataFrame:
        """
        Apply cleaning strategies to the DataFrame.
        
        Args:
            df: DataFrame to clean
            options: Dictionary mapping column names to strategies
                     Strategies: 'drop_rows', 'fill_mean', 'fill_mode', 'fill_zero', 'fill_unknown'
        
        Returns:
            Cleaned DataFrame
        """
        if not options:
            return df
            
        logger.info(f"Applying cleaning strategies: {options}")
        
        # First handle 'drop_rows'
        cols_to_drop_rows = [col for col, strategy in options.items() if strategy == 'drop_rows']
        if cols_to_drop_rows:
            # Drop rows where ANY of these columns have nulls
            initial_len = len(df)
            df = df.dropna(subset=cols_to_drop_rows)
            dropped = initial_len - len(df)
            if dropped > 0:
                logger.info(f"Dropped {dropped} rows due to nulls in {cols_to_drop_rows}")
        
        # Handle fills
        for col, strategy in options.items():
            if col not in df.columns:
                continue
                
            if strategy == 'drop_rows':
                continue # Already handled
            
            null_count = df[col].isnull().sum()
            if null_count == 0:
                continue
                
            if strategy == 'fill_mean':
                if pd.api.types.is_numeric_dtype(df[col]):
                    mean_val = df[col].mean()
                    df[col] = df[col].fillna(mean_val)
                    logger.info(f"Filled {null_count} nulls in {col} with mean ({mean_val})")
            
            elif strategy == 'fill_mode':
                if not df[col].mode().empty:
                    mode_val = df[col].mode()[0]
                    df[col] = df[col].fillna(mode_val)
                    logger.info(f"Filled {null_count} nulls in {col} with mode ({mode_val})")
            
            elif strategy == 'fill_zero':
                if pd.api.types.is_numeric_dtype(df[col]):
                    df[col] = df[col].fillna(0)
                    logger.info(f"Filled {null_count} nulls in {col} with 0")
            
            elif strategy == 'fill_unknown':
                df[col] = df[col].fillna('Unknown')
                logger.info(f"Filled {null_count} nulls in {col} with 'Unknown'")
                
        return df

    def _report_progress(
        self,
        callback: Optional[Callable[[str, int], None]],
        message: str,
        progress: int
    ) -> None:
        """
        Report progress to callback if provided.
        
        Args:
            callback: Progress callback function
            message: Progress message
            progress: Progress percentage (0-100)
        """
        if callback:
            try:
                callback(message, progress)
            except Exception as e:
                logger.warning(f"Progress callback failed: {e}")


def upload_file_to_database(
    file_path: str,
    connection_string: str = "sqlite:///identifier.sqlite.db",
    table_name: Optional[str] = None,
    if_exists: str = 'replace',
    sheet_name: Union[str, int] = 0,
    progress_callback: Optional[Callable[[str, int], None]] = None
) -> Dict[str, Any]:
    """
    Standalone function to upload a file to database.
    
    This is a convenience function that creates a DatabaseManager and FileUploader
    internally and uploads the file.
    
    Args:
        file_path: Path to the Excel or CSV file
        connection_string: Database connection string
        table_name: Name for the database table (optional)
        if_exists: What to do if table exists: 'fail', 'replace', or 'append'
        sheet_name: For Excel files, which sheet to read
        progress_callback: Optional callback function(message, progress_percent)
    
    Returns:
        dict: Status information
    
    Example:
        >>> result = upload_file_to_database('sales_data.xlsx', table_name='sales')
        >>> print(result)
        {
            'success': True,
            'table_name': 'sales',
            'rows_imported': 1000,
            'columns': 5,
            'column_names': ['date', 'product', 'quantity', 'price', 'total']
        }
    """
    logger.info(f"Standalone upload: {file_path} -> {table_name or 'auto'}")
    
    with DatabaseManager(connection_string) as db:
        uploader = FileUploader(db)
        result = uploader.upload_file_to_db(
            file_path,
            table_name,
            if_exists,
            sheet_name,
            progress_callback
        )
    
    return result