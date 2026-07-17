"""
LLM Client — Multi-Provider Abstraction Layer

Supports:
  - OpenAI          (provider="openai")
  - Azure OpenAI    (provider="azure_openai")
  - Anthropic Claude(provider="anthropic")
  - Google Gemini   (provider="google")
  - HuggingFace     (provider="huggingface")

All providers expose the same LLMClient interface so the rest of the
application is completely provider-agnostic.
"""

from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional
import json
import logging
import os
from dataclasses import dataclass

# ---------------------------------------------------------------------------
# Optional dependency imports
# ---------------------------------------------------------------------------

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
    from openai import OpenAI, AzureOpenAI
    HAS_OPENAI = True
except ImportError:
    HAS_OPENAI = False

try:
    import anthropic
    HAS_ANTHROPIC = True
except ImportError:
    HAS_ANTHROPIC = False

try:
    from langfuse import Langfuse
    HAS_LANGFUSE = True
except ImportError:
    HAS_LANGFUSE = False

# ---------------------------------------------------------------------------
# Langfuse (observability)
# ---------------------------------------------------------------------------

langfuse = None
if HAS_LANGFUSE:
    public_key = os.getenv("LANGFUSE_PUBLIC_KEY")
    secret_key = os.getenv("LANGFUSE_SECRET_KEY")
    host = os.getenv("LANGFUSE_HOST", "http://localhost:3000")
    if public_key and secret_key:
        langfuse = Langfuse(public_key=public_key, secret_key=secret_key, host=host)

from logging_config import get_logger

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# Standardized response types (shared across all providers)
# ---------------------------------------------------------------------------

@dataclass
class ToolCallFunction:
    name: str
    arguments: str  # JSON string


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


# ---------------------------------------------------------------------------
# Abstract base
# ---------------------------------------------------------------------------

class LLMClient(ABC):
    @abstractmethod
    def chat_completion(
        self,
        model: str,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: str = "auto",
        max_tokens: int = 1024,
        observability_tags: Optional[List[str]] = None,
    ) -> CompletionResponse:
        pass


# ---------------------------------------------------------------------------
# OpenAI client
# ---------------------------------------------------------------------------

class OpenAIClientWrapper(LLMClient):
    """Supports any OpenAI-compatible endpoint (OpenAI, local vLLM, etc.)."""

    def __init__(self, api_key: str, base_url: Optional[str] = None):
        if not HAS_OPENAI:
            raise ImportError("openai package not installed. Run: pip install openai")
        self.client = OpenAI(api_key=api_key, base_url=base_url)

    def chat_completion(
        self,
        model: str,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: str = "auto",
        max_tokens: int = 1024,
        observability_tags: Optional[List[str]] = None,
    ) -> CompletionResponse:
        generation = None
        if langfuse:
            generation = langfuse.start_observation(
                name=f"openai-completion-{model}",
                as_type="generation",
                model=model,
                input=messages,
                metadata={"provider": "openai"},
                tags=observability_tags,
            )

        kwargs: Dict[str, Any] = dict(
            model=model,
            messages=messages,
            max_tokens=max_tokens,
        )
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = tool_choice

        response = self.client.chat.completions.create(**kwargs)

        tool_calls = self._parse_tool_calls(response.choices[0].message.tool_calls or [])

        if generation:
            generation.update(output={
                "role": response.choices[0].message.role,
                "content": response.choices[0].message.content,
                "tool_calls": [{"id": tc.id, "function": {"name": tc.function.name, "arguments": tc.function.arguments}} for tc in tool_calls],
            })
            generation.end()

        return CompletionResponse(choices=[
            CompletionChoice(message=Message(
                role=response.choices[0].message.role,
                content=response.choices[0].message.content or "",
                tool_calls=tool_calls if tool_calls else None,
            ))
        ])

    def _parse_tool_calls(self, raw_calls) -> List[ToolCall]:
        result = []
        for tc in raw_calls:
            result.append(ToolCall(
                id=tc.id,
                function=ToolCallFunction(
                    name=tc.function.name,
                    arguments=tc.function.arguments,
                )
            ))
        return result


