
from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional
import json
import logging
import os
from dataclasses import dataclass

# Try imports
try:
    import google.generativeai as genai
    from google.ai.generativelanguage_v1beta.types import content
    from utils import clean_llm_json_content, clean_proto_data
    HAS_GOOGLE = True
except ImportError:
    HAS_GOOGLE = False

try:
    from huggingface_hub import InferenceClient
    HAS_HF = True
except ImportError:
    HAS_HF = False

try:
    from langfuse import Langfuse
    HAS_LANGFUSE = True
except ImportError:
    HAS_LANGFUSE = False

# Initialize Langfuse
langfuse = None
if HAS_LANGFUSE:
    public_key = os.getenv("LANGFUSE_PUBLIC_KEY")
    secret_key = os.getenv("LANGFUSE_SECRET_KEY")
    host = os.getenv("LANGFUSE_HOST", "http://localhost:3000")
    if public_key and secret_key:
        langfuse = Langfuse(public_key=public_key, secret_key=secret_key, host=host)

from logging_config import get_logger

logger = get_logger(__name__)

# --- Standardized Interface ---

@dataclass
class ToolCallFunction:
    name: str
    arguments: str # JSON string

@dataclass
class ToolCall:
    id: str
    function: ToolCallFunction
    type: str = "function"

@dataclass
class Message:
    role: str
    content: str
    tool_calls: Optional[List[ToolCall]] = None

@dataclass
class CompletionChoice:
    message: Message

@dataclass
class CompletionResponse:
    choices: List[CompletionChoice]


class LLMClient(ABC):
    @abstractmethod
    def chat_completion(
        self, 
        model: str, 
        messages: List[Dict[str, Any]], 
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: str = "auto", 
        max_tokens: int = 1024,
        observability_tags: Optional[List[str]] = None
    ) -> CompletionResponse:
        pass


class HuggingFaceClientWrapper(LLMClient):
    def __init__(self, token: str):
        if not HAS_HF:
            raise ImportError("huggingface_hub not installed")
        self.client = InferenceClient(token=token)

    def chat_completion(
        self, 
        model: str, 
        messages: List[Dict[str, Any]], 
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: str = "auto", 
        max_tokens: int = 1024,
        observability_tags: Optional[List[str]] = None
    ) -> CompletionResponse:
        
        # HF InferenceClient uses OpenAI-compatible format directly
        generation = None
        if langfuse:
            generation = langfuse.start_observation(
                name=f"hf-completion-{model}",
                as_type="generation",
                model=model,
                input=messages,
                metadata={"provider": "huggingface"},
                tags=observability_tags
            )

        response = self.client.chat_completion(
            model=model,
            messages=messages,
            tools=tools,
            tool_choice=tool_choice,
            max_tokens=max_tokens
        )
        
        if generation:
            # Ensure response message is serializable
            msg = response.choices[0].message
            output_data = {
                "role": msg.role,
                "content": msg.content,
                "tool_calls": [
                    {
                        "id": tc.id,
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments
                        }
                    } for tc in (msg.tool_calls or [])
                ]
            }
            generation.update(output=output_data)
            generation.end()
        
        # Convert to our standardized object (which mimics OpenAI/HF anyway)
        # But explicitly mapping ensures safety if underlying lib changes
        tool_calls = []
        if response.choices[0].message.tool_calls:
            for tc in response.choices[0].message.tool_calls:
                tool_calls.append(ToolCall(
                    id=tc.id,
                    function=ToolCallFunction(
                        name=tc.function.name,
                        arguments=json.dumps(tc.function.arguments) if isinstance(tc.function.arguments, dict) else tc.function.arguments
                    )
                ))
        
        return CompletionResponse(choices=[
            CompletionChoice(message=Message(
                role=response.choices[0].message.role,
                content=response.choices[0].message.content,
                tool_calls=tool_calls if tool_calls else None
            ))
        ])


