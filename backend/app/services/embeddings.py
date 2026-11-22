import hashlib
import math
import re

VECTOR_DIM = 384

# Industrial diagnostic domain terms boosted slightly for cleaner RAG retrieval without heavy models
DOMAIN_TERMS = {
    "bearing", "overheat", "thermal", "temperature", "vibration", "alignment",
    "misalignment", "lubrication", "grease", "seal", "winding", "insulation",
    "overload", "current", "power", "voltage", "phase", "coolant", "fan",
    "compressor", "impeller", "cavitation", "belt", "shaft", "torque",
    "iso", "lockout", "loto", "breaker", "humidity", "condensation", "stator", "rotor",
}


def embed_text(text: str) -> list[float]:
    """
    Lightweight, deterministic 384-dim normalized bag-of-tokens + bigram feature hash
    for pgvector cosine search on low-RAM localhost setups (0 MB external model RAM).
    """
    vec = [0.0] * VECTOR_DIM
    tokens = re.findall(r"[a-z0-9_]{2,}", text.lower())
    if not tokens:
        return vec

    features: list[tuple[str, float]] = []
    for i, tok in enumerate(tokens):
        weight = 2.0 if tok in DOMAIN_TERMS else 1.0
        features.append((tok, weight))
        if i + 1 < len(tokens):
            features.append((f"{tok}_{tokens[i + 1]}", 1.25))

    for feat, weight in features:
        digest = hashlib.blake2b(feat.encode("utf-8"), digest_size=8).digest()
        idx = int.from_bytes(digest[:4], "little") % VECTOR_DIM
        sign = 1.0 if (digest[4] & 1) == 0 else -1.0
        vec[idx] += sign * weight

    norm = math.sqrt(sum(v * v for v in vec))
    if norm > 0:
        vec = [v / norm for v in vec]
    return vec


def chunk_manual_text(text: str, max_chars: int = 700) -> list[tuple[str, str]]:
    """Splits a maintenance manual into (section_title, content) chunks for pgvector RAG."""
    lines = text.splitlines()
    chunks: list[tuple[str, str]] = []
    current_title = "General"
    buffer: list[str] = []
    buf_len = 0

    def flush():
        nonlocal buffer, buf_len
        content = "\n".join(buffer).strip()
        if content:
            chunks.append((current_title[:200], content))
        buffer = []
        buf_len = 0

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("#") or (
            stripped.endswith(":") and len(stripped) < 80 and stripped.isupper()
        ):
            flush()
            current_title = stripped.lstrip("# ").rstrip(":") or "General"
            continue

        if buf_len + len(line) + 1 > max_chars and buffer:
            flush()
        buffer.append(line)
        buf_len += len(line) + 1

    flush()
    return chunks