# ---------------------------------------------------------------------------
# Azure OpenAI client
# ---------------------------------------------------------------------------

class AzureOpenAIClientWrapper(LLMClient):
    """
    Azure OpenAI — organizations bring their own Azure endpoint.
    The 'model' parameter maps to the Azure *deployment name*.
    """

    def __init__(self, api_key: str, endpoint: str, api_version: str):
        if not HAS_OPENAI:
            raise ImportError("openai package not installed. Run: pip install openai")
        self.client = AzureOpenAI(
            api_key=api_key,
            azure_endpoint=endpoint,
            api_version=api_version,
        )

    def chat_completion(
        self,
        model: str,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: str = "auto",
        max_tokens: int = 1024,
        observability_tags: Optional[List[str]] = None,
    ) -> CompletionResponse:
        generation = None
        if langfuse:
            generation = langfuse.start_observation(
                name=f"azure-openai-completion-{model}",
                as_type="generation",
                model=model,
                input=messages,
                metadata={"provider": "azure_openai"},
                tags=observability_tags,
            )

        kwargs: Dict[str, Any] = dict(
            model=model,  # Azure: deployment name
            messages=messages,
            max_tokens=max_tokens,
        )
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = tool_choice

        response = self.client.chat.completions.create(**kwargs)

        tool_calls = self._parse_tool_calls(response.choices[0].message.tool_calls or [])

        if generation:
            generation.update(output={
                "role": response.choices[0].message.role,
                "content": response.choices[0].message.content,
                "tool_calls": [{"id": tc.id, "function": {"name": tc.function.name, "arguments": tc.function.arguments}} for tc in tool_calls],
            })
            generation.end()

        return CompletionResponse(choices=[
            CompletionChoice(message=Message(
                role=response.choices[0].message.role,
                content=response.choices[0].message.content or "",
                tool_calls=tool_calls if tool_calls else None,
            ))
        ])

    def _parse_tool_calls(self, raw_calls) -> List[ToolCall]:
        result = []
        for tc in raw_calls:
            result.append(ToolCall(
                id=tc.id,
                function=ToolCallFunction(
                    name=tc.function.name,
                    arguments=tc.function.arguments,
                )
            ))
        return result


# ---------------------------------------------------------------------------
# Anthropic Claude client
# ---------------------------------------------------------------------------

