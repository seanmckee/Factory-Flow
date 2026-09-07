"""The agent's only door into the simulation: HTTP against the backend.

Deliberately no database access — going through the REST API means the agent
inherits the run locks, the frozen-config semantics, and every validation the
backend enforces, exactly as the browser does.
"""

import httpx

from .config import settings


class SimApiError(Exception):
    """A backend error, carrying the `{message}` every API error returns."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(f"backend {status}: {message}")
        self.status = status
        self.message = message


def _client() -> httpx.AsyncClient:
    """One factory so tests can swap in a mock transport."""
    return httpx.AsyncClient(base_url=settings.backend_api_base, timeout=15.0)


async def get_json(path: str, params: dict | None = None) -> object:
    async with _client() as client:
        try:
            response = await client.get(path, params=params)
        except httpx.HTTPError as error:
            raise SimApiError(0, f"backend unreachable: {error}") from error
    if response.status_code >= 400:
        try:
            message = response.json().get("message", response.text)
        except ValueError:
            message = response.text
        raise SimApiError(response.status_code, message)
    return response.json()
