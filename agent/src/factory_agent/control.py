"""Talking to the outside from inside a long-running tool.

Two things a tool that runs for minutes needs and a tool that runs for
milliseconds does not: a way to say how far it has got, and a way to be told
to stop. Both live here rather than in `actions.py`, because both are about
the *transport* around a tool rather than about the sim.

Neither is allowed to be load-bearing for correctness. Progress is
best-effort: a tool called outside a graph run (a test, a script) simply
reports nothing and still does its work. And a stop is a request to stop
*dispatching*, never an abort mid-flight — the backend commits each advance it
accepts whether or not anyone is still listening, so the only honest place to
stop is on a boundary the run has already committed to. That is the same rule
the simulator page's Stop follows for its jump.
"""

from langgraph.config import get_config, get_stream_writer

#: Threads asked to stop their in-flight long tool. A set rather than a
#: per-thread flag object because a stop is a one-shot request: whoever acts
#: on it consumes it, so a stop that arrives after a tool has finished cannot
#: silently kill the next one. In-memory and process-local, like the
#: checkpointer it sits beside — both die with the process, and both are fine
#: at one uvicorn worker and not fine at two.
_stop_requests: set[str] = set()


def request_stop(thread_id: str) -> None:
    """Ask whatever long tool is running on this thread to stop at its next
    committed boundary. Harmless if nothing is running: the request is
    consumed by the next check, and cleared when a turn starts."""
    _stop_requests.add(thread_id)


def clear_stop(thread_id: str) -> None:
    """Forget any pending request. Called when a turn begins, so a Stop that
    landed after the last tool finished cannot cut the next one short."""
    _stop_requests.discard(thread_id)


def stop_requested() -> bool:
    """Whether the thread running this tool has been asked to stop, consuming
    the request. Returns False when called outside a graph run."""
    thread_id = current_thread_id()
    if thread_id is None:
        return False
    if thread_id not in _stop_requests:
        return False
    _stop_requests.discard(thread_id)
    return True


def current_thread_id() -> str | None:
    """The thread this tool is running on, or None outside a graph run."""
    try:
        config = get_config()
    except RuntimeError:
        return None
    configurable = config.get("configurable") or {}
    thread_id = configurable.get("thread_id")
    return str(thread_id) if thread_id is not None else None


def emit_progress(payload: dict) -> None:
    """Put one progress payload on the stream, if there is a stream.

    Best-effort by design, and it takes two exception types to be so, which
    the langgraph source settles rather than intuition:
    `get_stream_writer` is `get_config()[CONF][CONFIG_KEY_RUNTIME].stream_writer`,
    so with **no** runnable context at all `get_config` raises RuntimeError,
    while inside a bare `tool.ainvoke()` — a runnable context with no pregel
    runtime, which is how every unit test calls these tools — the lookup
    raises **KeyError**. Catching only the first left the tool working in
    production and failing in its own tests.
    """
    try:
        writer = get_stream_writer()
    except (RuntimeError, KeyError):
        return
    writer({"type": "progress", **payload})
