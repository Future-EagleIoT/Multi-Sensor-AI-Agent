import re
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import (
    AuthContext,
    create_access_token,
    create_refresh_token,
    decode_token,
    get_auth_context,
    get_tenant_db,
    hash_password,
    require_role,
    verify_password,
)
from app.config import get_settings
from app.db.session import get_admin_db
from app.models.entities import AuditLog, Invitation, Membership, Organization, Site, User
from app.schemas.api import (
    AcceptInviteRequest,
    InviteRequest,
    LoginRequest,
    MemberOut,
    OrgSummary,
    RefreshRequest,
    RegisterRequest,
    SwitchOrgRequest,
    TokenResponse,
)
from app.services.mailer import send_email

router = APIRouter(prefix="/auth", tags=["auth"])


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return (slug or "factory")[:64]


async def _build_token_response(
    admin_db: AsyncSession, user: User, active_org_id: UUID | None = None
) -> TokenResponse:
    rows = (
        await admin_db.execute(
            select(Membership, Organization)
            .join(Organization, Organization.id == Membership.org_id)
            .where(Membership.user_id == user.id)
            .order_by(Organization.name)
        )
    ).all()
    if not rows:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User has no organization memberships")

    orgs = [
        OrgSummary(id=org.id, name=org.name, slug=org.slug, plan_tier=org.plan_tier, role=m.role)
        for m, org in rows
    ]
    selected = next((o for o in orgs if o.id == active_org_id), orgs[0])

    access = create_access_token(user.id, selected.id, selected.role or "viewer", selected.slug)
    refresh = create_refresh_token(user.id, selected.id)
    return TokenResponse(
        access_token=access,
        refresh_token=refresh,
        user_id=user.id,
        email=user.email,
        full_name=user.full_name,
        active_org=selected,
        organizations=orgs,
    )


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, admin_db: AsyncSession = Depends(get_admin_db)):
    email = body.email.lower().strip()
    existing = (await admin_db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    base_slug = _slugify(body.organization_name)
    slug = base_slug
    if (await admin_db.execute(select(Organization).where(Organization.slug == slug))).scalar_one_or_none():
        slug = f"{base_slug}-{secrets.token_hex(2)}"

    org = Organization(name=body.organization_name.strip(), slug=slug, plan_tier="pro")
    user = User(email=email, full_name=body.full_name.strip(), password_hash=hash_password(body.password))
    admin_db.add_all([org, user])
    await admin_db.flush()

    membership = Membership(org_id=org.id, user_id=user.id, role="owner")
    default_site = Site(org_id=org.id, name="Main Plant", location="Primary Facility")
    admin_db.add_all([membership, default_site])
    await admin_db.commit()

    return await _build_token_response(admin_db, user, org.id)


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, admin_db: AsyncSession = Depends(get_admin_db)):
    email = body.email.lower().strip()
    user = (await admin_db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if not user or not user.is_active or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    return await _build_token_response(admin_db, user, body.org_id)


@router.post("/refresh", response_model=TokenResponse)
async def refresh_tokens(body: RefreshRequest, admin_db: AsyncSession = Depends(get_admin_db)):
    payload = decode_token(body.refresh_token, expected_type="refresh")
    user = (
        await admin_db.execute(select(User).where(User.id == UUID(payload["sub"]), User.is_active.is_(True)))
    ).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account disabled")
    return await _build_token_response(admin_db, user, UUID(payload["org_id"]))


@router.post("/switch-org", response_model=TokenResponse)
async def switch_org(
    body: SwitchOrgRequest,
    ctx: AuthContext = Depends(get_auth_context),
    admin_db: AsyncSession = Depends(get_admin_db),
):
    membership = (
        await admin_db.execute(
            select(Membership).where(Membership.user_id == ctx.user_id, Membership.org_id == body.org_id)
        )
    ).scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of requested organization")
    user = (await admin_db.execute(select(User).where(User.id == ctx.user_id))).scalar_one()
    return await _build_token_response(admin_db, user, body.org_id)


@router.get("/me")
async def me(ctx: AuthContext = Depends(get_auth_context), admin_db: AsyncSession = Depends(get_admin_db)):
    rows = (
        await admin_db.execute(
            select(Membership, Organization)
            .join(Organization, Organization.id == Membership.org_id)
            .where(Membership.user_id == ctx.user_id)
            .order_by(Organization.name)
        )
    ).all()
    return {
        "user_id": ctx.user_id,
        "email": ctx.email,
        "full_name": ctx.full_name,
        "active_org": {
            "id": ctx.org_id,
            "slug": ctx.org_slug,
            "name": ctx.org_name,
            "role": ctx.role,
        },
        "organizations": [
            {"id": o.id, "name": o.name, "slug": o.slug, "plan_tier": o.plan_tier, "role": m.role}
            for m, o in rows
        ],
    }


@router.get("/members", response_model=list[MemberOut])
async def list_members(
    ctx: AuthContext = Depends(get_auth_context),
    admin_db: AsyncSession = Depends(get_admin_db),
):
    rows = (
        await admin_db.execute(
            select(Membership, User)
            .join(User, User.id == Membership.user_id)
            .where(Membership.org_id == ctx.org_id)
            .order_by(User.full_name)
        )
    ).all()
    return [
        MemberOut(
            user_id=u.id,
            email=u.email,
            full_name=u.full_name,
            role=m.role,
            joined_at=m.created_at,
        )
        for m, u in rows
    ]


@router.post("/invitations", status_code=status.HTTP_201_CREATED)
async def invite_member(
    body: InviteRequest,
    ctx: AuthContext = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_tenant_db),
):
    token = secrets.token_urlsafe(24)
    inv = Invitation(
        org_id=ctx.org_id,
        email=body.email.lower().strip(),
        role=body.role,
        token=token,
        invited_by=ctx.user_id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
    )
    db.add(inv)
    db.add(
        AuditLog(
            org_id=ctx.org_id,
            user_id=ctx.user_id,
            action="member.invited",
            resource_type="invitation",
            details={"email": inv.email, "role": inv.role},
        )
    )
    await db.flush()

    settings = get_settings()
    invite_url = f"{settings.public_app_url}/accept-invite?token={token}"
    send_email(
        to_email=inv.email,
        subject=f"You're invited to {ctx.org_name} on Future Eagle IIoT",
        body_text=(
            f"Hi,\n\n{ctx.full_name} invited you to join {ctx.org_name} as {inv.role}.\n"
            f"Accept invite: {invite_url}\nInvite token: {token}\n"
        ),
        body_html=(
            f"<p><strong>{ctx.full_name}</strong> invited you to join <strong>{ctx.org_name}</strong> "
            f"as <code>{inv.role}</code>.</p>"
            f"<p><a href='{invite_url}'>Accept Invitation</a></p>"
            f"<p>Token: <code>{token}</code></p>"
        ),
    )
    return {"id": inv.id, "email": inv.email, "role": inv.role, "token": token, "expires_at": inv.expires_at}


@router.post("/invitations/accept", response_model=TokenResponse)
async def accept_invite(body: AcceptInviteRequest, admin_db: AsyncSession = Depends(get_admin_db)):
    inv = (
        await admin_db.execute(
            select(Invitation).where(
                Invitation.token == body.token,
                Invitation.accepted_at.is_(None),
                Invitation.expires_at > datetime.now(timezone.utc),
            )
        )
    ).scalar_one_or_none()
    if not inv:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation invalid or expired")

    user = (await admin_db.execute(select(User).where(User.email == inv.email))).scalar_one_or_none()
    if not user:
        user = User(
            email=inv.email,
            full_name=body.full_name.strip(),
            password_hash=hash_password(body.password),
        )
        admin_db.add(user)
        await admin_db.flush()

    existing_mem = (
        await admin_db.execute(
            select(Membership).where(Membership.org_id == inv.org_id, Membership.user_id == user.id)
        )
    ).scalar_one_or_none()
    if not existing_mem:
        admin_db.add(Membership(org_id=inv.org_id, user_id=user.id, role=inv.role))

    inv.accepted_at = datetime.now(timezone.utc)
    await admin_db.commit()
    return await _build_token_response(admin_db, user, inv.org_id)
