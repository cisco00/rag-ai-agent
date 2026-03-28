import os
from dotenv import load_dotenv

# Load env vars from the backend .env
load_dotenv("backend/.env")

try:
    from langfuse import Langfuse
    print("SUCCESS: Langfuse SDK imported successfully")
except ImportError:
    print("FAILURE: Langfuse SDK not found. Did you run 'pip install langfuse'?")
    exit(1)

public_key = os.getenv("LANGFUSE_PUBLIC_KEY")
secret_key = os.getenv("LANGFUSE_SECRET_KEY")
host = os.getenv("LANGFUSE_HOST")

print(f"Configured Public Key: {public_key}")
print(f"Configured Host: {host}")

if not public_key or not secret_key:
    print("FAILURE: Langfuse keys not found in .env")
    exit(1)

try:
    langfuse = Langfuse(
        public_key=public_key,
        secret_key=secret_key,
        host=host
    )
    print("SUCCESS: Langfuse client initialized successfully")
    
    # Send a test generation
    generation = langfuse.start_observation(
        name="verification-test",
        as_type="generation",
        model="test-model",
        input="test-input"
    )
    generation.update(output="test-output")
    generation.end()
    
    langfuse.flush() # Ensure it's sent
    print("SUCCESS: Test trace sent (flushed).")
except Exception as e:
    print(f"FAILURE: Error during initialization/test: {e}")
