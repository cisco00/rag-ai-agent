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
from huggingface_hub import InferenceClient

# Add the current directory to path so we can import from src
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from database import DatabaseManager
from tools import get_db_tools
from exceptions import (
    AgentError,
    ModelAPIError,
    MaxIterationsError,
    VisualizationParseError,
    ToolExecutionError
)
from logging_config import get_logger
from config import get_agent_config

# Initialize logger
logger = get_logger(__name__)


@dataclass
class QueryResult:
    """Result of an agent query."""
    text: str
    visualization: Optional[Dict[str, Any]] = None
    tools_used: List[str] = None
    iterations: int = 0
    
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
        if not text or "VISUALIZATION: " not in text:
            return text, None
        
        try:
            parts = text.split("VISUALIZATION: ")
            clean_text = parts[0].strip()
            viz_json_str = parts[1].strip()
            
            # Parse JSON
            viz_data = json.loads(viz_json_str)
            
            # Validate visualization data
            VisualizationParser._validate(viz_data)
            
            logger.info(
                "Visualization parsed successfully",
                extra={"chart_type": viz_data.get('type', 'unknown')}
            )
            
            return clean_text, viz_data
        
        except json.JSONDecodeError as e:
            logger.warning(
                f"Failed to parse visualization JSON: {e}",
                extra={"raw_data": viz_json_str[:100] if 'viz_json_str' in locals() else 'N/A'}
            )
            return text, None
        
        except Exception as e:
            logger.warning(f"Unexpected error parsing visualization: {e}")
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
        client: InferenceClient,
        tools_schema: List[Dict],
        tool_map: Dict[str, Any],
        config
    ):
        """
        Initialize query processor.
        
        Args:
            client: HuggingFace inference client
            tools_schema: Tool schemas for the model
            tool_map: Mapping of tool names to functions
            config: Agent configuration
        """
        self.client = client
        self.tools_schema = tools_schema
        self.tool_map = tool_map
        self.config = config
    
    def process(
        self,
        query: str,
        messages: List[Dict[str, str]],
        max_iterations: Optional[int] = None
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
            messages.append(response_message)
            
            # Execute tool calls
            for tool_call in tool_calls:
                try:
                    tool_result = self._execute_tool(tool_call)
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
    
    def _execute_tool(self, tool_call) -> Any:
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
        
        # Execute tool
        if function_name not in self.tool_map:
            error_msg = f"Tool {function_name} not found"
            logger.error(error_msg)
            raise ToolExecutionError(function_name, "Tool not found")
        
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
            hf_token: HuggingFace API token (uses config/env if None)
            connection_string: Database connection string (uses config default if None)
        
        Raises:
            ConfigurationError: If required configuration is missing
        """
        # Get configuration
        self.config = get_agent_config()
        
        # Use provided token or get from config
        hf_token = hf_token or self.config.hf_token
        
        # Initialize database manager
        self.db = DatabaseManager(connection_string)
        
        # Get tools
        self.tools_schema, self.tool_map = get_db_tools(self.db)
        
        # Initialize HuggingFace client
        self.client = InferenceClient(api_key=hf_token)
        
        # Initialize query processor
        self.query_processor = QueryProcessor(
            self.client,
            self.tools_schema,
            self.tool_map,
            self.config
        )
        
        # Query log for analytics
        self.query_log: List[Dict[str, Any]] = []
        
        logger.info("AnalyticsAgent initialized successfully")
    
    def run_query(
        self,
        query: str,
        history: Optional[List[Dict[str, str]]] = None,
        max_iterations: Optional[int] = None,
        tables: Optional[List[str]] = None
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
                result = self.query_processor.process(query, messages, max_iterations)
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
            
            # Log query for analytics
            self._log_query(query, result, viz_data)
            
            return {
                "text": clean_text,
                "visualization": viz_data
            }
        
        except AgentError as e:
            # Handle agent-specific errors
            logger.error(f"Agent error: {e}", exc_info=True)
            return {
                "text": f"I encountered an error while processing your query: {str(e)}",
                "visualization": None
            }
        
        except Exception as e:
            # Handle unexpected errors
            logger.error(f"Unexpected error: {e}", exc_info=True)
            return {
                "text": f"An unexpected error occurred: {str(e)}",
                "visualization": None
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