class AnthropicClientWrapper(LLMClient):
    """
    Anthropic Claude — translates OpenAI message/tool format to Anthropic's API.
    Supports Claude 3.5 Sonnet, Claude 3 Opus, Haiku, etc.
    """

    def __init__(self, api_key: str):
        if not HAS_ANTHROPIC:
            raise ImportError("anthropic package not installed. Run: pip install anthropic")
        self.client = anthropic.Anthropic(api_key=api_key)

    def chat_completion(
        self,
        model: str,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: str = "auto",
        max_tokens: int = 1024,
        observability_tags: Optional[List[str]] = None,
    ) -> CompletionResponse:
        generation = None
        if langfuse:
            generation = langfuse.start_observation(
                name=f"anthropic-completion-{model}",
                as_type="generation",
                model=model,
                input=messages,
                metadata={"provider": "anthropic"},
                tags=observability_tags,
            )

        # Separate system message from conversation
        system_prompt = ""
        conversation: List[Dict] = []
        for msg in messages:
            if msg["role"] == "system":
                system_prompt = msg.get("content", "")
            elif msg["role"] == "tool":
                # OpenAI tool result → Anthropic tool_result block
                conversation.append({
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": msg.get("tool_call_id", ""),
                        "content": msg.get("content", ""),
                    }]
                })
            elif msg["role"] == "assistant" and msg.get("tool_calls"):
                # Assistant message with tool calls
                content_blocks = []
                if msg.get("content"):
                    content_blocks.append({"type": "text", "text": msg["content"]})
                for tc in msg["tool_calls"]:
                    args = tc["function"]["arguments"]
                    if isinstance(args, str):
                        try:
                            args = json.loads(args)
                        except json.JSONDecodeError:
                            args = {}
                    content_blocks.append({
                        "type": "tool_use",
                        "id": tc["id"],
                        "name": tc["function"]["name"],
                        "input": args,
                    })
                conversation.append({"role": "assistant", "content": content_blocks})
            else:
                conversation.append({"role": msg["role"], "content": msg.get("content", "")})

        # Convert OpenAI tool schema to Anthropic format
        anthropic_tools = None
        if tools:
            anthropic_tools = []
            for tool in tools:
                if tool["type"] != "function":
                    continue
                f = tool["function"]
                anthropic_tools.append({
                    "name": f["name"],
                    "description": f.get("description", ""),
                    "input_schema": f.get("parameters", {"type": "object", "properties": {}}),
                })

        kwargs: Dict[str, Any] = dict(
            model=model,
            max_tokens=max_tokens,
            messages=conversation,
        )
        if system_prompt:
            kwargs["system"] = system_prompt
        if anthropic_tools:
            kwargs["tools"] = anthropic_tools

        response = self.client.messages.create(**kwargs)

        # Parse response — Anthropic uses content blocks
        content_text = ""
        tool_calls: List[ToolCall] = []

        for block in response.content:
            if block.type == "text":
                content_text += block.text
            elif block.type == "tool_use":
                tool_calls.append(ToolCall(
                    id=block.id,
                    function=ToolCallFunction(
                        name=block.name,
                        arguments=json.dumps(block.input),
                    )
                ))

        if generation:
            generation.update(output={
                "role": "assistant",
                "content": content_text,
                "tool_calls": [{"id": tc.id, "function": {"name": tc.function.name, "arguments": tc.function.arguments}} for tc in tool_calls],
            })
            generation.end()

        return CompletionResponse(choices=[
            CompletionChoice(message=Message(
                role="assistant",
                content=content_text,
                tool_calls=tool_calls if tool_calls else None,
            ))
        ])


# ---------------------------------------------------------------------------
# Google Gemini client (existing — preserved as-is)
# ---------------------------------------------------------------------------

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

                if "tool_calls" in msg and msg["tool_calls"]:
                    for tc in msg["tool_calls"]:
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
                response_part = genai.protos.Part(
                    function_response=genai.protos.FunctionResponse(
                        name=msg.get("name"),
                        response={"result": content}
                    )
                )
                gemini_history.append({"role": "user", "parts": [response_part]})

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
        observability_tags: Optional[List[str]] = None,
    ) -> CompletionResponse:
        system_instruction, history = self._convert_messages(messages)

        gemini_tools = self._convert_tools(tools)

        model_instance = genai.GenerativeModel(
            model_name=model,
            tools=gemini_tools,
            system_instruction=system_instruction
        )

        if not history:
            raise ValueError("No messages to process")

        last_msg = history[-1]
        chat_history = history[:-1]
        chat = model_instance.start_chat(history=chat_history)

        generation = None
        if langfuse:
            generation = langfuse.start_observation(
                name=f"google-completion-{model}",
                as_type="generation",
                model=model,
                input=messages,
                metadata={"provider": "google"},
                tags=observability_tags,
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
                break
            except google_exceptions.ResourceExhausted as e:
                retry_count += 1
                if retry_count > max_retries:
                    logger.error(f"Gemini API rate limit exceeded after {max_retries} retries: {e}")
                    from exceptions import ModelAPIError
                    raise ModelAPIError(f"Rate limit exceeded (429): {str(e)}")
                wait_time = backoff_factor ** retry_count
                logger.warning(f"Gemini API rate limit hit. Retrying in {wait_time}s... ({retry_count}/{max_retries})")
                time.sleep(wait_time)
            except Exception as e:
                logger.error(f"Gemini API error: {e}")
                from exceptions import ModelAPIError
                raise ModelAPIError(str(e))

        if response is None:
            raise RuntimeError("Failed to get a response from Gemini API after retries.")

        content_text = ""
        tool_calls: List[ToolCall] = []

        raw_parts = []
        try:
            raw_parts = list(response.parts)
        except Exception as e:
            logger.error(f"Error accessing response parts: {e}")

        for part in raw_parts:
            if part.text:
                content_text += part.text
            if part.function_call:
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
            output_data = {
                "role": "assistant",
                "content": content_text,
                "tool_calls": [
                    {"id": tc.id, "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                    for tc in tool_calls
                ]
            }
            generation.update(output=output_data)
            generation.end()

        return CompletionResponse(choices=[
            CompletionChoice(message=Message(
                role="assistant",
                content=content_text,
                tool_calls=tool_calls if tool_calls else None,
            ))
        ])


# ---------------------------------------------------------------------------
# HuggingFace client (existing — preserved as-is)
# ---------------------------------------------------------------------------

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
        observability_tags: Optional[List[str]] = None,
    ) -> CompletionResponse:
        generation = None
        if langfuse:
            generation = langfuse.start_observation(
                name=f"hf-completion-{model}",
                as_type="generation",
                model=model,
                input=messages,
                metadata={"provider": "huggingface"},
                tags=observability_tags,
            )

        response = self.client.chat_completion(
            model=model,
            messages=messages,
            tools=tools,
            tool_choice=tool_choice,
            max_tokens=max_tokens
        )

        if generation:
            msg = response.choices[0].message
            generation.update(output={
                "role": msg.role,
                "content": msg.content,
                "tool_calls": [
                    {"id": tc.id, "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                    for tc in (msg.tool_calls or [])
                ]
            })
            generation.end()

        tool_calls: List[ToolCall] = []
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
                tool_calls=tool_calls if tool_calls else None,
            ))
        ])


