import os
import sys
import textwrap
from dotenv import load_dotenv
from google import genai
from google.genai import types

# Add the current directory to path so we can import from src
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from database import DatabaseManager
from tools import get_db_tools

def print_chat_turns(chat):
    """Prints out each turn in the chat history, including function calls and responses."""
    for event in chat.get_history():
        print(f"{event.role.capitalize()}:")

        for part in event.parts:
            if txt := part.text:
                print(f'  "{txt}"')
            elif fn := part.function_call:
                args = ", ".join(f"{key}={val}" for key, val in fn.args.items())
                print(f"  Function call: {fn.name}({args})")
            elif resp := part.function_response:
                print("  Function response:")
                print(textwrap.indent(str(resp.response['result']), "    "))

        print()

def main():
    # Load environment variables
    load_dotenv()
    
    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        print("Error: GOOGLE_API_KEY not found in environment variables.")
        return

    # Initialize Database
    db = DatabaseManager()
    
    # Get tools
    db_tools = get_db_tools(db)

    # Configure GenAI Client
    client = genai.Client(api_key=api_key)
    
    instruction = """You are a helpful chatbot that can interact with an SQL database
    for a computer store. You will take the users questions and turn them into SQL
    queries using the tools available. Once you have the information you need, you will
    answer the user's question using the data returned.

    Use table_list to see what tables are present, describe_table to understand the
    schema, and execute_query to issue an SQL SELECT query."""

    # Start Chat
    chat = client.chats.create(
        model="gemini-2.0-flash",
        config=types.GenerateContentConfig(
            system_instruction=instruction,
            tools=db_tools,
        ),
    )

    # Example Query 1
    print("\n--- Query 1: Cheapest Product ---")
    response = chat.send_message("What is the cheapest product")
    print(f"\nResponse:\n{response.text}\n")
    
    # Example Query 2 (New Chat Session for cleanliness in example, strictly following original notebook flow implication, 
    # though re-using chat is also fine. The notebook re-created chat objects.)
    
    print("\n--- Query 2: Alice's Portfolio ---")
    # Re-create chat as per original notebook logic to reset context or just continuation
    # usage of same chat object is fine too, but following notebook structure:
    chat2 = client.chats.create(
        model="gemini-2.0-flash",
        config=types.GenerateContentConfig(
            system_instruction=instruction,
            tools=db_tools,
        ),
    )
    response2 = chat2.send_message('What products should salesperson Alice focus on to round out her portfolio? Explain why.')
    print(f"\nResponse:\n{response2.text}\n")
    
    # Print history of the second chat
    print("\n--- Chat History (Query 2) ---")
    print_chat_turns(chat2)

    # Clean up
    db.close()

if __name__ == "__main__":
    main()
