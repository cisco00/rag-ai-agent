"""
Analytics Agent module for the RAG AI Agent.

This module provides an AI-powered analytics agent that can query databases
using natural language and generate insights with optional visualizations.
"""

import os
import sys
import json
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
from dotenv import load_dotenv
from dotenv import load_dotenv
# from huggingface_hub import InferenceClient # Removed direct dependency

# Add the current directory to path so we can import from src
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from database import DatabaseManager
from tools import get_db_tools
from exceptions import (
    AgentError,
    ModelAPIError,
    MaxIterationsError,
    VisualizationParseError,
    ToolExecutionError,
    VerificationRequired
)
from logging_config import get_logger
from config import get_agent_config
from llm_client import get_llm_client, LLMClient

# Initialize logger
logger = get_logger(__name__)


@dataclass
class QueryResult:
    """Result of an agent query."""
    text: str
    visualization: Optional[Dict[str, Any]] = None
    tools_used: List[str] = None
    iterations: int = 0
    
    tools_used: List[str] = None
    iterations: int = 0
    sql_query: Optional[str] = None
    
    def __post_init__(self):
        if self.tools_used is None:
            self.tools_used = []


class VisualizationParser:
    """
    Parses and validates visualization data from agent responses.
    """
    
    VALID_CHART_TYPES = ['bar', 'line', 'pie', 'scatter', 'area']
    
    @staticmethod
    def parse(text: str) -> tuple[str, Optional[Dict[str, Any]]]:
        """
        Extract visualization data from response text.
        
        Args:
            text: Response text that may contain visualization data
        
        Returns:
            Tuple of (clean_text, visualization_dict)
        """
        import re
        
        # 1. Try splitting by explicit marker
        if "VISUALIZATION:" in text:
            parts = text.split("VISUALIZATION:")
            clean_text = parts[0].strip()
            potential_json = parts[1].strip()
        else:
            # If no marker, check if the text *is* just JSON or contains a JSON block
            clean_text = text
            potential_json = text

        # 2. Cleanup Markdown Code Blocks (```json ... ```)
        # Regex to capture content inside ```json ... ``` or just ``` ... ```
        code_block_match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', potential_json, re.DOTALL)
        if code_block_match:
            potential_json = code_block_match.group(1)
        
        # 3. Cleanup raw markdown syntax if it's just the block without the syntax wrapping it
        potential_json = potential_json.strip()
        if potential_json.startswith('```') and potential_json.endswith('```'):
             potential_json = potential_json.strip('`').replace('json', '', 1).strip()

        try:
            # Parse JSON
            # Find the first '{' and last '}' to strip surrounding text if any
            start_idx = potential_json.find('{')
            end_idx = potential_json.rfind('}')
            
            if start_idx != -1 and end_idx != -1:
                json_str = potential_json[start_idx : end_idx + 1]
                viz_data = json.loads(json_str)
                
                # Validate visualization data
                VisualizationParser._validate(viz_data)
                
                logger.info(
                    "Visualization parsed successfully",
                    extra={"chart_type": viz_data.get('type', 'unknown')}
                )
                
                # If we parsed successfully from the original text (no split), clean text is likely empty or needs adjustment
                # But usually the model puts text THEN viz.
                
                return clean_text, viz_data
            
        except (json.JSONDecodeError, ValueError) as e:
            logger.warning(
                f"Failed to parse visualization JSON: {e}",
                extra={"raw_data": potential_json[:100]}
            )
            
        return text, None
        

    
    @staticmethod
    def _validate(viz_data: Dict[str, Any]) -> None:
        """
        Validate visualization data structure.
        
        Args:
            viz_data: Visualization data dictionary
        
        Raises:
            VisualizationParseError: If validation fails
        """
        if not isinstance(viz_data, dict):
            raise VisualizationParseError("Visualization data must be a dictionary")
        
        # Check required fields
        if 'type' not in viz_data:
            raise VisualizationParseError("Visualization must have a 'type' field")
        
        if viz_data['type'] not in VisualizationParser.VALID_CHART_TYPES:
            logger.warning(
                f"Unknown chart type: {viz_data['type']}. "
                f"Valid types: {', '.join(VisualizationParser.VALID_CHART_TYPES)}"
            )
        
        # Check for data
        if 'data' not in viz_data and 'labels' not in viz_data:
            raise VisualizationParseError(
                "Visualization must have 'data' or 'labels' field"
            )