class GoogleGeminiClient(LLMClient):
    def __init__(self, api_key: str):
        if not HAS_GOOGLE:
            raise ImportError("google-generativeai not installed")
        genai.configure(api_key=api_key)
        self.model = None
        self.chat = None

    def _convert_messages(self, messages: List[Dict]) -> List[Dict]:
        """Convert OpenAI format messages to Gemini format."""
        gemini_history = []
        system_instruction = None
        
        for msg in messages:
            role = msg["role"]
            content = msg.get("content", "")
            
            if role == "system":
                system_instruction = content
                continue
                
            if role == "user":
                gemini_history.append({"role": "user", "parts": [content]})
            elif role == "assistant":
                parts = []
                if content:
                    parts.append(content)
                
                # Check for tool calls in the original message dict if we had them preserved
                # But here we enter a standard OpenAI dict. 
                # If we are using this client, we expect standard dicts.
                # However, Gemini history management is stateful if using 'start_chat'.
                # But here we are stateless 'chat_completion' style.
                # We need to reconstruct the turn.
                
                # Handling tool_calls from previous turns is tricky if we don't have the struct.
                # For now, let's assume simple text history or handle tool calls if present in dict.
                if "tool_calls" in msg and msg["tool_calls"]:
                     for tc in msg["tool_calls"]:
                         # Ensure we handle potential proto-types in historical arguments
                         args_raw = tc["function"]["arguments"]
                         if isinstance(args_raw, str):
                             try:
                                 args_dict = json.loads(args_raw)
                             except json.JSONDecodeError:
                                 args_dict = {}
                         else:
                             args_dict = args_raw
                             
                         fc = genai.protos.FunctionCall(
                             name=tc["function"]["name"],
                             args=clean_proto_data(args_dict)
                         )
                         parts.append(genai.protos.Part(function_call=fc))
                
                gemini_history.append({"role": "model", "parts": parts})
                
            elif role == "tool":
                # Gemini expects tool responses as 'function_response'
                # And they must follow the model's function_call.
                # OpenAI: User -> Assistant(calls) -> Tool(results)
                # Gemini: User -> Model(calls) -> Function(results) -> Model(response)
                
                # We need to find the tool_call_id to match? 
                # Gemini doesn't strictly use IDs in the python structure the same way.
                # It just expects a response part.
                
                response_part = genai.protos.Part(
                    function_response=genai.protos.FunctionResponse(
                        name=msg.get("name"), # We need the function name here!
                        response={"result": content}
                    )
                )
                gemini_history.append({"role": "user", "parts": [response_part]}) # Tool outputs come from 'user' in Gemini chat

        return system_instruction, gemini_history

    def _convert_tools(self, tools: List[Dict]) -> Any:
        """Convert OpenAI tool schema to Gemini tool config."""
        if not tools:
            return None
            
        function_declarations = []
        for tool in tools:
            if tool["type"] != "function":
                continue
                
            f = tool["function"]
            
            # Map parameters schema
            # OpenAI uses JSON Schema (parameters -> properties)
            # Gemini uses a similar subset.
            # We can try passing the dict directly if compatible, but safer to construct.
            
            # NOTE: Simplification - generic dict passing often works for basic types
            # but let's be careful.
            
            decl = {
                "name": f["name"],
                "description": f.get("description", ""),
                "parameters": self._sanitize_schema(f.get("parameters", {}))
            }
            function_declarations.append(decl)
            
        return function_declarations

    def _sanitize_schema(self, schema: Dict[str, Any]) -> Dict[str, Any]:
        """Convert OpenAI JSON schema to Gemini-compatible schema (uppercase types)."""
        if not isinstance(schema, dict):
            return schema
            
        new_schema = schema.copy()
        if "type" in new_schema:
            val = new_schema["type"]
            if isinstance(val, str):
                # Map common JSON schema types to Gemini Enum uppercase
                # numbers -> NUMBER (or INTEGER)
                # string -> STRING
                # object -> OBJECT
                # array -> ARRAY
                # boolean -> BOOLEAN
                new_schema["type"] = val.upper()
        
        if "properties" in new_schema:
            new_props = {}
            for k, v in new_schema["properties"].items():
                new_props[k] = self._sanitize_schema(v)
            new_schema["properties"] = new_props
            
        if "items" in new_schema:
            new_schema["items"] = self._sanitize_schema(new_schema["items"])
            
        return new_schema

    def chat_completion(
        self, 
        model: str, 
        messages: List[Dict[str, Any]], 
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: str = "auto", 
        max_tokens: int = 1024,
        observability_tags: Optional[List[str]] = None
    ) -> CompletionResponse:
        
        system_instruction, history = self._convert_messages(messages)
        
        # Configure model
        gemini_tools = self._convert_tools(tools)
        
        model_instance = genai.GenerativeModel(
            model_name=model,
            tools=gemini_tools,
            system_instruction=system_instruction
        )
        
        # Prepare the last message vs history
        # Gemini 'start_chat' takes history, then 'send_message' takes the new input.
        # But 'messages' list includes the latest user query at the end.
        
        if not history:
             # Should not happen if there's a user query
             raise ValueError("No messages to process")
             
        # Extract last message
        last_msg = history[-1]
        
        # If the last message is from 'model' (assistant), we can't 'send_message' with it easily 
        # unless we are continuing. But usually user sends last.
        # However, if we are in a tool loop, the last message might be a 'tool' output (which maps to 'user' role in Gemini).
        
        chat_history = history[:-1]
        
        chat = model_instance.start_chat(history=chat_history)
        
        # Generate
        # We need to send the last content
        generation = None
        if langfuse:
            generation = langfuse.start_observation(
                name=f"google-completion-{model}",
                as_type="generation",
                model=model,
                input=messages,
                metadata={"provider": "google"},
                tags=observability_tags
            )
        
        import time
        from google.api_core import exceptions as google_exceptions

        retry_count = 0
        max_retries = 3
        backoff_factor = 2

        response = None
        while retry_count <= max_retries:
            try:
                response = chat.send_message(last_msg["parts"])
                break # Break loop on success

            except google_exceptions.ResourceExhausted as e:
                retry_count += 1
                if retry_count > max_retries:
                    logger.error(f"Gemini API rate limit exceeded after {max_retries} retries: {e}")
                    from exceptions import ModelAPIError
                    raise ModelAPIError(f"Rate limit exceeded (429): {str(e)}")
                
                wait_time = backoff_factor ** retry_count
                logger.warning(f"Gemini API rate limit (429) hit. Retrying in {wait_time}s... (Attempt {retry_count}/{max_retries})")
                time.sleep(wait_time)

            except Exception as e:
                logger.error(f"Gemini API error: {e}")
                from exceptions import ModelAPIError
                raise ModelAPIError(str(e))
        
        if response is None:
            raise RuntimeError("Failed to get a response from Gemini API after retries.")

        # Parse response
        # Gemini response structure: response.candidates[0].content.parts
        
        content_text = ""
        tool_calls = []
        
        # Extract parts to convert to serializable format
        raw_parts = []
        try:
             # response.parts can fail if there's an error in the response
             raw_parts = list(response.parts)
        except Exception as e:
             logger.error(f"Error accessing response parts: {e}")

        for part in raw_parts:
            if part.text:
                content_text += part.text
            if part.function_call:
                # Convert args to JSON string to match OpenAI/HF format
                try:
                    args_dict = dict(part.function_call.args)
                except Exception:
                    args_dict = {}
                     
                tool_calls.append(ToolCall(
                    id="call_" + part.function_call.name, 
                    function=ToolCallFunction(
                        name=part.function_call.name,
                        arguments=json.dumps(clean_proto_data(args_dict))
                    )
                ))

        if generation:
            # Convert Gemini response to serializable dict
            output_data = {
                "role": "assistant",
                "content": content_text,
                "tool_calls": [
                    {
                        "id": tc.id,
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments
                        }
                    } for tc in tool_calls
                ]
            }
            generation.update(output=output_data)
            generation.end()
        
        return CompletionResponse(choices=[
            CompletionChoice(message=Message(
                role="assistant",
                content=content_text,
                tool_calls=tool_calls if tool_calls else None
            ))
        ])

def get_llm_client(provider: str, config) -> LLMClient:
    if provider == "huggingface":
        return HuggingFaceClientWrapper(token=config.hf_token)
    elif provider == "google":
        return GoogleGeminiClient(api_key=config.google_api_key)
    else:
        raise ValueError(f"Unknown provider: {provider}")