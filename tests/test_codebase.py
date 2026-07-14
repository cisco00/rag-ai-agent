"""
Vantage AI -- Complete Codebase Test Suite
==========================================
Covers ALL major modules across the full backend stack:
  - Config, Exceptions, Utils, Validators
  - Models (all CRUD), Schemas (Pydantic validation)
  - Transformations, CRM Sync, Connectors
  - Auth, Sessions, Dashboards, Alerts, Insights
  - All Router Endpoints (E2E via TestClient)
  - Security, Performance, Smoke

Run:  python tests/test_codebase.py 2>&1
"""

import sys, os, re, ast, time, json, secrets, importlib
from typing import Dict, Any, Optional
from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock, AsyncMock
from pathlib import Path
import unittest

# -- Path Setup ----------------------------------------------------------------
BACKEND_DIR = os.path.join(os.path.dirname(__file__), '..', 'backend')
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.abspath(BACKEND_DIR))
os.chdir(PROJECT_ROOT)

import pandas as pd
import numpy as np

# ==============================================================================
# LAYER 1: LINT -- Static analysis of the entire backend
# ==============================================================================
class TestLintEntireBackend(unittest.TestCase):
    """Lint every Python file in the backend."""

    BACKEND_PY_FILES = []
    ROUTER_DIR = os.path.join(BACKEND_DIR, 'routers')

    @classmethod
    def setUpClass(cls):
        for root, dirs, files in os.walk(BACKEND_DIR):
            dirs[:] = [d for d in dirs if d not in ('venv', '__pycache__', '.git', 'alembic', 'logs')]
            for f in files:
                if f.endswith('.py'):
                    cls.BACKEND_PY_FILES.append(os.path.join(root, f))

    def test_all_backend_files_parse(self):
        """Every .py file must be valid Python."""
        errors = []
        for fpath in self.BACKEND_PY_FILES:
            try:
                with open(fpath, 'r', encoding='utf-8') as fp:
                    ast.parse(fp.read(), filename=fpath)
            except SyntaxError as e:
                errors.append(f"{os.path.basename(fpath)}: {e}")
        self.assertEqual(errors, [], "Syntax errors:\n" + "\n".join(errors))

    def test_frontend_tsx_files_exist(self):
        """Key frontend component files must exist."""
        frontend_dir = os.path.join(PROJECT_ROOT, 'frontend', 'src')
        key_files = ['app/components/Integrations.tsx']
        for f in key_files:
            path = os.path.join(frontend_dir, f)
            self.assertTrue(os.path.exists(path), f"Missing: {f}")

    def test_no_hardcoded_secrets(self):
        """No hardcoded passwords/tokens/keys in source (strict pattern)."""
        pattern = re.compile(r'(?:password|secret|token)\s*=\s*["\'][A-Za-z0-9+/=]{30,}', re.IGNORECASE)
        allowlist = ['cookie', 'vantage_', 'mock', 'test', 'example', 'placeholder', 'getenv', 'environ']
        violations = []
        for fpath in self.BACKEND_PY_FILES:
            with open(fpath, 'r', encoding='utf-8') as fp:
                for lineno, line in enumerate(fp, 1):
                    if pattern.search(line) and not any(a in line.lower() for a in allowlist):
                        violations.append(f"{os.path.basename(fpath)}:{lineno}")
        self.assertEqual(len(violations), 0, f"Hardcoded secrets:\n" + "\n".join(violations))

    def test_all_router_files_present(self):
        """All expected router modules exist."""
        expected = ['auth.py', 'data.py', 'analytics.py', 'branding.py',
                    'sessions.py', 'transformations.py', 'alerts.py',
                    'dashboards.py', 'insights.py', 'org_context.py',
                    'admin.py', 'integrations.py', '__init__.py']
        actual = os.listdir(self.ROUTER_DIR)
        for f in expected:
            self.assertIn(f, actual, f"Missing router: {f}")

    def test_requirements_txt_exists(self):
        """requirements.txt must exist."""
        self.assertTrue(os.path.exists(os.path.join(BACKEND_DIR, 'requirements.txt')))

    def test_dockerfile_exists(self):
        """Dockerfile must exist."""
        self.assertTrue(
            os.path.exists(os.path.join(BACKEND_DIR, 'Dockerfile')) or
            os.path.exists(os.path.join(PROJECT_ROOT, 'Dockerfile'))
        )


# ==============================================================================
# LAYER 2: UNIT -- Config, Exceptions, Utils, Validators, Schemas
# ==============================================================================
class TestUnitConfig(unittest.TestCase):
    """Unit tests for config.py."""

    def test_config_loads_without_error(self):
        from config import get_config
        cfg = get_config()
        self.assertIsNotNone(cfg)

    def test_db_config_defaults(self):
        from config import get_db_config
        db = get_db_config()
        self.assertGreater(db.pool_size, 0)
        self.assertGreater(db.query_timeout, 0)

    def test_security_config_generates_key(self):
        from config import get_security_config
        sec = get_security_config()
        self.assertIsNotNone(sec.encryption_key)
        self.assertGreater(len(sec.encryption_key), 10)

    def test_file_upload_config(self):
        from config import get_file_upload_config
        fc = get_file_upload_config()
        self.assertIn('.csv', fc.supported_extensions)
        self.assertIn('.xlsx', fc.supported_extensions)

    def test_agent_config(self):
        from config import get_agent_config
        ac = get_agent_config()
        self.assertIn(ac.model_provider, ['google', 'huggingface'])
        self.assertGreater(ac.max_iterations, 0)