class QueryProcessor:
    """
    Processes queries through the agent loop with tool calling.
    """
    
    def __init__(
        self,
        client: LLMClient,
        tools_schema: List[Dict],
        tool_map: Dict[str, Any],
        config,
        fallback_client: Optional[LLMClient] = None
    ):
        """
        Initialize query processor.
        
        Args:
            client: LLMClient instance
            tools_schema: Tool schemas for the model
            tool_map: Mapping of tool names to functions
            config: Agent configuration
        """
        self.client = client
        self.tools_schema = tools_schema
        self.tool_map = tool_map
        self.config = config
        self.fallback_client = fallback_client
    
    def process(
        self,
        query: str,
        messages: List[Dict[str, str]],
        max_iterations: Optional[int] = None,
        verify_only: bool = False
    ) -> QueryResult:
        """
        Process a query through the agent loop.
        
        Args:
            query: User's query
            messages: Conversation history
            max_iterations: Maximum iterations (uses config default if None)
        
        Returns:
            QueryResult with response and metadata
        
        Raises:
            MaxIterationsError: If max iterations reached
            ModelAPIError: If API call fails
        """
        max_iterations = max_iterations or self.config.max_iterations
        iteration_count = 0
        final_response_text = ""
        tools_used = []
        
        logger.info(f"Processing query: {query[:100]}")
        
        while iteration_count < max_iterations:
            iteration_count += 1
            logger.debug(f"Iteration {iteration_count}/{max_iterations}")
            
            try:
                response = self.client.chat_completion(
                    model=self.config.model_name,
                    messages=messages,
                    tools=self.tools_schema,
                    tool_choice="auto",
                    max_tokens=self.config.max_tokens
                )
            except Exception as e:
                # Try fallback if available
                if self.fallback_client:
                    logger.warning(
                        f"Primary model {self.config.model_name} failed: {e}. "
                        f"Switching to fallback: {self.config.fallback_model_name}"
                    )
                    try:
                         response = self.fallback_client.chat_completion(
                            model=self.config.fallback_model_name,
                            messages=messages,
                            tools=self.tools_schema,
                            tool_choice="auto",
                            max_tokens=self.config.max_tokens
                        )
                         logger.info("Fallback model execution successful")
                    except Exception as fallback_error:
                         error_msg = f"Both primary and fallback models failed. Primary: {e}, Fallback: {fallback_error}"
                         logger.error(error_msg, exc_info=True)
                         raise ModelAPIError(error_msg, self.config.model_name) from e
                else:
                    error_msg = f"API call failed: {str(e)}"
                    logger.error(error_msg, exc_info=True)
                    raise ModelAPIError(error_msg, self.config.model_name) from e
            
            response_message = response.choices[0].message
            tool_calls = response_message.tool_calls
            
            # No more tool calls - we have the final response
            if not tool_calls:
                logger.info(f"Query completed in {iteration_count} iterations")
                final_response_text = response_message.content
                break
            
            # Add assistant message to history
            # Convert Message object to dict for the next iteration (API expects dicts)
            msg_dict = {
                "role": response_message.role,
                "content": response_message.content
            }
            if response_message.tool_calls:
                msg_dict["tool_calls"] = [
                    {
                        "id": tc.id,
                        "type": tc.type,
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments
                        }
                    }
                    for tc in response_message.tool_calls
                ]
            messages.append(msg_dict)
            
            # Execute tool calls
            for tool_call in tool_calls:
                try:
                    tool_result = self._execute_tool(tool_call, verify_only)
                except VerificationRequired as e:
                    # Enrich with the current thought/explanation from the model if available
                    # The model usually outputs text before the tool call.
                    if response_message.content:
                        e.explanation = response_message.content
                    
                    # Propagate up to agent
                    raise
                except Exception as e:
                    # Catch tool execution errors and feed them back to the model
                    # This allows the model to self-correct (e.g., fix invalid SQL)
                    logger.warning(f"Tool execution failed (caught): {e}")
                    tool_result = f"Error executing tool {tool_call.function.name}: {str(e)}"

                tools_used.append(tool_call.function.name)
                
                # Add tool result to messages
                messages.append({
                    "role": "tool",
                    "name": tool_call.function.name,
                    "tool_call_id": tool_call.id,
                    "content": str(tool_result)
                })
            
            logger.debug("Feeding tool results back to model")
        
        # Check if we hit max iterations
        if iteration_count >= max_iterations:
            logger.warning(f"Reached maximum iterations ({max_iterations})")
            raise MaxIterationsError(max_iterations)
        
        return QueryResult(
            text=final_response_text,
            tools_used=tools_used,
            iterations=iteration_count
        )
    
    def _execute_tool(self, tool_call, verify_only: bool = False) -> Any:
        """
        Execute a single tool call.
        
        Args:
            tool_call: Tool call object from the model
        
        Returns:
            Tool execution result
        
        Raises:
            ToolExecutionError: If tool execution fails
        """
        function_name = tool_call.function.name
        raw_args = tool_call.function.arguments
        
        # Parse arguments
        if raw_args is None:
            function_args = {}
        elif isinstance(raw_args, dict):
            function_args = raw_args
        else:
            try:
                function_args = json.loads(raw_args)
            except json.JSONDecodeError as e:
                logger.warning(f"Failed to parse tool arguments: {e}")
                function_args = {}
        
        logger.info(
            f"Executing tool: {function_name}",
            extra={"tool": function_name, "tool_args": str(function_args)[:100]}
        )
        
        if function_name not in self.tool_map:
            error_msg = f"Tool {function_name} not found"
            logger.error(error_msg)
            raise ToolExecutionError(function_name, "Tool not found")
            
        # Check for verification mode
        if verify_only and function_name == "execute_query":
            logger.info("Verification required for execute_query")
            raise VerificationRequired(
                "User verification required", 
                function_name, 
                function_args
            )
        
        try:
            result = self.tool_map[function_name](**function_args)
            logger.debug(f"Tool {function_name} executed successfully")
            return result
        except Exception as e:
            logger.error(f"Tool execution failed: {e}", exc_info=True)
            raise ToolExecutionError(function_name, str(e)) from e


