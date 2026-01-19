import os
import sys
import json
from dotenv import load_dotenv
from huggingface_hub import InferenceClient

# Add the current directory to path so we can import from src
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from database import DatabaseManager
from tools import get_db_tools

# --- Constants ---
MODEL_NAME = "Qwen/Qwen2.5-72B-Instruct"
SYSTEM_PROMPT = """You are a helpful chatbot that can interact with an SQL database
for a computer store. You will take the users questions and turn them into SQL
queries using the tools available. Once you have the information you need, you will
answer the user's question using the data returned.

Use list_tables to see what tables are present, describe_table to understand the
schema, and execute_query to issue an SQL SELECT query."""

class AnalyticsAgent:
    def __init__(self, hf_token: str):
        self.db = DatabaseManager()
        self.tools_schema, self.tool_map = get_db_tools(self.db)
        self.client = InferenceClient(api_key=hf_token)
        self.query_log = []

    def run_query(self, query: str, history: list = None) -> str:
        """
        Executes the agent loop for a given query.
        """
        messages = history if history else []
        if not any(m.get("role") == "system" for m in messages):
            messages.insert(0, {"role": "system", "content": SYSTEM_PROMPT})
        
        # We don't want to keep adding the prompt to the history if it's already there
        # but for simplicity in this loop we'll just handle it.
        
        messages.append({"role": "user", "content": query})
        
        print(f"  ...Executing query: {query}")
        
        final_response_text = ""
        
        while True:
            response = self.client.chat_completion(
                model=MODEL_NAME,
                messages=messages,
                tools=self.tools_schema,
                tool_choice="auto",
                max_tokens=1024
            )
            
            response_message = response.choices[0].message
            tool_calls = response_message.tool_calls

            if not tool_calls:
                print("  ...Agent response complete.")
                final_response_text = response_message.content
                break

            messages.append(response_message)

            for tool_call in tool_calls:
                function_name = tool_call.function.name
                raw_args = tool_call.function.arguments
                
                if raw_args is None:
                    function_args = {}
                elif isinstance(raw_args, dict):
                    function_args = raw_args
                else:
                    function_args = json.loads(raw_args)
                
                print(f"    > Calling tool: {function_name}({function_args})")
                
                if function_name in self.tool_map:
                    try:
                        tool_result = self.tool_map[function_name](**function_args)
                    except Exception as e:
                        tool_result = f"Error: {str(e)}"
                else:
                    tool_result = f"Error: Tool {function_name} not found"
                
                messages.append({
                    "role": "tool",
                    "name": function_name,
                    "tool_call_id": tool_call.id,
                    "content": str(tool_result)
                })
            
            print("  ...Feeding tool results back to model...")
        
        # Log query for analytics
        self.query_log.append({
            "query": query,
            "response_length": len(final_response_text) if final_response_text else 0,
            "tools_used": [m["name"] for m in messages if m.get("role") == "tool"]
        })
        
        return final_response_text

    def close(self):
        self.db.close()

def main():
    load_dotenv()
    hf_token = os.environ.get("HF_TOKEN")
    if not hf_token:
        print("Error: HF_TOKEN not found.")
        return

    agent = AnalyticsAgent(hf_token)
    
    # Example 1
    print("\n--- Query 1 ---")
    res1 = agent.run_query("What is the cheapest product?")
    print(f"\nResponse:\n{res1}\n")
    
    # Example 2
    print("\n--- Query 2 ---")
    res2 = agent.run_query("What products should salesperson Alice focus on to round out her portfolio? Explain why.")
    print(f"\nResponse:\n{res2}\n")

    agent.close()

if __name__ == "__main__":
    main()