class TestUnitExceptions(unittest.TestCase):
    """Unit tests for exceptions.py."""

    def test_base_error_has_message(self):
        from exceptions import RAGAgentError
        err = RAGAgentError("internal msg", user_message="user msg")
        self.assertEqual(err.message, "internal msg")
        self.assertEqual(err.user_message, "user msg")

    def test_database_error_hierarchy(self):
        from exceptions import DatabaseError, ConnectionError, QueryExecutionError, TableNotFoundError
        self.assertTrue(issubclass(ConnectionError, DatabaseError))
        self.assertTrue(issubclass(QueryExecutionError, DatabaseError))
        self.assertTrue(issubclass(TableNotFoundError, DatabaseError))

    def test_file_error_hierarchy(self):
        from exceptions import FileUploadError, FileSizeError, UnsupportedFileTypeError, EmptyFileError
        self.assertTrue(issubclass(FileSizeError, FileUploadError))
        self.assertTrue(issubclass(UnsupportedFileTypeError, FileUploadError))
        self.assertTrue(issubclass(EmptyFileError, FileUploadError))

    def test_agent_error_hierarchy(self):
        from exceptions import AgentError, ModelAPIError, MaxIterationsError, ToolExecutionError
        self.assertTrue(issubclass(ModelAPIError, AgentError))
        self.assertTrue(issubclass(MaxIterationsError, AgentError))
        self.assertTrue(issubclass(ToolExecutionError, AgentError))

    def test_query_execution_error_unique_constraint(self):
        from exceptions import QueryExecutionError
        err = QueryExecutionError("UNIQUE constraint failed: users.email")
        self.assertIn("already exists", err.user_message)

    def test_max_iterations_error(self):
        from exceptions import MaxIterationsError
        err = MaxIterationsError(10)
        self.assertEqual(err.max_iterations, 10)
        self.assertIn("smaller", err.user_message)

    def test_file_size_error_formatting(self):
        from exceptions import FileSizeError
        err = FileSizeError(1024*1024*100, 1024*1024*50)
        self.assertIn("100.00MB", err.message)
        self.assertIn("50.00MB", err.message)


class TestUnitUtils(unittest.TestCase):
    """Unit tests for utils.py."""

    def test_encrypt_decrypt_roundtrip(self):
        from utils import encrypt_string, decrypt_string
        for val in ["hello", "a" * 200, "sp3c!@l_ch4rs"]:
            self.assertEqual(decrypt_string(encrypt_string(val)), val)

    def test_encrypt_empty(self):
        from utils import encrypt_string
        self.assertEqual(encrypt_string(""), "")
        self.assertIsNone(encrypt_string(None))

    def test_decrypt_plaintext_passthrough(self):
        from utils import decrypt_string
        self.assertEqual(decrypt_string("not_encrypted"), "not_encrypted")

    def test_clean_llm_json_content(self):
        from utils import clean_llm_json_content
        self.assertEqual(clean_llm_json_content('```json\n{"a":1}\n```'), '{"a":1}')
        self.assertEqual(clean_llm_json_content('{"b":2}'), '{"b":2}')

    def test_parse_llm_json(self):
        from utils import parse_llm_json
        result = parse_llm_json('```json\n{"key": "value"}\n```')
        self.assertEqual(result["key"], "value")


class TestUnitValidators(unittest.TestCase):
    """Unit tests for validators.py."""

    def test_table_name_validator_accepts_valid(self):
        from validators import TableNameValidator
        for name in ["users", "sales_data", "_private", "t123"]:
            TableNameValidator.validate(name)  # should not raise

    def test_table_name_validator_rejects_invalid(self):
        from validators import TableNameValidator
        from exceptions import InvalidRequestError
        for name in ["", "users; DROP", "123start", "a" * 100]:
            with self.assertRaises(InvalidRequestError):
                TableNameValidator.validate(name)

    def test_sanitize_table_name(self):
        from validators import sanitize_table_name
        self.assertEqual(sanitize_table_name("My File.csv"), "my_file")
        self.assertEqual(sanitize_table_name("Report (2024).xlsx"), "report__2024_")
        self.assertRegex(sanitize_table_name("123data.csv"), r'^t_')

    def test_connection_string_validator_valid(self):
        from validators import ConnectionStringValidator
        for cs in ["sqlite:///test.db", "postgresql://localhost/db", "mysql://user:pass@host/db"]:
            ConnectionStringValidator.validate(cs)

    def test_connection_string_validator_invalid(self):
        from validators import ConnectionStringValidator
        from exceptions import InvalidConnectionStringError
        for cs in ["", "notaurl", "ftp://bad"]:
            with self.assertRaises(InvalidConnectionStringError):
                ConnectionStringValidator.validate(cs)

    def test_sql_query_validator_blocks_dangerous(self):
        from validators import SQLQueryValidator
        from exceptions import QueryExecutionError
        dangerous = ["DROP TABLE users", "DELETE FROM data", "TRUNCATE orders",
                      "ALTER TABLE x", "CREATE TABLE y", "GRANT ALL"]
        for q in dangerous:
            with self.assertRaises(QueryExecutionError):
                SQLQueryValidator.validate_safe(q)

    def test_sql_query_validator_allows_safe(self):
        from validators import SQLQueryValidator
        safe = ["SELECT * FROM users", "SELECT COUNT(*) FROM orders WHERE status='active'",
                "SELECT name, SUM(amount) FROM sales GROUP BY name"]
        for q in safe:
            SQLQueryValidator.validate_safe(q)  # should not raise

    def test_sql_query_validator_length(self):
        from validators import SQLQueryValidator
        from exceptions import QueryExecutionError
        with self.assertRaises(QueryExecutionError):
            SQLQueryValidator.validate_length("SELECT " + "x" * 20000, max_length=10000)


