import logging

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

from app.config import get_settings

logger = logging.getLogger(__name__)


def _client(endpoint_url: str | None = None):
    settings = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=endpoint_url or settings.s3_endpoint,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name=settings.s3_region,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def ensure_bucket() -> None:
    settings = get_settings()
    s3 = _client()
    try:
        s3.head_bucket(Bucket=settings.s3_bucket)
    except ClientError:
        try:
            s3.create_bucket(Bucket=settings.s3_bucket)
            logger.info("[Storage] Created bucket %s", settings.s3_bucket)
        except Exception as exc:
            logger.warning("[Storage] Could not create bucket %s: %s", settings.s3_bucket, exc)


def upload_bytes(key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
    settings = get_settings()
    ensure_bucket()
    s3 = _client()
    s3.put_object(Bucket=settings.s3_bucket, Key=key, Body=data, ContentType=content_type)
    return key


def download_bytes(key: str) -> bytes:
    settings = get_settings()
    s3 = _client()
    resp = s3.get_object(Bucket=settings.s3_bucket, Key=key)
    return resp["Body"].read()


def presigned_download_url(key: str, expires_in: int = 900) -> str:
    settings = get_settings()
    # Sign with public endpoint so localhost browser can fetch directly if needed
    s3 = _client(endpoint_url=settings.s3_public_endpoint)
    return s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.s3_bucket, "Key": key},
        ExpiresIn=expires_in,
    )
