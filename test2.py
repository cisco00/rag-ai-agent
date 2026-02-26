import os
import sys

# Set up paths
sys.path.append(os.path.abspath("C:/Users/DELL/AI-Model/rag-ai-agent/src"))

from main import AnalyticsAgent

try:
    agent = AnalyticsAgent(connection_string="sqlite:///C:/Users/DELL/AI-Model/rag-ai-agent/identifier.sqlite.db")
    print("Success")
except Exception as e:
    print(f"Exception: {type(e).__name__}: {str(e)}")
