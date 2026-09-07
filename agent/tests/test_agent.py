"""The SSE event layer — pure functions, no LLM."""

import json

from langchain_core.messages import AIMessageChunk

from factory_agent.agent import _chunk_text, sse_event


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
