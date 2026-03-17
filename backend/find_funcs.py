import sys
import os

# Define the path to the backend directory
backend_path = r"c:\Users\DELL\AI-Model\rag-ai-agent\backend"
sys.path.append(backend_path)

try:
    import dependencies
    import inspect
    
    if hasattr(dependencies, 'get_org_connection_string'):
        func = dependencies.get_org_connection_string
        print(f"get_org_connection_string is in {inspect.getfile(func)} at line {inspect.getsourcelines(func)[1]}")
    else:
        print("get_org_connection_string NOT found in dependencies")
        
    if hasattr(dependencies, 'get_current_org'):
        func = dependencies.get_current_org
        print(f"get_current_org is in {inspect.getfile(func)} at line {inspect.getsourcelines(func)[1]}")
    else:
        print("get_current_org NOT found in dependencies")

    # Also check api.py imports
    import api
    if hasattr(api, 'get_org_connection_string'):
        func = api.get_org_connection_string
        print(f"api.get_org_connection_string is in {inspect.getfile(func)} at line {inspect.getsourcelines(func)[1]}")
    else:
         print("get_org_connection_string NOT found in api")

except Exception as e:
    print(f"Error: {e}")
