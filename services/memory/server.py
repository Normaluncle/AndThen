"""Private, rebuildable author indexes. PostgreSQL owns authorization and versions."""
import asyncio
import hmac
import os
import shutil
import uuid
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from memu.app import MemoryService

ROOT = Path(os.environ.get("MEMORY_DATA_DIR", "data/memory")).resolve()
ROOT.mkdir(parents=True, exist_ok=True)
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
locks: dict[str, asyncio.Lock] = {}


class Record(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(max_length=1000)
    content: str = Field(max_length=8000)


class Build(BaseModel):
    records: list[Record] = Field(max_length=200)


class Query(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


def authorize(token: str | None):
    expected = os.environ.get("MEMORY_SERVICE_TOKEN", "")
    if not expected or not token or not hmac.compare_digest(token, expected):
        raise HTTPException(401, "unauthorized")


def location(owner: str, generation: str):
    # Only UUIDs are accepted; no caller-controlled filesystem paths.
    try:
        return ROOT / str(uuid.UUID(owner)) / str(uuid.UUID(generation))
    except ValueError:
        raise HTTPException(422, "invalid_identifier") from None


def memory(db: Path):
    return MemoryService(
        database_config={"metadata_store": {"provider": "sqlite", "dsn": "sqlite:///" + db.as_posix()}},
        embedding_profiles={"default": {
            "provider": "openai", "base_url": os.environ["EMBEDDING_BASE_URL"],
            "api_key": os.environ["EMBEDDING_API_KEY"],
            "embed_model": os.environ.get("EMBEDDING_MODEL", "qwen3.7-text-embedding"),
            "embed_batch_size": 20,
        }},
    )


@app.get("/health")
async def health():
    return {"ok": True}


@app.put("/indexes/{owner}/{generation}")
async def rebuild(owner: str, generation: str, body: Build, x_memory_token: str | None = Header(default=None)):
    authorize(x_memory_token)
    target = location(owner, generation)
    async with locks.setdefault(owner, asyncio.Lock()):
        if (target.parent / (target.name + '.deleted')).exists():
            raise HTTPException(409, 'generation_deleted')
        target.mkdir(parents=True, exist_ok=True)
        if (target / "ready").exists():
            return {"ready": True}
        db = target / "index.sqlite"
        # A failed storage operation may have partially committed. Never reuse it.
        if db.exists():
            db.unlink()
        service = memory(db)
        try:
            await service.commit_results(recall_files=[{
                **r.model_dump(), "track": "memory",
            } for r in body.records], user={"user_id": owner})
            (target / "ready").touch()
        except Exception:
            raise HTTPException(503, "embedding_or_storage_unavailable") from None
        finally:
            service.database.close()
    return {"ready": True}


@app.post("/indexes/{owner}/{generation}/query")
async def query(owner: str, generation: str, body: Query, x_memory_token: str | None = Header(default=None)):
    authorize(x_memory_token)
    target = location(owner, generation)
    async with locks.setdefault(owner, asyncio.Lock()):
        if not (target / "ready").exists():
            raise HTTPException(404, "index_not_ready")
        service = memory(target / "index.sqlite")
        try:
            result = await service.progressive_retrieve(body.text, where={"user_id": owner})
            return {"files": [{"name": f["name"], "score": f["score"]} for f in result["files"][:5]]}
        except Exception:
            raise HTTPException(503, "embedding_or_storage_unavailable") from None
        finally:
            service.database.close()


@app.delete("/indexes/{owner}/{generation}")
async def delete(owner: str, generation: str, x_memory_token: str | None = Header(default=None)):
    authorize(x_memory_token)
    target = location(owner, generation)
    async with locks.setdefault(owner, asyncio.Lock()):
        # location() confines the resolved target to two UUID components in ROOT.
        target.parent.mkdir(parents=True, exist_ok=True)
        (target.parent / (target.name + '.deleted')).touch()
        if target.exists():
            shutil.rmtree(target)
    return {"deleted": True}
