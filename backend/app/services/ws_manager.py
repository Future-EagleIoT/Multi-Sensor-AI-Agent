import asyncio
import json
import logging
from collections import defaultdict
from uuid import UUID

import redis.asyncio as aioredis
from fastapi import WebSocket

from app.config import get_settings

logger = logging.getLogger(__name__)


class TenantWebSocketManager:
    """Fans out Valkey pub/sub events strictly to WebSockets authenticated for the matching org_id."""

    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._task: asyncio.Task | None = None
        self._redis: aioredis.Redis | None = None

    async def start(self) -> None:
        settings = get_settings()
        self._redis = aioredis.from_url(settings.valkey_url, decode_responses=True)
        self._task = asyncio.create_task(self._listen_loop())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        if self._redis:
            await self._redis.aclose()

    async def connect(self, org_id: UUID, ws: WebSocket) -> None:
        await ws.accept()
        self._connections[str(org_id)].add(ws)

    def disconnect(self, org_id: UUID, ws: WebSocket) -> None:
        key = str(org_id)
        self._connections[key].discard(ws)
        if not self._connections[key]:
            self._connections.pop(key, None)

    async def publish_org_event(self, org_id: UUID | str, event_type: str, payload: dict) -> None:
        if not self._redis:
            return
        message = json.dumps({"type": event_type, "data": payload}, default=str)
        await self._redis.publish(f"org:{org_id}:events", message)

    async def _listen_loop(self) -> None:
        assert self._redis is not None
        while True:
            try:
                pubsub = self._redis.pubsub()
                await pubsub.psubscribe("org:*:events")
                async for msg in pubsub.listen():
                    if msg.get("type") != "pmessage":
                        continue
                    channel: str = msg["channel"]
                    parts = channel.split(":")
                    if len(parts) != 3:
                        continue
                    org_id = parts[1]
                    sockets = list(self._connections.get(org_id, ()))
                    if not sockets:
                        continue
                    raw = msg["data"]
                    dead: list[WebSocket] = []
                    for ws in sockets:
                        try:
                            await ws.send_text(raw)
                        except Exception:
                            dead.append(ws)
                    for ws in dead:
                        self._connections[org_id].discard(ws)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("[WS] Valkey pubsub loop error: %s — retrying in 2s", exc)
                await asyncio.sleep(2)


ws_manager = TenantWebSocketManager()
