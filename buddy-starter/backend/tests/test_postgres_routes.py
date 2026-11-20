"""PostgreSQL-backed route integration tests; skipped when local DB is unavailable."""
import os
import unittest
import uuid
from unittest.mock import AsyncMock, patch

from dotenv import load_dotenv
from fastapi.testclient import TestClient
from sqlalchemy import delete, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

load_dotenv()
from app import main
from app.auth.firebase_auth import verified_firebase_claims, verified_firebase_uid
from app.db.models import Message, User
from app.db.session import make_engine


class PostgreSQLRouteTests(unittest.TestCase):
    def setUp(self):
        try:
            self.engine = make_engine()
            with self.engine.connect() as connection: connection.execute(text("select 1"))
        except Exception as exc:
            self.skipTest(f"PostgreSQL unavailable ({type(exc).__name__})")

    def test_authenticated_chat_persists_idempotently_and_enforces_owner(self):
        uid_a = "route-smoke-" + uuid.uuid4().hex
        uid_b = "route-smoke-" + uuid.uuid4().hex
        claims = {"uid": uid_a, "email": None, "name": None}
        main.app.dependency_overrides[verified_firebase_claims] = lambda: claims
        main.app.dependency_overrides[verified_firebase_uid] = lambda: claims["uid"]
        try:
            with patch.dict(os.environ, {"PGVECTOR_ENABLED": "false"}), \
                 patch.object(main, "verify_token", return_value=claims), \
                 patch.object(main, "_gemini", new=AsyncMock(return_value="A short reply.")) as gemini, \
                 patch.object(main, "extract_and_store", new=AsyncMock(return_value=[])):
                with TestClient(main.app) as client:
                    profile = client.get("/auth/me")
                    self.assertEqual(profile.status_code, 200)
                    self.assertEqual(profile.json()["firebase_uid"], uid_a)
                    created = client.post("/conversations", json={"title": "Integration smoke"})
                    self.assertEqual(created.status_code, 200)
                    cid = created.json()["id"]
                    saved = client.post("/memories", json={"content": "Prefers concise answers", "category": "preferences", "sensitive": False, "retention_days": 30})
                    self.assertEqual(saved.status_code, 200)
                    self.assertEqual(client.get("/memories").status_code, 200)
                    self.assertEqual(client.put("/memory-settings", json={"automatic_enabled": True}).status_code, 200)
                    headers = {"Authorization": "Bearer unit-test-token"}
                    request = {"mode": "account", "message": "Please be concise", "conversation_id": cid, "request_id": "same-request"}
                    first = client.post("/chat", headers=headers, json=request)
                    retry = client.post("/chat", headers=headers, json=request)
                    self.assertEqual(first.status_code, 200)
                    self.assertEqual(retry.json()["reply"], first.json()["reply"])
                    self.assertEqual(gemini.await_count, 1)
                    self.assertEqual(len(gemini.await_args.args[1]), 1)
                    messages = client.get(f"/conversations/{cid}/messages")
                    self.assertEqual(messages.status_code, 200)
                    self.assertEqual([m["role"] for m in messages.json()], ["user", "assistant"])
                # A new client/session simulates a page refresh: reload list and history from PostgreSQL.
                with TestClient(main.app) as refreshed:
                    listing = refreshed.get("/conversations")
                    self.assertTrue(any(item["id"] == cid for item in listing.json()))
                    persisted = refreshed.get(f"/conversations/{cid}/messages")
                    self.assertEqual(len(persisted.json()), 2)
                with TestClient(main.app) as client:
                    claims["uid"] = uid_b
                    denied = client.get(f"/conversations/{cid}/messages")
                    self.assertEqual(denied.status_code, 403)
        finally:
            main.app.dependency_overrides.pop(verified_firebase_claims, None)
            main.app.dependency_overrides.pop(verified_firebase_uid, None)
            with Session(self.engine) as db:
                ids = list(db.scalars(select(User.id).where(User.firebase_uid.in_([uid_a, uid_b]))))
                if ids:
                    db.execute(delete(User).where(User.id.in_(ids)))
                    db.commit()


if __name__ == "__main__": unittest.main()