class AnalyticsAgent:
    """
    AI-powered analytics agent for database querying and insights.
    
    Features:
    - Natural language to SQL conversion
    - Automatic tool calling for database operations
    - Visualization generation
    - Conversation history support
    """
    
    def __init__(
        self,
        hf_token: Optional[str] = None,
        connection_string: Optional[str] = None
    ):
        """
        Initialize the analytics agent.
        
        Args:
            hf_token: HuggingFace API token (deprecated in favor of config)
            connection_string: Database connection string (uses config default if None)
        """
        # Get configuration
        self.config = get_agent_config()
        
        # Override config if provided (legacy support)
        if hf_token:
            self.config.hf_token = hf_token
        
        # Initialize database manager
        self.db = DatabaseManager(connection_string)
        
        # Get tools
        self.tools_schema, self.tool_map = get_db_tools(self.db)
        
        # Initialize LLM Client
        try:
            self.client = get_llm_client(self.config.model_provider, self.config)
            logger.info(f"Initialized LLM with provider: {self.config.model_provider}")
        except Exception as e:
            logger.error(f"Failed to initialize LLM client: {e}")
            raise AgentError(f"Failed to initialize LLM client: {e}")
        
        # Initialize Fallback Client
        self.fallback_client = None
        if self.config.fallback_model_provider:
            try:
                self.fallback_client = get_llm_client(self.config.fallback_model_provider, self.config)
                logger.info(f"Initialized fallback LLM with provider: {self.config.fallback_model_provider}")
            except Exception as e:
                logger.warning(f"Failed to initialize fallback LLM: {e}. Fallback will be disabled.")

        # Initialize query processor
        self.query_processor = QueryProcessor(
            self.client,
            self.tools_schema,
            self.tool_map,
            self.config,
            fallback_client=self.fallback_client
        )
        
        # Query log for analytics
        self.query_log: List[Dict[str, Any]] = []
        
        logger.info("AnalyticsAgent initialized successfully")
    
    def run_query(
        self,
        query: str,
        history: Optional[List[Dict[str, str]]] = None,
        max_iterations: Optional[int] = None,
        tables: Optional[List[str]] = None,
        verify_only: bool = False,
        confirmed_sql: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Execute a natural language query against the database.
        
        Args:
            query: The user's natural language query
            history: Optional conversation history
            max_iterations: Maximum number of tool-calling iterations
            tables: Optional list of tables to restrict the analysis to
        
        Returns:
            Dictionary with 'text' and optional 'visualization' keys
        """
        logger.info(f"Running query: {query[:100]} (tables: {tables})")
        
        # If tables are specified, update the tools for this query
        if tables:
            new_schema, new_map = get_db_tools(self.db, tables=tables)
            self.query_processor.tools_schema = new_schema
            self.query_processor.tool_map = new_map
        
        try:
            # Prepare messages
            messages = history if history else []
            if not any(m.get("role") == "system" for m in messages):
                messages.insert(0, {
                    "role": "system",
                    "content": self.config.system_prompt
                })
            
            messages.append({"role": "user", "content": query})
            
            # Process query
            try:
                # If confirmed SQL provided, use it directly (bypass agent generation)
                if confirmed_sql:
                   # Manually call execution tool and explain results
                   logger.info("Executing confirmed SQL directly")
                   try:
                       # Find execute_query function
                       exec_func = self.tool_map.get("execute_query")
                       if not exec_func:
                           raise ToolExecutionError("execute_query", "Tool not found")
                       
                       # Execute SQL
                       sql_results = exec_func(sql=confirmed_sql)
                       
                       # Now ask LLM to explain the results
                       # Create a fresh message history for this
                       explanation_prompt = (
                           f"I have executed the following SQL query based on the user's request: '{query}'\n\n"
                           f"SQL: {confirmed_sql}\n\n"
                           f"Results: {str(sql_results)[:10000]} # Truncated if too long\n\n"
                            "Please analyze these results and answer the user's question. "
                            "If a chart would be helpful, include a VISUALIZATION JSON object at the end. "
                            "DO NOT WRITE PYTHON CODE. Use this JSON format:\n"
                            'VISUALIZATION: {"type": "bar", "title": "Title", "data": {"x": ["A", "B"], "y": [10, 20]}, "x_label": "Label", "y_label": "Value"}'
                        )
                       
                       messages.append({"role": "user", "content": explanation_prompt})
                       
                       # Continue processing (without verify_only, as we just executed)
                       # The LLM will see the results and generate text/viz
                       result = self.query_processor.process(
                           "Explain results", 
                           messages, 
                           max_iterations, 
                           verify_only=False
                       )
                       
                   except Exception as e:
                       logger.error(f"Error executing confirmed SQL: {e}")
                       return {
                           "text": f"Error executing the confirmed SQL: {str(e)}",
                           "visualization": None,
                           "status": "error"
                       }
                else:
                     # Normal flow (generate and potentially execute)
                     result = self.query_processor.process(
                         query, 
                         messages, 
                         max_iterations, 
                         verify_only=verify_only
                     )
            
            except VerificationRequired as e:
                logger.info(f"Verification required for tool: {e.tool_name}")
                sql_query = e.tool_args.get("sql")
                
                # Use the model's explanation if available, otherwise default message
                verification_text = e.explanation if e.explanation else "Please verify the generated SQL query before execution."
                
                return {
                    "text": verification_text,
                    "sql_query": sql_query,
                    "status": "needs_verification",
                    "visualization": None
                }
                
            except MaxIterationsError:
                # Handle gracefully
                logger.warning("Max iterations reached, returning partial result")
                return {
                    "text": (
                        "I apologize, but I reached the maximum number of processing steps. "
                        "Please try rephrasing your query or breaking it into smaller questions."
                    ),
                    "visualization": None
                }
            
            # Parse visualization
            clean_text, viz_data = VisualizationParser.parse(result.text)
            
            # If we have a visualization but no text, add a default message
            if viz_data and not clean_text:
                clean_text = "Here is the visual analysis of the results."

            # Log query for analytics
            self._log_query(query, result, viz_data)
            
            return {
                "text": clean_text,
                "visualization": viz_data,
                "status": "success",
                "sql_query": getattr(result, "sql_query", None)
            }
        
        except AgentError as e:
            # Handle agent-specific errors
            logger.error(f"Agent error: {e}", exc_info=True)
            return {
                "text": f"I encountered an error while processing your query: {str(e)}",
                "visualization": None,
                "status": "error"
            }
        
        except Exception as e:
            # Handle unexpected errors
            logger.error(f"Unexpected error: {e}", exc_info=True)
            return {
                "text": f"An unexpected error occurred: {str(e)}",
                "visualization": None,
                "status": "error"
            }
    
    def _log_query(
        self,
        query: str,
        result: QueryResult,
        viz_data: Optional[Dict[str, Any]]
    ) -> None:
        """
        Log query for analytics.
        
        Args:
            query: Original query
            result: Query result
            viz_data: Visualization data if any
        """
        self.query_log.append({
            "query": query,
            "response_length": len(result.text),
            "tools_used": result.tools_used,
            "iterations": result.iterations,
            "has_visualization": viz_data is not None
        })
    
    def get_query_stats(self) -> Dict[str, Any]:
        """
        Get statistics about queries processed.
        
        Returns:
            Dictionary with query statistics
        """
        if not self.query_log:
            return {"total_queries": 0}
        
        return {
            "total_queries": len(self.query_log),
            "avg_iterations": sum(q["iterations"] for q in self.query_log) / len(self.query_log),
            "queries_with_viz": sum(1 for q in self.query_log if q["has_visualization"]),
            "most_used_tools": self._get_most_used_tools()
        }
    
    def _get_most_used_tools(self) -> List[tuple[str, int]]:
        """Get most frequently used tools."""
        tool_counts = {}
        for query in self.query_log:
            for tool in query["tools_used"]:
                tool_counts[tool] = tool_counts.get(tool, 0) + 1
        
        return sorted(tool_counts.items(), key=lambda x: x[1], reverse=True)[:5]
    
    def close(self):
        """Close database connection."""
        logger.info("Closing AnalyticsAgent")
        self.db.close()
    
    def __enter__(self):
        """Context manager entry."""
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit."""
        self.close()
        return False


def main():
    """Example usage of the AnalyticsAgent."""
    load_dotenv()
    hf_token = os.environ.get("HF_TOKEN")
    
    if not hf_token:
        print("Error: HF_TOKEN not found in environment.")
        return
    
    with AnalyticsAgent(hf_token) as agent:
        # Example 1
        print("\n--- Query 1 ---")
        res1 = agent.run_query("What is the cheapest product?")
        print(f"\nResponse:\n{res1['text']}\n")
        if res1['visualization']:
            print(f"Visualization: {res1['visualization']}")
        
        # Example 2
        print("\n--- Query 2 ---")
        res2 = agent.run_query(
            "What products should salesperson Alice focus on to round out her portfolio? Explain why."
        )
        print(f"\nResponse:\n{res2['text']}\n")
        
        # Show stats
        print("\n--- Query Statistics ---")
        stats = agent.get_query_stats()
        print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