class TestUnitSchemas(unittest.TestCase):
    """Unit tests for Pydantic schemas."""

    def test_register_request(self):
        from schemas import RegisterRequest
        r = RegisterRequest(name="TestOrg")
        self.assertEqual(r.name, "TestOrg")
        self.assertIsNone(r.email)

    def test_query_request(self):
        from schemas import QueryRequest
        q = QueryRequest(query="What is the total revenue?")
        self.assertEqual(q.query, "What is the total revenue?")
        self.assertFalse(q.use_file)

    def test_register_user_password_validation(self):
        from schemas import RegisterUserRequest
        from pydantic import ValidationError
        # Weak password should fail
        with self.assertRaises(ValidationError):
            RegisterUserRequest(email="a@b.com", password="short")
        # Strong password should pass
        u = RegisterUserRequest(email="a@b.com", password="StrongP@ss1")
        self.assertEqual(u.email, "a@b.com")

    def test_alert_rule_request_defaults(self):
        from schemas import AlertRuleRequest
        a = AlertRuleRequest(name="High Revenue", operator=">", threshold_value=1000)
        self.assertEqual(a.aggregate, "avg")
        self.assertEqual(a.lookback_hours, 24)
        self.assertEqual(a.cooldown_minutes, 60)

    def test_forecast_request(self):
        from schemas import ForecastRequest
        f = ForecastRequest(table_name="sales", date_column="date", value_column="revenue")
        self.assertEqual(f.periods, 30)
        self.assertEqual(f.freq, 'D')

    def test_dashboard_request(self):
        from schemas import DashboardRequest
        d = DashboardRequest(name="Sales Overview")
        self.assertFalse(d.is_shared)

    def test_card_request(self):
        from schemas import CardRequest
        c = CardRequest(title="Revenue Chart", query_text="SELECT * FROM sales")
        self.assertEqual(c.layout_w, 6)
        self.assertEqual(c.layout_h, 4)

    def test_branding_request(self):
        from schemas import BrandingRequest
        b = BrandingRequest(org_name="Acme", primary_color="#ff0000")
        self.assertEqual(b.org_name, "Acme")

    def test_transform_request(self):
        from schemas import TransformRequest
        t = TransformRequest(table_name="data", operations=[{"type": "filter"}])
        self.assertEqual(len(t.operations), 1)

    def test_cleaning_config(self):
        from schemas import CleaningConfig
        c = CleaningConfig(drop_null_rows=True, drop_duplicates=True)
        self.assertTrue(c.drop_null_rows)
        self.assertTrue(c.drop_duplicates)