# ---------------------------------------------------------------------------
# Factory — get_llm_client()
# ---------------------------------------------------------------------------

def get_llm_client(provider: str, config) -> LLMClient:
    """
    Build and return an LLMClient for the given provider.

    Supported providers
    -------------------
    openai        — OpenAI API (OPENAI_API_KEY)
    azure_openai  — Azure OpenAI (LLM_API_KEY + AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_API_VERSION)
    anthropic     — Anthropic Claude (LLM_API_KEY or ANTHROPIC_API_KEY)
    google        — Google Gemini (GOOGLE_API_KEY or LLM_API_KEY)
    huggingface   — HuggingFace Inference API (HF_TOKEN)
    """
    api_key = getattr(config, "llm_api_key", None) or os.getenv("LLM_API_KEY", "")

    if provider == "openai":
        key = api_key or os.getenv("OPENAI_API_KEY", "")
        if not key:
            raise ValueError("OPENAI_API_KEY or LLM_API_KEY is required for provider=openai")
        return OpenAIClientWrapper(api_key=key)

    elif provider == "azure_openai":
        key = api_key or os.getenv("AZURE_OPENAI_API_KEY", "")
        endpoint = getattr(config, "azure_openai_endpoint", None) or os.getenv("AZURE_OPENAI_ENDPOINT", "")
        api_version = getattr(config, "azure_openai_api_version", None) or os.getenv("AZURE_OPENAI_API_VERSION", "2024-08-01-preview")
        if not key:
            raise ValueError("LLM_API_KEY or AZURE_OPENAI_API_KEY is required for provider=azure_openai")
        if not endpoint:
            raise ValueError("AZURE_OPENAI_ENDPOINT is required for provider=azure_openai")
        return AzureOpenAIClientWrapper(api_key=key, endpoint=endpoint, api_version=api_version)

    elif provider == "anthropic":
        key = api_key or os.getenv("ANTHROPIC_API_KEY", "")
        if not key:
            raise ValueError("LLM_API_KEY or ANTHROPIC_API_KEY is required for provider=anthropic")
        return AnthropicClientWrapper(api_key=key)

    elif provider == "google":
        key = getattr(config, "google_api_key", None) or api_key or os.getenv("GOOGLE_API_KEY", "")
        if not key:
            raise ValueError("GOOGLE_API_KEY or LLM_API_KEY is required for provider=google")
        return GoogleGeminiClient(api_key=key)

    elif provider == "huggingface":
        return HuggingFaceClientWrapper(token=config.hf_token)

    else:
        raise ValueError(
            f"Unknown provider: '{provider}'. "
            f"Supported: openai, azure_openai, anthropic, google, huggingface"
        )