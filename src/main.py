import os
import sys
import json
from dotenv import load_dotenv
from huggingface_hub import InferenceClient

# Add the current directory to path so we can import from src
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from database import DatabaseManager
from tools import get_db_tools

# Model to use
MODEL_NAME = "Qwen/Qwen2.5-72B-Instruct"

def run_agent(client, messages, tools_schema, tool_map):
    """
    Executes the agent loop:
    1. Send user message to model.
    2. Check for tool calls.
    3. Execute tools if requested.
    4. Send tool results back to model.
    5. Repeat until the model provides a text response.
    """
    
    print("  ...Sending request to model...")
    
    while True:
        response = client.chat_completion(
            model=MODEL_NAME,
            messages=messages,
            tools=tools_schema,
            tool_choice="auto",
            max_tokens=1024
        )
        
        response_message = response.choices[0].message
        tool_calls = response_message.tool_calls

        # If no tool calls, return the text content
        if not tool_calls:
            print("  ...No tool calls made. Returning result.")
            return response_message.content

        # Handle tool calls
        print(f"  ...Model requested {len(tool_calls)} tool(s)...")
        messages.append(response_message) # Add the assistant's message with tool_calls to history

        for tool_call in tool_calls:
            function_name = tool_call.function.name
            raw_args = tool_call.function.arguments
            
            if raw_args is None:
                function_args = {}
            elif isinstance(raw_args, dict):
                function_args = raw_args
            else:
                function_args = json.loads(raw_args)
            
            print(f"  > Executing tool: {function_name} with args: {function_args}")
            
            if function_name in tool_map:
                function_to_call = tool_map[function_name]
                try:
                    # Call the function
                    tool_result = function_to_call(**function_args)
                except Exception as e:
                    tool_result = f"Error: {str(e)}"
            else:
                tool_result = f"Error: Tool {function_name} not found"
                
            print(f"  < Tool Result: {tool_result}")

            # Add tool result to messages
            messages.append({
                "role": "tool",
                "name": function_name,
                "tool_call_id": tool_call.id,
                "content": str(tool_result)
            })
            
        print("  ...Sending tool results back to model...")

def main():
    # Load environment variables
    load_dotenv()
    
    hf_token = os.environ.get("HF_TOKEN")
    if not hf_token:
        print("Error: HF_TOKEN not found in environment variables.")
        print("Please add HF_TOKEN=your_token to .env file.")
        return

    # Initialize Database
    db = DatabaseManager()
    
    # Get tools
    tools_schema, tool_map = get_db_tools(db)

    # Configure HF Client
    client = InferenceClient(api_key=hf_token)
    
    system_prompt = """You are a helpful chatbot that can interact with an SQL database
    for a computer store. You will take the users questions and turn them into SQL
    queries using the tools available. Once you have the information you need, you will
    answer the user's question using the data returned.

    Use list_tables to see what tables are present, describe_table to understand the
    schema, and execute_query to issue an SQL SELECT query."""

    # Example Query 1
    print("\n--- Query 1: Cheapest Product ---")
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": "What is the cheapest product?"}
    ]
    
    response_text = run_agent(client, messages, tools_schema, tool_map)
    print(f"\nResponse:\n{response_text}\n")
    
    # Example Query 2
    print("\n--- Query 2: Alice's Portfolio ---")
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": "What products should salesperson Alice focus on to round out her portfolio? Explain why."}
    ]
    
    response_text = run_agent(client, messages, tools_schema, tool_map)
    print(f"\nResponse:\n{response_text}\n")

    # Clean up
    db.close()

if __name__ == "__main__":
    main()
