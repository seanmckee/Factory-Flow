"""Factory Flow's agent service.

A FastAPI app the frontend calls directly (CORS below); the Express backend is
never between them. The relationship runs the other way: the backend's REST
API is this service's entire tool surface, so the agent inherits the run
locks, frozen-config semantics and reproducibility exactly as any other
client does.
"""

from dotenv import load_dotenv

# Into os.environ before any provider import: langchain-openai reads
# OPENAI_API_KEY and langsmith reads LANGSMITH_* from the environment.
load_dotenv()

import uuid

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .agent import stream_chat
from .config import settings

app = FastAPI(title="Factory Flow Agent")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict:
    """Liveness plus whether the sim backend is reachable — a mis-wired
    BACKEND_API_BASE should be visible here, not as a tool failure mid-chat."""
    backend_reachable = False
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            response = await client.get(f"{settings.backend_api_base}/api/settings")
            backend_reachable = response.status_code == 200
    except httpx.HTTPError:
        pass
    return {
        "status": "ok",
        "backendReachable": backend_reachable,
        "model": settings.openai_model,
    }


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    # omitted = a fresh conversation; pass it back to keep memory
    threadId: str | None = None


@app.post("/chat")
async def chat(body: ChatRequest) -> StreamingResponse:
    """One user turn, streamed as SSE events (token / tool / done / error).
    The threadId keys the conversation's memory (in-process for now), and the
    done event echoes it so the client can continue the thread."""
    thread_id = body.threadId or str(uuid.uuid4())
    return StreamingResponse(
        stream_chat(body.message, thread_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