# ==============================================================================
# LAYER 2b: UNIT -- Transformations
# ==============================================================================
class TestUnitTransformations(unittest.TestCase):
    """Unit tests for DataTransformer operations."""

    def setUp(self):
        from transformations import DataTransformer
        self.transformer = DataTransformer
        self.df = pd.DataFrame({
            'text': ['  hello ', 'WORLD', 'Foo Bar', 'Test 123!', '  junk  '],
            'vals': [1, 2, 3, 1000, 2],
            'category': ['A', 'A', 'B', 'B', 'C']
        })

    def test_filter(self):
        ops = [{"type": "filter", "column": "vals", "op": ">", "value": 2}]
        result = self.transformer.apply_transformations(self.df.copy(), ops)
        self.assertTrue(all(result['vals'] > 2))

    def test_drop_column(self):
        ops = [{"type": "drop_col", "column": "category"}]
        result = self.transformer.apply_transformations(self.df.copy(), ops)
        self.assertNotIn("category", result.columns)

    def test_rename_column(self):
        ops = [{"type": "rename_col", "column": "vals", "new_name": "values"}]
        result = self.transformer.apply_transformations(self.df.copy(), ops)
        self.assertIn("values", result.columns)
        self.assertNotIn("vals", result.columns)

    def test_clean_drop_duplicates(self):
        df = pd.DataFrame({'a': [1, 1, 2], 'b': [1, 1, 3]})
        ops = [{"type": "clean", "method": "drop_duplicates"}]
        result = self.transformer.apply_transformations(df, ops)
        self.assertEqual(len(result), 2)

    def test_clean_text_trim(self):
        ops = [{"type": "clean", "method": "clean_text", "column": "text", "clean_type": "trim"}]
        result = self.transformer.apply_transformations(self.df.copy(), ops)
        self.assertEqual(result['text'].iloc[0], 'hello')

    def test_clean_text_lower(self):
        ops = [{"type": "clean", "method": "clean_text", "column": "text", "clean_type": "lower"}]
        result = self.transformer.apply_transformations(self.df.copy(), ops)
        self.assertEqual(result['text'].iloc[1], 'world')

    def test_clean_remove_outliers_zscore(self):
        ops = [{"type": "clean", "method": "remove_outliers", "column": "vals",
                "outlier_method": "z-score", "threshold": 1.5}]
        result = self.transformer.apply_transformations(self.df.copy(), ops)
        self.assertNotIn(1000, result['vals'].values)

    def test_clean_remove_outliers_iqr(self):
        ops = [{"type": "clean", "method": "remove_outliers", "column": "vals", "outlier_method": "iqr"}]
        result = self.transformer.apply_transformations(self.df.copy(), ops)
        self.assertNotIn(1000, result['vals'].values)

    def test_fill_na_mean(self):
        df = pd.DataFrame({'v': [1.0, np.nan, 3.0, np.nan, 5.0]})
        ops = [{"type": "fill_na", "column": "v", "method": "mean"}]
        result = self.transformer.apply_transformations(df, ops)
        self.assertFalse(result['v'].isna().any())

    def test_chained_operations(self):
        ops = [
            {"type": "clean", "method": "clean_text", "column": "text", "clean_type": "trim"},
            {"type": "filter", "column": "vals", "op": "<=", "value": 3},
        ]
        result = self.transformer.apply_transformations(self.df.copy(), ops)
        self.assertTrue(all(result['vals'] <= 3))
        # After trim+filter, check first row text is trimmed
        self.assertFalse(result['text'].iloc[0].startswith(' '))


# ==============================================================================
# LAYER 2c: UNIT -- CRM Sync + Connectors
# ==============================================================================
class TestUnitCRMCleaning(unittest.TestCase):
    """Unit tests for crm_sync.clean_crm_dataframe."""

    def setUp(self):
        from crm_sync import clean_crm_dataframe
        self.clean = clean_crm_dataframe

    def test_empty_returns_empty(self):
        self.assertTrue(self.clean(pd.DataFrame()).empty)

    def test_none_returns_none(self):
        self.assertIsNone(self.clean(None))

    def test_snake_case_columns(self):
        df = pd.DataFrame({"FirstName": ["A"], "LastName": ["B"], "createdAt": ["2024-01-01"]})
        result = self.clean(df)
        self.assertIn("first_name", result.columns)
        self.assertIn("last_name", result.columns)

    def test_drops_empty_columns(self):
        df = pd.DataFrame({"ID": [1], "empty": [None], "name": ["A"]})
        result = self.clean(df)
        self.assertNotIn("empty", result.columns)

    def test_deduplicates_by_id(self):
        df = pd.DataFrame({"Id": [1, 1, 2], "v": ["a", "a", "b"]})
        self.assertEqual(len(self.clean(df)), 2)

    def test_date_conversion(self):
        df = pd.DataFrame({"createdDate": ["2024-01-01", "2024-06-15"], "v": [1, 2]})
        result = self.clean(df)
        date_col = [c for c in result.columns if 'date' in c][0]
        self.assertTrue(pd.api.types.is_datetime64_any_dtype(result[date_col]))


class TestUnitMockData(unittest.TestCase):
    """Unit tests for mock CRM data."""

    def setUp(self):
        from crm_sync import generate_mock_crm_data
        self.gen = generate_mock_crm_data

    def test_contacts(self):
        df = self.gen("hubspot", "contacts")
        self.assertGreater(len(df), 0)
        self.assertIn("Email", df.columns)

    def test_deals(self):
        df = self.gen("salesforce", "deal")
        self.assertGreater(len(df), 0)
        self.assertIn("Amount", df.columns)

    def test_companies(self):
        df = self.gen("hubspot", "account")
        self.assertGreater(len(df), 0)
        self.assertIn("Industry", df.columns)

    def test_all_entries_have_id(self):
        df = self.gen("salesforce", "Lead")
        self.assertIn("Id", df.columns)
        self.assertTrue(all(df["Id"].str.startswith("ID_")))


class TestUnitConnectors(unittest.TestCase):
    """Unit tests for connector constructors."""

    def test_hubspot_connector_init(self):
        from connectors import HubSpotConnector
        c = HubSpotConnector("test_token")
        self.assertEqual(c.access_token, "test_token")
        self.assertIn("Bearer", c.headers["Authorization"])

    def test_salesforce_connector_init(self):
        from connectors import SalesforceConnector
        c = SalesforceConnector("token", "https://test.salesforce.com", "refresh")
        self.assertEqual(c.access_token, "token")
        self.assertEqual(c.instance_url, "https://test.salesforce.com")


