from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import AsyncGenerator, Callable
from uuid import UUID

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.session import get_admin_db, open_tenant_session
from app.models.entities import Membership, Organization, User

settings = get_settings()
ph = PasswordHasher()
bearer_scheme = HTTPBearer(auto_error=False)

ROLE_RANK = {
    "viewer": 10,
    "technician": 20,
    "engineer": 30,
    "admin": 40,
    "owner": 50,
}


def hash_password(password: str) -> str:
    return ph.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return ph.verify(password_hash, password)
    except VerifyMismatchError:
        return False


def create_access_token(user_id: UUID, org_id: UUID, role: str, org_slug: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "org_id": str(org_id),
        "org_slug": org_slug,
        "role": role,
        "type": "access",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.jwt_access_ttl_min)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def create_refresh_token(user_id: UUID, org_id: UUID) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "org_id": str(org_id),
        "type": "refresh",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=settings.jwt_refresh_ttl_days)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_token(token: str, expected_type: str = "access") -> dict:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired token: {exc}",
        ) from exc
    if payload.get("type") != expected_type:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")
    return payload


@dataclass
class AuthContext:
    user_id: UUID
    email: str
    full_name: str
    org_id: UUID
    org_slug: str
    org_name: str
    role: str


async def get_auth_context(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    admin_db: AsyncSession = Depends(get_admin_db),
) -> AuthContext:
    if creds is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    payload = decode_token(creds.credentials, expected_type="access")
    user_id = UUID(payload["sub"])
    org_id = UUID(payload["org_id"])

    stmt = (
        select(User, Membership, Organization)
        .join(Membership, Membership.user_id == User.id)
        .join(Organization, Organization.id == Membership.org_id)
        .where(User.id == user_id, Organization.id == org_id, User.is_active.is_(True))
    )
    row = (await admin_db.execute(stmt)).first()
    if not row:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Membership revoked or invalid")
    user, membership, org = row
    return AuthContext(
        user_id=user.id,
        email=user.email,
        full_name=user.full_name,
        org_id=org.id,
        org_slug=org.slug,
        org_name=org.name,
        role=membership.role,
    )


def require_role(min_role: str) -> Callable:
    min_rank = ROLE_RANK[min_role]

    async def _check(ctx: AuthContext = Depends(get_auth_context)) -> AuthContext:
        if ROLE_RANK.get(ctx.role, 0) < min_rank:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires role '{min_role}' or higher (current: '{ctx.role}')",
            )
        return ctx

    return _check


async def get_tenant_db(
    ctx: AuthContext = Depends(get_auth_context),
) -> AsyncGenerator[AsyncSession, None]:
    """Yields a PostgreSQL session under non-superuser `eagle_app` with RLS scoped to ctx.org_id."""
    async for session in open_tenant_session(ctx.org_id):
        yield session
