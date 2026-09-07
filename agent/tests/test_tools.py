"""Tool plumbing against a mocked backend — no network, no LLM."""

import httpx
import pytest

from factory_agent import sim_client
from factory_agent.tools import get_run, shape_floor


def mock_backend(monkeypatch, handler) -> None:
    transport = httpx.MockTransport(handler)

    def client() -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=transport, base_url="http://test")

    monkeypatch.setattr(sim_client, "_client", client)


def test_shape_floor_drops_per_slot_noise():
    floor = {
        "tickNum": 120,
        "wipCount": 3,
        "workCenters": [
            {
                "workCenterId": 1,
                "name": "Cutter",
                "capacity": 1,
                "slots": [42.5],
                "slotsInUse": 1,
            }
        ],
    }
    shaped = shape_floor(floor)
    assert shaped["workCenters"][0]["name"] == "Cutter"
    assert "slots" not in shaped["workCenters"][0]
    assert shaped["wipCount"] == 3


async def test_tool_returns_compact_json(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/runs/7"
        return httpx.Response(200, json={"id": 7, "netCents": -125})

    mock_backend(monkeypatch, handler)
    result = await get_run.ainvoke({"run_id": 7})
    assert result == '{"id":7,"netCents":-125}'


async def test_backend_error_carries_the_message(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"message": "Run 99 not found"})

    mock_backend(monkeypatch, handler)
    with pytest.raises(sim_client.SimApiError) as caught:
        await sim_client.get_json("/api/runs/99")
    assert caught.value.status == 404
    assert caught.value.message == "Run 99 not found"


async def test_unreachable_backend_is_a_sim_error(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    mock_backend(monkeypatch, handler)
    with pytest.raises(sim_client.SimApiError) as caught:
        await sim_client.get_json("/api/runs")
    assert caught.value.status == 0
    assert "unreachable" in caught.value.message