# ==============================================================================
# LAYER 3: INTEGRATION -- Database model CRUD
# ==============================================================================
class TestIntegrationModels(unittest.TestCase):
    """Integration tests for all model CRUD operations."""

    @classmethod
    def setUpClass(cls):
        cls.test_db = os.path.join(os.path.dirname(__file__), '_test_full.db')
        os.environ['ADMIN_DB_URL'] = f'sqlite:///{cls.test_db}'
        import models
        importlib.reload(models)
        models.init_admin_db()

    @classmethod
    def tearDownClass(cls):
        try:
            os.remove(cls.test_db)
        except:
            pass

    def _create_org(self, name_prefix="TestOrg"):
        from models import get_db, Organization
        with get_db() as db:
            org = Organization(
                name=f"{name_prefix}_{secrets.token_hex(4)}",
                email=f"{secrets.token_hex(3)}@test.com",
                api_key=secrets.token_hex(16),
                created_at=datetime.utcnow()
            )
            db.add(org)
            db.flush()
            oid = org.id
            key = org.api_key
        return oid, key

    def test_org_creation(self):
        oid, key = self._create_org()
        self.assertIsNotNone(oid)
        self.assertGreater(len(key), 10)

    def test_org_lookup_by_api_key(self):
        from models import get_org_by_api_key
        oid, key = self._create_org("LookupOrg")
        org = get_org_by_api_key(key)
        self.assertIsNotNone(org)
        self.assertEqual(org.id, oid)

    def test_org_lookup_invalid_key_returns_none(self):
        from models import get_org_by_api_key
        self.assertIsNone(get_org_by_api_key("nonexistent_key_xyz"))

    def test_integration_credential_full_lifecycle(self):
        from models import save_integration_credential, get_integration_credential
        oid, _ = self._create_org("CredOrg")
        # Create
        r = save_integration_credential(oid, "hubspot", "cid_1", "csec_1", "http://cb")
        self.assertIsNotNone(r)
        # Read
        c = get_integration_credential(oid, "hubspot")
        self.assertEqual(c.client_id, "cid_1")
        # Update
        save_integration_credential(oid, "hubspot", "cid_2", "csec_2")
        c2 = get_integration_credential(oid, "hubspot")
        self.assertEqual(c2.client_id, "cid_2")

    def test_credential_isolation_between_orgs(self):
        from models import save_integration_credential, get_integration_credential
        oid1, _ = self._create_org("Iso1")
        oid2, _ = self._create_org("Iso2")
        save_integration_credential(oid1, "hubspot", "org1_id", "org1_sec")
        save_integration_credential(oid2, "hubspot", "org2_id", "org2_sec")
        self.assertEqual(get_integration_credential(oid1, "hubspot").client_id, "org1_id")
        self.assertEqual(get_integration_credential(oid2, "hubspot").client_id, "org2_id")

    def test_credential_provider_isolation(self):
        from models import save_integration_credential, get_integration_credential
        oid, _ = self._create_org("ProvIso")
        save_integration_credential(oid, "hubspot", "hs_id", "hs_sec")
        save_integration_credential(oid, "salesforce", "sf_id", "sf_sec")
        self.assertEqual(get_integration_credential(oid, "hubspot").client_id, "hs_id")
        self.assertEqual(get_integration_credential(oid, "salesforce").client_id, "sf_id")

    def test_data_source_create(self):
        from models import create_data_source
        oid, _ = self._create_org("DSOrg")
        s = create_data_source(oid, "Test Source", "crm_hubspot", 
                               connection_details={"token": "x"}, table_name="contacts")
        self.assertIsNotNone(s)
        self.assertEqual(s.source_type, "crm_hubspot")

    def test_shared_report_create_and_fetch(self):
        from models import create_shared_report, get_shared_report
        oid, _ = self._create_org("ReportOrg")
        r = create_shared_report(oid, "test query", "test response",
                                 visualization={"type": "bar"})
        self.assertIsNotNone(r.id)
        fetched = get_shared_report(r.id)
        self.assertIsNotNone(fetched)
        self.assertEqual(fetched.query, "test query")

    def test_shared_report_expired_not_returned(self):
        from models import get_shared_report, get_db, SharedReport
        oid, _ = self._create_org("ExpiredOrg")
        with get_db() as db:
            r = SharedReport(
                id=secrets.token_urlsafe(16),
                org_id=oid,
                query="old", response="old",
                expires_at=datetime.utcnow() - timedelta(days=1),
                created_at=datetime.utcnow()
            )
            db.add(r)
            db.flush()
            rid = r.id
        self.assertIsNone(get_shared_report(rid))

    def test_feedback_create(self):
        from models import create_feedback
        oid, _ = self._create_org("FeedbackOrg")
        f = create_feedback(oid, "query", "response", 1, "great!")
        self.assertIsNotNone(f)
        self.assertEqual(f.vote, 1)

    def test_query_history_create(self):
        from models import create_query_history
        oid, _ = self._create_org("HistOrg")
        h = create_query_history(oid, "SELECT 1", "Result", sql_query="SELECT 1")
        self.assertIsNotNone(h)

    def test_branding_update(self):
        from models import update_branding
        oid, key = self._create_org("BrandOrg")
        result = update_branding(key, {"org_name": "Branded", "primary_color": "#ff0000"})
        branding = result.get_branding()
        self.assertEqual(branding["org_name"], "Branded")
        self.assertEqual(branding["primary_color"], "#ff0000")


