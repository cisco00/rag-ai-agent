import sqlite3
import os

class DatabaseManager:
    def __init__(self, db_path="identifier.sqlite.db", initialize=True):
        self.db_path = db_path
        self.conn = None
        self._connect()
        if initialize:
            self._initialize_db()

    def _connect(self):
        """Establish a connection to the database."""
        self.conn = sqlite3.connect(self.db_path)

    def _initialize_db(self):
        """Create tables and seed initial data if they don't exist."""
        cursor = self.conn.cursor()
        
        # Enable foreign keys
        cursor.execute("PRAGMA foreign_keys = ON;")

        # Create Tables
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS products (
            product_id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_name VARCHAR(255) NOT NULL,
            price DECIMAL(10, 2) NOT NULL
        );
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS staff (
            staff_id INTEGER PRIMARY KEY AUTOINCREMENT,
            first_name VARCHAR(255) NOT NULL,
            last_name VARCHAR(255) NOT NULL
        );
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS orders (
            order_id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_name VARCHAR(255) NOT NULL,
            staff_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            FOREIGN KEY (staff_id) REFERENCES staff (staff_id),
            FOREIGN KEY (product_id) REFERENCES products (product_id)
        );
        """)

        # Check if data exists to avoid duplicate seeding on restart
        cursor.execute("SELECT count(*) FROM products")
        if cursor.fetchone()[0] == 0:
            self._seed_data(cursor)

        self.conn.commit()

    def _seed_data(self, cursor):
        """Seed initial data."""
        cursor.execute("""
        INSERT INTO products (product_name, price) VALUES
        ('Laptop', 799.99),
        ('Keyboard', 129.99),
        ('Mouse', 29.99);
        """)

        cursor.execute("""
        INSERT INTO staff (first_name, last_name) VALUES
        ('Alice', 'Smith'),
        ('Bob', 'Johnson'),
        ('Charlie', 'Williams');
        """)

        cursor.execute("""
        INSERT INTO orders (customer_name, staff_id, product_id) VALUES
        ('David Lee', 1, 1),
        ('Emily Chen', 2, 2),
        ('Frank Brown', 1, 3);
        """)
        print("Database seeded with initial data.")

    def execute_query(self, sql: str) -> list[tuple]:
        """Execute an SQL statement, returning the results."""
        print(f' - DB CALL: execute_query({sql})')
        cursor = self.conn.cursor()
        try:
            cursor.execute(sql)
            if sql.strip().upper().startswith("SELECT") or sql.strip().upper().startswith("PRAGMA"):
                return cursor.fetchall()
            else:
                self.conn.commit()
                return [{"status": "success", "rows_affected": cursor.rowcount}]
        except sqlite3.Error as e:
            return [{"error": str(e)}]

    def describe_table(self, table_name: str) -> list[tuple[str, str]]:
        """Look up the table schema."""
        print(f' - DB CALL: describe_table({table_name})')
        cursor = self.conn.cursor()
        cursor.execute(f"PRAGMA table_info({table_name});")
        schema = cursor.fetchall()
        # [column index, column name, column type, ...]
        return [(col[1], col[2]) for col in schema]

    def list_tables(self) -> list[str]:
        """List all tables in the database."""
        cursor = self.conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tables = cursor.fetchall()
        return [t[0] for t in tables]

    def close(self):
        if self.conn:
            self.conn.close()
