from contextlib import asynccontextmanager
from uuid import UUID

from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api.v1 import alerts, auth, devices, hierarchy, operations, telemetry
from app.auth.security import decode_token
from app.config import get_settings
from app.db.session import AdminSessionLocal
from app.services.storage import ensure_bucket
from app.services.ws_manager import ws_manager

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    try:
        ensure_bucket()
    except Exception:
        pass
    await ws_manager.start()
    yield
    await ws_manager.stop()


app = FastAPI(
    title=f"{settings.app_name} SaaS API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

API_PREFIX = "/api/v1"
app.include_router(auth.router, prefix=API_PREFIX)
app.include_router(hierarchy.router, prefix=API_PREFIX)
app.include_router(devices.router, prefix=API_PREFIX)
app.include_router(telemetry.router, prefix=API_PREFIX)
app.include_router(alerts.router, prefix=API_PREFIX)
app.include_router(operations.router, prefix=API_PREFIX)


@app.get("/healthz")
async def healthz():
    async with AdminSessionLocal() as db:
        await db.execute(text("SELECT 1"))
    return {"status": "ok", "service": "future-eagle-api", "llm_provider": settings.llm_provider}


@app.websocket("/api/v1/ws")
async def websocket_endpoint(ws: WebSocket, token: str = Query(...)):
    try:
        payload = decode_token(token, expected_type="access")
        org_id = UUID(payload["org_id"])
    except Exception:
        await ws.close(code=4401)
        return

    await ws_manager.connect(org_id, ws)
    try:
        while True:
            # Keepalive ping/pong from client
            msg = await ws.receive_text()
            if msg == "ping":
                await ws.send_text('{"type":"pong"}')
    except WebSocketDisconnect:
        ws_manager.disconnect(org_id, ws)
    except Exception:
        ws_manager.disconnect(org_id, ws)