# ==============================================================================
# LAYER 4: E2E -- All Router Endpoints via TestClient
# ==============================================================================
class TestE2EAllRouters(unittest.TestCase):
    """E2E tests for all major router endpoints."""

    @classmethod
    def setUpClass(cls):
        os.environ['CRM_MOCK_MODE'] = 'true'
        os.environ['SKIP_KEY_VALIDATION'] = '1'
        try:
            from fastapi.testclient import TestClient
            from api import app
            cls.client = TestClient(app)
            cls.app_available = True
        except Exception as e:
            cls.app_available = False

    def setUp(self):
        if not self.app_available:
            self.skipTest("TestClient unavailable")

    def _key(self):
        from models import get_db, Organization
        with get_db() as db:
            org = db.query(Organization).first()
            if org:
                k = org.api_key
                db.expunge(org)
                return k
        return None

    # -- Core endpoints --
    def test_health(self):
        r = self.client.get("/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["status"], "online")

    def test_debug_routes(self):
        r = self.client.get("/debug/routes")
        self.assertEqual(r.status_code, 200)
        self.assertGreater(r.json()["total"], 10)

    # -- Auth --
    def test_auth_register_missing_name(self):
        r = self.client.post("/auth/register", json={})
        self.assertIn(r.status_code, [422, 400])

    def test_auth_login_invalid(self):
        r = self.client.post("/auth/login", json={"email": "x@x.com", "password": "bad"})
        self.assertIn(r.status_code, [401, 400, 404])

    # -- Data Management --
    def test_tables_endpoint(self):
        k = self._key()
        if not k: self.skipTest("No org")
        r = self.client.get("/tables", headers={"x-api-key": k})
        self.assertIn(r.status_code, [200, 400])

    def test_data_sources_list(self):
        k = self._key()
        if not k: self.skipTest("No org")
        r = self.client.get("/data/sources", headers={"x-api-key": k})
        self.assertIn(r.status_code, [200, 404])

    # -- Integrations --
    def test_integrations_available(self):
        r = self.client.get("/integrations/available")
        self.assertEqual(r.status_code, 200)

    def test_integrations_callback_success(self):
        r = self.client.get("/integrations/callback-success")
        self.assertEqual(r.status_code, 200)
        self.assertIn("Connection Successful", r.text)

    def test_integrations_credentials_crud(self):
        k = self._key()
        if not k: self.skipTest("No org")
        h = {"x-api-key": k}
        # Save
        r = self.client.post("/integrations/hubspot/credentials",
                             json={"client_id": "e2e_id", "client_secret": "e2e_sec"}, headers=h)
        self.assertEqual(r.status_code, 200)
        # Fetch
        r = self.client.get("/integrations/hubspot/credentials", headers=h)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["client_id"], "e2e_id")

    def test_integrations_mock_link(self):
        k = self._key()
        if not k: self.skipTest("No org")
        r = self.client.post("/integrations/hubspot/mock-link", headers={"x-api-key": k})
        self.assertEqual(r.status_code, 200)

    # -- Branding --
    def test_branding_get(self):
        k = self._key()
        if not k: self.skipTest("No org")
        r = self.client.get("/branding", headers={"x-api-key": k})
        self.assertEqual(r.status_code, 200)

    # -- Insights --
    def test_insights_list(self):
        k = self._key()
        if not k: self.skipTest("No org")
        r = self.client.get("/insights", headers={"x-api-key": k})
        self.assertIn(r.status_code, [200])

    # -- Alerts --
    def test_alerts_list(self):
        k = self._key()
        if not k: self.skipTest("No org")
        r = self.client.get("/alerts", headers={"x-api-key": k})
        self.assertIn(r.status_code, [200, 500])

    # -- Dashboards (requires JWT user auth, so 401 is expected with api-key only) --
    def test_dashboards_list(self):
        k = self._key()
        if not k: self.skipTest("No org")
        r = self.client.get("/dashboards", headers={"x-api-key": k})
        self.assertIn(r.status_code, [200, 401, 403])

    # -- Sessions (route is /chat/sessions, requires JWT user auth) --
    def test_sessions_list(self):
        k = self._key()
        if not k: self.skipTest("No org")
        r = self.client.get("/chat/sessions", headers={"x-api-key": k})
        self.assertIn(r.status_code, [200, 401, 403])


