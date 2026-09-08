"""The SSE event layer — pure functions, no LLM."""

import json

import httpx
from langchain_core.messages import AIMessage, AIMessageChunk, ToolMessage
from langchain_core.tools import ToolException
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.prebuilt.tool_node import _infer_handled_types

from factory_agent.agent import (
    ANALYST_TOOL_NODE,
    _chunk_text,
    sse_event,
    tool_error_message,
)
from factory_agent.sim_client import SimApiError

from .test_tools import mock_backend


def test_sse_event_is_one_data_line():
    line = sse_event({"type": "token", "text": "hello"})
    assert line == 'data: {"type": "token", "text": "hello"}\n\n'
    assert json.loads(line.removeprefix("data: ")) == {
        "type": "token",
        "text": "hello",
    }


def test_chunk_text_reads_plain_string_content():
    assert _chunk_text(AIMessageChunk(content="hi")) == "hi"


def test_chunk_text_reads_block_lists_and_skips_non_text():
    chunk = AIMessageChunk(
        content=[
            {"type": "text", "text": "a"},
            {"type": "tool_use", "id": "x", "name": "t", "input": {}},
            {"type": "text", "text": "b"},
        ]
    )
    assert _chunk_text(chunk) == "ab"


def call_tool(name: str, args: dict) -> dict:
    """One tool call, as the model would emit it."""
    return {
        "messages": [
            AIMessage(
                content="",
                tool_calls=[{"name": name, "args": args, "id": "call_1"}],
            )
        ]
    }


def tool_graph():
    """The tool node behind a one-node graph — a ToolNode needs a runtime, and
    compiling one is the public way to give it one."""
    builder = StateGraph(MessagesState)
    builder.add_node("tools", ANALYST_TOOL_NODE)
    builder.add_edge(START, "tools")
    builder.add_edge("tools", END)
    return builder.compile()


async def test_tool_node_returns_backend_errors_to_the_model(monkeypatch):
    """A 404 from a bad argument must arrive as a tool message, not a raise —
    langgraph's default handler re-raises anything that isn't an argument
    validation error, which is what killed the read-only trap's turn."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"message": "Run 99 not found"})

    mock_backend(monkeypatch, handler)
    result = await tool_graph().ainvoke(call_tool("get_run", {"run_id": 99}))
    message = result["messages"][-1]
    assert isinstance(message, ToolMessage)
    assert message.status == "error"
    assert "Run 99 not found" in message.content


async def test_tool_node_returns_bad_arguments_to_the_model():
    """The other half: an argument the tool's schema rejects is the model's
    mistake to fix, so it comes back as text rather than ending the turn."""
    result = await tool_graph().ainvoke(
        call_tool("get_run", {"run_id": "the best one"})
    )
    message = result["messages"][-1]
    assert isinstance(message, ToolMessage)
    assert message.status == "error"
    assert "Tool call failed" in message.content


def test_tool_error_handler_leaves_our_own_bugs_alone():
    """Narrow by annotation: a KeyError in our code is a crash, not a fact
    about the factory laundered into the transcript."""
    assert _infer_handled_types(tool_error_message) == (SimApiError, ToolException)
