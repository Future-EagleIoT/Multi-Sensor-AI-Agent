from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env.saas", extra="ignore")

    app_env: str = "development"
    app_name: str = "Future Eagle IIoT"

    # Database (Admin for migrations/workers, App non-superuser for RLS-enforced API)
    postgres_host: str = "timescaledb"
    postgres_port: int = 5432
    postgres_db: str = "future_eagle_saas"
    postgres_user: str = "eagle_admin"
    postgres_password: str = "eagle_dev_password_change_me"
    app_db_user: str = "eagle_app"
    app_db_password: str = "eagle_app_password_change_me"

    # Cache & Streams
    valkey_url: str = "redis://valkey:6379/0"
    nats_url: str = "nats://nats:4222"

    # MQTT / mTLS
    emqx_host: str = "emqx"
    emqx_port: int = 8883
    certs_dir: str = "/certs"

    # Object Storage (RustFS locally; Hetzner/Scaleway/Backblaze B2 in prod)
    s3_endpoint: str = "http://storage:9000"
    s3_public_endpoint: str = "http://localhost:9000"
    s3_access_key: str = "eagle_storage"
    s3_secret_key: str = "eagle_storage_secret_123"
    s3_bucket: str = "future-eagle-artifacts"
    s3_region: str = "eu-central-1"

    # SMTP (Mailpit locally)
    smtp_host: str = "mailpit"
    smtp_port: int = 1025
    smtp_from: str = "alerts@future-eagle.local"

    # Auth / JWT
    jwt_secret: str = "dev_super_secret_jwt_key_change_in_production_32chars_min"
    jwt_access_ttl_min: int = 30
    jwt_refresh_ttl_days: int = 14

    # Pluggable LLM Copilot
    llm_provider: str = "mock"  # mock | gemini | mistral | ollama
    llm_temperature: float = 0.15
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    mistral_api_key: str = ""
    mistral_model: str = "mistral-small-latest"
    ollama_base_url: str = "http://ollama:11434"
    ollama_model: str = "qwen2.5:1.5b"

    # Public URLs & CORS
    public_app_url: str = "http://localhost:8080"
    cors_origins: str = "http://localhost:8080,http://localhost:5173,http://localhost:8081"

    @property
    def admin_database_url(self) -> str:
        return (
            f"postgresql+asyncpg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def admin_sync_database_url(self) -> str:
        return (
            f"postgresql+psycopg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def app_database_url(self) -> str:
        return (
            f"postgresql+asyncpg://{self.app_db_user}:{self.app_db_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