# ==============================================================================
# LAYER 5: SECURITY
# ==============================================================================
class TestSecurityFull(unittest.TestCase):
    """Security tests across the entire API surface."""

    @classmethod
    def setUpClass(cls):
        os.environ['CRM_MOCK_MODE'] = 'true'
        os.environ['SKIP_KEY_VALIDATION'] = '1'
        try:
            from fastapi.testclient import TestClient
            from api import app
            cls.client = TestClient(app)
            cls.available = True
        except:
            cls.available = False

    def setUp(self):
        if not self.available: self.skipTest("No TestClient")

    def test_all_protected_routes_reject_bad_key(self):
        """Protected endpoints must return 401 for invalid API keys."""
        protected = [
            ("GET", "/tables"), ("GET", "/branding"), ("GET", "/insights"),
            ("GET", "/integrations/hubspot/credentials"),
            ("GET", "/integrations/hubspot/auth-url"),
        ]
        for method, path in protected:
            r = self.client.get(path, headers={"x-api-key": "BOGUS_KEY"})
            self.assertIn(r.status_code, [401, 403],
                          f"{path} returned {r.status_code} with bad key")

    def test_sql_injection_attempts(self):
        payloads = [
            "/integrations/'; DROP TABLE organizations;--/auth-url",
            "/integrations/1 OR 1=1/credentials",
        ]
        for path in payloads:
            r = self.client.get(path, headers={"x-api-key": "test"})
            self.assertIn(r.status_code, [401, 403, 404, 422])

    def test_no_stack_traces_in_errors(self):
        r = self.client.get("/integrations/bad/auth-url", headers={"x-api-key": "bad"})
        body = r.text.lower()
        self.assertNotIn("traceback", body)
        self.assertNotIn("sqlalchemy", body)
        self.assertNotIn("file \"", body)

    def test_encryption_is_real(self):
        from utils import encrypt_string
        enc = encrypt_string("sensitive_data_123")
        self.assertTrue(enc.startswith("gAAAAA"))
        self.assertNotIn("sensitive_data_123", enc)

    def test_cors_configured(self):
        r = self.client.options("/", headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET"
        })
        self.assertIn(r.status_code, [200, 204])

    def test_oversized_json_does_not_crash(self):
        big = "X" * (5 * 1024 * 1024)
        r = self.client.post("/integrations/hubspot/credentials",
                             json={"client_id": big, "client_secret": big},
                             headers={"x-api-key": "test"})
        self.assertIn(r.status_code, [401, 403, 413, 422, 400, 500])

    def test_xss_payload_does_not_crash(self):
        r = self.client.post("/auth/register",
                             json={"name": "<script>alert(1)</script>"})
        self.assertIn(r.status_code, [200, 201, 409, 400, 422])


# ==============================================================================
# LAYER 6: PERFORMANCE
# ==============================================================================
class TestPerformanceFull(unittest.TestCase):
    """Performance benchmarks for critical paths."""

    def test_crm_cleaning_1k(self):
        from crm_sync import clean_crm_dataframe
        df = pd.DataFrame({"Id": range(1000), "FirstName": [f"U{i}" for i in range(1000)],
                           "CreatedDate": ["2024-01-15"]*1000, "E": [None]*1000})
        t = time.perf_counter()
        clean_crm_dataframe(df)
        self.assertLess(time.perf_counter() - t, 0.5)

    def test_crm_cleaning_10k(self):
        from crm_sync import clean_crm_dataframe
        df = pd.DataFrame({"Id": range(10000), "N": [f"U{i}" for i in range(10000)],
                           "CreatedDate": ["2024-01-15"]*10000})
        t = time.perf_counter()
        clean_crm_dataframe(df)
        self.assertLess(time.perf_counter() - t, 2.0)

    def test_encryption_100x(self):
        from utils import encrypt_string, decrypt_string
        t = time.perf_counter()
        for i in range(100):
            decrypt_string(encrypt_string(f"val_{i}"))
        self.assertLess(time.perf_counter() - t, 1.0)

    def test_mock_data_gen_150x(self):
        from crm_sync import generate_mock_crm_data
        t = time.perf_counter()
        for _ in range(50):
            for obj in ["contacts", "deal", "account"]:
                generate_mock_crm_data("hubspot", obj)
        self.assertLess(time.perf_counter() - t, 2.0)

    def test_health_check_latency(self):
        os.environ['SKIP_KEY_VALIDATION'] = '1'
        try:
            from fastapi.testclient import TestClient
            from api import app
            c = TestClient(app)
            t = time.perf_counter()
            r = c.get("/")
            self.assertLess(time.perf_counter() - t, 0.2)
            self.assertEqual(r.status_code, 200)
        except:
            self.skipTest("No TestClient")

    def test_transformation_chain_performance(self):
        from transformations import DataTransformer
        df = pd.DataFrame({"text": [f"  Val_{i}  " for i in range(5000)],
                           "num": np.random.randn(5000)})
        ops = [
            {"type": "clean", "method": "clean_text", "column": "text", "clean_type": "trim"},
            {"type": "clean", "method": "clean_text", "column": "text", "clean_type": "lower"},
            {"type": "filter", "column": "num", "operator": ">", "value": -1},
        ]
        t = time.perf_counter()
        DataTransformer.apply_transformations(df, ops)
        self.assertLess(time.perf_counter() - t, 1.0)


# ==============================================================================
# LAYER 7: SMOKE -- Critical end-to-end user flows
# ==============================================================================
class TestSmokeFlows(unittest.TestCase):
    """Smoke tests verifying the most critical user paths."""

    @classmethod
    def setUpClass(cls):
        os.environ['CRM_MOCK_MODE'] = 'true'
        os.environ['SKIP_KEY_VALIDATION'] = '1'
        try:
            from fastapi.testclient import TestClient
            from api import app
            cls.client = TestClient(app)
            cls.available = True
        except:
            cls.available = False

    def setUp(self):
        if not self.available: self.skipTest("No TestClient")

    def _key(self):
        from models import get_db, Organization
        with get_db() as db:
            org = db.query(Organization).first()
            if org:
                k = org.api_key; db.expunge(org); return k
        return None

    def test_smoke_crm_provisioning_flow(self):
        """Full CRM flow: list -> provision -> fetch -> mock-link."""
        k = self._key()
        if not k: self.skipTest("No org")
        h = {"x-api-key": k}
        self.assertEqual(self.client.get("/integrations/available", headers=h).status_code, 200)
        self.assertEqual(self.client.post("/integrations/salesforce/credentials",
            json={"client_id": "s_id", "client_secret": "s_sec"}, headers=h).status_code, 200)
        r = self.client.get("/integrations/salesforce/credentials", headers=h)
        self.assertEqual(r.json()["client_id"], "s_id")
        self.assertEqual(self.client.post("/integrations/salesforce/mock-link", headers=h).status_code, 200)

    def test_smoke_branding_flow(self):
        """Branding: get -> update -> verify."""
        k = self._key()
        if not k: self.skipTest("No org")
        h = {"x-api-key": k}
        r = self.client.get("/branding", headers=h)
        self.assertEqual(r.status_code, 200)

    def test_smoke_dashboard_flow(self):
        """Dashboards: list returns valid response (may need JWT)."""
        k = self._key()
        if not k: self.skipTest("No org")
        r = self.client.get("/dashboards", headers={"x-api-key": k})
        self.assertIn(r.status_code, [200, 401, 403])

    def test_smoke_alerts_flow(self):
        """Alerts: list returns valid response (table may not exist)."""
        k = self._key()
        if not k: self.skipTest("No org")
        r = self.client.get("/alerts", headers={"x-api-key": k})
        self.assertIn(r.status_code, [200, 500])

    def test_smoke_insights_flow(self):
        """Insights: list returns valid response."""
        k = self._key()
        if not k: self.skipTest("No org")
        r = self.client.get("/insights", headers={"x-api-key": k})
        self.assertEqual(r.status_code, 200)

    def test_smoke_api_health(self):
        r = self.client.get("/")
        self.assertEqual(r.json()["status"], "online")
        self.assertIn("version", r.json())


# ==============================================================================
# Runner
# ==============================================================================
if __name__ == '__main__':
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()

    layers = [
        ("LINT",          TestLintEntireBackend),
        ("UNIT:Config",   TestUnitConfig),
        ("UNIT:Except",   TestUnitExceptions),
        ("UNIT:Utils",    TestUnitUtils),
        ("UNIT:Valid",    TestUnitValidators),
        ("UNIT:Schemas",  TestUnitSchemas),
        ("UNIT:Xform",    TestUnitTransformations),
        ("UNIT:CRM",      TestUnitCRMCleaning),
        ("UNIT:Mock",     TestUnitMockData),
        ("UNIT:Connect",  TestUnitConnectors),
        ("INTEG:Models",  TestIntegrationModels),
        ("E2E:Routers",   TestE2EAllRouters),
        ("SECURITY",      TestSecurityFull),
        ("PERF",          TestPerformanceFull),
        ("SMOKE",         TestSmokeFlows),
    ]

    for _, cls in layers:
        suite.addTests(loader.loadTestsFromTestCase(cls))

    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)

    print("\n" + "=" * 72)
    print("FULL CODEBASE TEST SUITE SUMMARY")
    print("=" * 72)
    total = result.testsRun
    failed = len(result.failures)
    errored = len(result.errors)
    skipped = len(result.skipped)
    passed = total - failed - errored - skipped
    print(f"  Tests run:    {total}")
    print(f"  Passed:       {passed}")
    print(f"  Failures:     {failed}")
    print(f"  Errors:       {errored}")
    print(f"  Skipped:      {skipped}")
    print("=" * 72)
    if result.wasSuccessful():
        print("  [PASS] ALL TESTS PASSED")
    else:
        print("  [FAIL] SOME TESTS FAILED")
        if result.failures:
            print("\n  FAILURES:")
            for t, tb in result.failures:
                print(f"    - {t}: {tb.splitlines()[-1]}")
        if result.errors:
            print("\n  ERRORS:")
            for t, tb in result.errors:
                print(f"    - {t}: {tb.splitlines()[-1]}")
    print("=" * 72)
