"""PostgreSQL-backed route integration tests; skipped when local DB is unavailable."""
import os
import json
import unittest
import uuid
import json
import httpx
from unittest.mock import AsyncMock, patch

from dotenv import load_dotenv
from fastapi.testclient import TestClient
from sqlalchemy import delete, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

load_dotenv()
from app import main
from app.auth.firebase_auth import verified_firebase_claims, verified_firebase_uid
from app.db.models import Conversation, Memory, MemoryEvent, Message, User
from app.services import memory as memory_service
from app.db.session import make_engine


class PostgreSQLRouteTests(unittest.TestCase):
    def setUp(self):
        try:
            self.engine = make_engine()
            with self.engine.connect() as connection: connection.execute(text("select 1"))
        except Exception as exc:
            self.skipTest(f"PostgreSQL unavailable ({type(exc).__name__})")

    def test_cross_conversation_recall_is_bounded_opted_in_and_owner_scoped(self):
        uid_a = "history-recall-" + uuid.uuid4().hex
        uid_b = "history-recall-" + uuid.uuid4().hex
        claims = {"uid": uid_a, "email": None, "name": None, "email_verified": True}
        captured = []
        main.app.dependency_overrides[verified_firebase_claims] = lambda: claims
        main.app.dependency_overrides[verified_firebase_uid] = lambda: claims["uid"]

        async def mocked_gemini(messages, memories=(), past_excerpts=(), followup=None, display_name=None):
            captured.append((list(messages), list(memories), list(past_excerpts)))
            return "I have a relevant detail from an earlier chat." if past_excerpts else "I don't have that detail yet."

        try:
            with patch.dict(os.environ, {"PGVECTOR_ENABLED": "false"}), \
                 patch.object(main, "verify_token", side_effect=lambda _: claims), \
                 patch.object(main, "_gemini", side_effect=mocked_gemini), \
                 patch.object(main, "_generate_conversation_title", new=AsyncMock(return_value="Project chat")), \
                 patch.object(main, "process_one_pending_extraction", new=AsyncMock(return_value=([], set(), {"saved": 0}))):
                with TestClient(main.app) as client:
                    headers = {"Authorization": "Bearer history-test-token"}
                    self.assertEqual(client.get("/auth/me").status_code, 200)
                    self.assertEqual(client.put("/memory-settings", json={"automatic_enabled": True}).status_code, 200)
                    source = client.post("/conversations", json={"title": "Source chat"}).json()["id"]
                    sent = client.post("/chat", headers=headers, json={"mode": "account", "message": "My final-year project is about crop disease detection.", "conversation_id": source})
                    self.assertEqual(sent.status_code, 200)
                    self.assertEqual(client.get("/memories").json(), [])
                    fresh = client.post("/conversations", json={"title": "New chat"}).json()["id"]
                    recalled = client.post("/chat", headers=headers, json={"mode": "account", "message": "What do you know about my work?", "conversation_id": fresh})
                    self.assertEqual(recalled.status_code, 200)
                    self.assertTrue(any("crop disease detection" in item["content"] for item in captured[-1][2]))
                    self.assertEqual([m["content"] for m in captured[-1][0]], ["What do you know about my work?"])
                    transcript = client.get(f"/conversations/{fresh}/messages").json()
                    self.assertNotIn("crop disease detection", str(transcript))

                    # Expiry is enforced during recall even before the Memories page is opened.
                    with Session(self.engine) as db:
                        owner = db.scalar(select(User).where(User.firebase_uid == uid_a))
                        expired_fact = Memory(user_id=owner.id, content="My final-year project is about crop disease detection.", category="open_threads", source_conversation_id=uuid.UUID(source), source_reason="Learned from chat", sensitivity="non_sensitive", status="active", expires_at=main.datetime.now(main.timezone.utc) - main.timedelta(seconds=1))
                        db.add(expired_fact)
                        db.commit()
                    after_expiry = client.post("/conversations", json={"title": "After expiry"}).json()["id"]
                    client.post("/chat", headers=headers, json={"mode": "account", "message": "What do you know about my work?", "conversation_id": after_expiry})
                    self.assertFalse(any("crop disease detection" in item["content"] for item in captured[-1][2]))

                    # A forgotten saved fact must not return through its source transcript.
                    forgotten_source = client.post("/conversations", json={"title": "Forgotten fact source"}).json()["id"]
                    client.post("/chat", headers=headers, json={"mode": "account", "message": "My robotics project is a garden sensor.", "conversation_id": forgotten_source})
                    with Session(self.engine) as db:
                        owner = db.scalar(select(User).where(User.firebase_uid == uid_a))
                        forgotten = Memory(user_id=owner.id, content="My robotics project is a garden sensor.", category="open_threads", source_conversation_id=uuid.UUID(forgotten_source), source_reason="Learned from chat", sensitivity="non_sensitive", status="active", expires_at=main.datetime.now(main.timezone.utc) + main.timedelta(days=30))
                        db.add(forgotten)
                        db.commit()
                        forgotten_id = forgotten.id
                    self.assertEqual(client.delete(f"/memories/{forgotten_id}").status_code, 200)
                    after_forgotten = client.post("/conversations", json={"title": "After forgotten fact"}).json()["id"]
                    client.post("/chat", headers=headers, json={"mode": "account", "message": "What do you know about my work?", "conversation_id": after_forgotten})
                    self.assertFalse(any("garden sensor" in item["content"] for item in captured[-1][2]))

                    unrelated = client.post("/conversations", json={"title": "Unrelated"}).json()["id"]
                    client.post("/chat", headers=headers, json={"mode": "account", "message": "What is the weather like?", "conversation_id": unrelated})
                    self.assertEqual(captured[-1][2], [])

                    self.assertEqual(client.put("/memory-settings", json={"automatic_enabled": False}).status_code, 200)
                    disabled = client.post("/conversations", json={"title": "Disabled"}).json()["id"]
                    client.post("/chat", headers=headers, json={"mode": "account", "message": "What do you know about my work?", "conversation_id": disabled})
                    self.assertEqual(captured[-1][2], [])

                    self.assertEqual(client.put("/memory-settings", json={"automatic_enabled": True}).status_code, 200)
                    self.assertEqual(client.delete(f"/conversations/{source}").status_code, 200)
                    after_delete = client.post("/conversations", json={"title": "After delete"}).json()["id"]
                    client.post("/chat", headers=headers, json={"mode": "account", "message": "What do you know about my work?", "conversation_id": after_delete})
                    self.assertEqual(captured[-1][2], [])

                    claims["uid"] = uid_b
                    self.assertEqual(client.get("/auth/me").status_code, 200)
                    self.assertEqual(client.put("/memory-settings", json={"automatic_enabled": True}).status_code, 200)
                    other = client.post("/conversations", json={"title": "Other account"}).json()["id"]
                    client.post("/chat", headers=headers, json={"mode": "account", "message": "What do you know about my work?", "conversation_id": other})
                    self.assertEqual(captured[-1][2], [])
        finally:
            main.app.dependency_overrides.pop(verified_firebase_claims, None)
            main.app.dependency_overrides.pop(verified_firebase_uid, None)
            with Session(self.engine) as db:
                ids = list(db.scalars(select(User.id).where(User.firebase_uid.in_([uid_a, uid_b]))))
                if ids:
                    db.execute(delete(User).where(User.id.in_(ids)))
                    db.commit()

    def test_authenticated_chat_persists_idempotently_and_enforces_owner(self):
        uid_a = "route-smoke-" + uuid.uuid4().hex
        uid_b = "route-smoke-" + uuid.uuid4().hex
        claims = {"uid": uid_a, "email": None, "name": None, "email_verified": True}
        main.app.dependency_overrides[verified_firebase_claims] = lambda: claims
        main.app.dependency_overrides[verified_firebase_uid] = lambda: claims["uid"]
        try:
            with patch.dict(os.environ, {"PGVECTOR_ENABLED": "false"}), \
                 patch.object(main, "verify_token", return_value=claims), \
                 patch.object(main, "_gemini", new=AsyncMock(return_value="A short reply.")) as gemini, \
                 patch.object(main, "_generate_conversation_title", new=AsyncMock(return_value="A short chat")), \
                 patch.object(main, "process_one_pending_extraction", new=AsyncMock(return_value=([], set(), {"saved": 0}))):
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
                    second_cid = client.post("/conversations", json={"title": "Second thread"}).json()["id"]
                    second = client.post("/chat", headers=headers, json={"mode": "account", "message": "Let's talk about hiking", "conversation_id": second_cid, "request_id": "second-thread"})
                    self.assertEqual(second.status_code, 200)
                    messages = client.get(f"/conversations/{cid}/messages")
                    self.assertEqual(messages.status_code, 200)
                    self.assertEqual([m["role"] for m in messages.json()], ["user", "assistant"])
                # A new client/session simulates a page refresh: reload list and history from PostgreSQL.
                with TestClient(main.app) as refreshed:
                    listing = refreshed.get("/conversations")
                    self.assertTrue(any(item["id"] == cid for item in listing.json()))
                    persisted = refreshed.get(f"/conversations/{cid}/messages")
                    self.assertEqual(len(persisted.json()), 2)
                    other_thread = refreshed.get(f"/conversations/{second_cid}/messages")
                    self.assertEqual([item["content"] for item in persisted.json() if item["role"] == "user"], ["Please be concise"])
                    self.assertEqual([item["content"] for item in other_thread.json() if item["role"] == "user"], ["Let's talk about hiking"])
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

    def test_saved_memory_recall_in_fresh_conversation_obeys_all_exclusion_filters(self):
        uid_a = "memory-recall-" + uuid.uuid4().hex
        uid_b = "memory-recall-" + uuid.uuid4().hex
        claims = {"uid": uid_a, "email": None, "name": None, "email_verified": True}
        captured = []
        main.app.dependency_overrides[verified_firebase_claims] = lambda: claims
        main.app.dependency_overrides[verified_firebase_uid] = lambda: claims["uid"]

        async def mocked_gemini(messages, memories=(), past_excerpts=(), followup=None, display_name=None):
            facts = [memory.content for memory in memories]
            captured.append((facts, messages[-1]["content"]))
            return next((fact for fact in facts if "dog's name" in fact), "I don't have that detail.")

        try:
            with patch.dict(os.environ, {"PGVECTOR_ENABLED": "false"}), \
                 patch.object(main, "verify_token", side_effect=lambda _: claims), \
                 patch.object(main, "_gemini", side_effect=mocked_gemini), \
                 patch.object(main, "_generate_conversation_title", new=AsyncMock(return_value="A pet conversation")), \
                 patch.object(main, "process_one_pending_extraction", new=AsyncMock(return_value=([], set(), {"saved": 0}))):
                with TestClient(main.app) as client:
                    headers = {"Authorization": "Bearer unit-test-token"}
                    self.assertEqual(client.get("/auth/me").status_code, 200)
                    self.assertEqual(client.put("/memory-settings", json={"automatic_enabled": True}).status_code, 200)
                    conversation_a = client.post("/conversations", json={"title": "Original"}).json()["id"]
                    fact = client.post("/memories", json={"content": "My dog's name is Miso.", "category": "relationships", "retention_days": 30})
                    self.assertEqual(fact.status_code, 200)
                    fact_id = fact.json()["id"]
                    sensitive = client.post("/memories", json={"content": "My dog's name is SensitiveTest.", "category": "relationships", "sensitive": True, "consent": True, "retention_days": 30})
                    expired = client.post("/memories", json={"content": "My dog's name is ExpiredTest.", "category": "relationships", "retention_days": 30})
                    deleted = client.post("/memories", json={"content": "My dog's name is DeletedTest.", "category": "relationships", "retention_days": 30})
                    self.assertTrue(all(result.status_code == 200 for result in (sensitive, expired, deleted)))
                    expired_id = uuid.UUID(expired.json()["id"])
                    with Session(self.engine) as db:
                        stale = db.get(Memory, expired_id)
                        stale.expires_at = main.datetime.now(main.timezone.utc) - main.timedelta(seconds=1)
                        db.commit()
                    self.assertEqual(client.delete(f"/memories/{deleted.json()['id']}").status_code, 200)

                    claims["uid"] = uid_b
                    self.assertEqual(client.get("/auth/me").status_code, 200)
                    self.assertEqual(client.put("/memory-settings", json={"automatic_enabled": True}).status_code, 200)
                    foreign = client.post("/memories", json={"content": "My dog's name is OtherAccountTest.", "category": "relationships", "retention_days": 30})
                    self.assertEqual(foreign.status_code, 200)

                    claims["uid"] = uid_a
                    corrected = client.put(f"/memories/{fact_id}", json={"content": "My dog's name is Saffron.", "category": "relationships"})
                    self.assertEqual(corrected.status_code, 200)
                    fresh_conversation = client.post("/conversations", json={"title": "Fresh recall test"}).json()["id"]
                    response = client.post("/chat", headers=headers, json={"mode": "account", "message": "What's my dog's name?", "conversation_id": fresh_conversation})
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.json()["reply"], "My dog's name is Saffron.")
                    self.assertEqual(response.json()["conversation_id"], fresh_conversation)
                    self.assertEqual(captured[-1][1], "What's my dog's name?")
                    self.assertEqual(captured[-1][0], ["My dog's name is Saffron."])
                    self.assertNotIn("SensitiveTest", str(captured[-1][0]))
                    self.assertNotIn("ExpiredTest", str(captured[-1][0]))
                    self.assertNotIn("DeletedTest", str(captured[-1][0]))
                    self.assertNotIn("OtherAccountTest", str(captured[-1][0]))
        finally:
            main.app.dependency_overrides.pop(verified_firebase_claims, None)
            main.app.dependency_overrides.pop(verified_firebase_uid, None)
            with Session(self.engine) as db:
                ids = list(db.scalars(select(User.id).where(User.firebase_uid.in_([uid_a, uid_b]))))
                if ids:
                    db.execute(delete(User).where(User.id.in_(ids)))
                    db.commit()

    def test_conversation_title_persists_falls_back_and_preserves_manual_rename_race(self):
        uid = "conversation-title-" + uuid.uuid4().hex
        claims = {"uid": uid, "email": None, "name": None, "email_verified": True}
        main.app.dependency_overrides[verified_firebase_claims] = lambda: claims
        main.app.dependency_overrides[verified_firebase_uid] = lambda: uid

        async def generate_after_manual_rename(message):
            with Session(self.engine) as independent_db:
                user = independent_db.scalar(select(User).where(User.firebase_uid == uid))
                conversation = independent_db.scalar(select(Conversation).where(Conversation.user_id == user.id).order_by(Conversation.created_at.desc()))
                conversation.title = "A title chosen by me"
                independent_db.commit()
            return "Generated topic title"

        try:
            with patch.dict(os.environ, {"PGVECTOR_ENABLED": "false"}), \
                 patch.object(main, "verify_token", return_value=claims), \
                 patch.object(main, "_gemini", new=AsyncMock(return_value="A supportive reply.")), \
                 patch.object(main, "process_one_pending_extraction", new=AsyncMock(return_value=([], set(), {"saved": 0}))):
                with TestClient(main.app) as client:
                    self.assertEqual(client.get("/auth/me").status_code, 200)
                    headers = {"Authorization": "Bearer title-test-token"}
                    generated = client.post("/conversations", json={"title": "New conversation"}).json()
                    with patch.object(main, "_generate_conversation_title", new=AsyncMock(return_value="A friendship at work")):
                        response = client.post("/chat", headers=headers, json={"mode": "account", "message": "I had a difficult day with a friend at work.", "conversation_id": generated["id"]})
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.json()["conversation"]["title"], "A friendship at work")
                    saved_titles = [item["title"] for item in client.get("/conversations").json()]
                    self.assertIn("A friendship at work", saved_titles)

                    manual = client.post("/conversations", json={"title": "New conversation"}).json()
                    with patch.object(main, "_generate_conversation_title", side_effect=generate_after_manual_rename):
                        race_response = client.post("/chat", headers=headers, json={"mode": "account", "message": "I am thinking through a personal topic.", "conversation_id": manual["id"]})
                    self.assertEqual(race_response.status_code, 200)
                    self.assertEqual(race_response.json()["conversation"]["title"], "A title chosen by me")

                    fallback = client.post("/conversations", json={"title": "New conversation"}).json()
                    with patch.object(main, "_generate_conversation_title", side_effect=RuntimeError("title provider unavailable")):
                        fallback_response = client.post("/chat", headers=headers, json={"mode": "account", "message": "Let's talk about a hobby.", "conversation_id": fallback["id"]})
                    self.assertEqual(fallback_response.status_code, 200)
                    self.assertEqual(fallback_response.json()["reply"], "A supportive reply.")
                    self.assertEqual(fallback_response.json()["conversation"]["title"], main.FALLBACK_CONVERSATION_TITLE)
        finally:
            main.app.dependency_overrides.pop(verified_firebase_claims, None)
            main.app.dependency_overrides.pop(verified_firebase_uid, None)
            with Session(self.engine) as db:
                user = db.scalar(select(User).where(User.firebase_uid == uid))
                if user:
                    db.delete(user)
                    db.commit()

    def test_automatic_academic_project_memory_recalled_by_broad_work_question(self):
        uid = "academic-recall-" + uuid.uuid4().hex
        claims = {"uid": uid, "email": None, "name": None, "email_verified": True}
        captured = []
        main.app.dependency_overrides[verified_firebase_claims] = lambda: claims
        main.app.dependency_overrides[verified_firebase_uid] = lambda: uid

        class ProviderResponse:
            def raise_for_status(self): pass
            def json(self):
                candidate = {
                    "content": "My final-year project is about crop disease detection.",
                    "category": "open_threads", "sensitive": False, "confidence": .99,
                    "evidence": "I'm working on a final-year project about crop disease detection.",
                }
                return {"candidates": [{"content": {"parts": [{"text": json.dumps({"memories": [candidate]})}]}}]}

        class ExtractionClient:
            async def __aenter__(self): return self
            async def __aexit__(self, *_): return None
            async def post(self, *_args, **_kwargs): return ProviderResponse()

        async def mocked_gemini(messages, memories=(), past_excerpts=(), followup=None, display_name=None):
            facts = [memory.content for memory in memories]
            captured.append((messages[-1]["content"], facts))
            return "I remember your crop disease detection project." if facts else "I don't have that detail."

        try:
            with patch.dict(os.environ, {"PGVECTOR_ENABLED": "false"}), \
                 patch.object(main, "verify_token", return_value=claims), \
                 patch.object(main, "_gemini", side_effect=mocked_gemini), \
                 patch.object(main, "_generate_conversation_title", new=AsyncMock(return_value="Academic project")), \
                 patch.object(memory_service.httpx, "AsyncClient", return_value=ExtractionClient()):
                with TestClient(main.app) as client:
                    headers = {"Authorization": "Bearer synthetic-academic-test"}
                    self.assertEqual(client.put("/memory-settings", json={"automatic_enabled": True}).status_code, 200)
                    first_thread = client.post("/conversations", json={"title": "New conversation"}).json()["id"]
                    main._rate_buckets["testclient"].clear()
                    first = client.post("/chat", headers=headers, json={"mode": "account", "message": "I'm working on a final-year project about crop disease detection.", "conversation_id": first_thread})
                    self.assertEqual(first.status_code, 200)
                    self.assertEqual(first.json()["memory_notice"], "A detail was saved to What Buddy remembers.")
                    saved = client.get("/memories").json()
                    self.assertEqual(len(saved), 1)
                    self.assertEqual(saved[0]["content"], "My final-year project is about crop disease detection.")
                    self.assertEqual(saved[0]["category"], "open_threads")

                    def ask(question):
                        conversation_id = client.post("/conversations", json={"title": "New conversation"}).json()["id"]
                        main._rate_buckets["testclient"].clear()
                        return client.post("/chat", headers=headers, json={"mode": "account", "message": question, "conversation_id": conversation_id})

                    broad = ask("What do you remember about my work?")
                    self.assertEqual(broad.status_code, 200)
                    self.assertEqual(captured[-1], ("What do you remember about my work?", [saved[0]["content"]]))
                    academic = ask("What do you know about my academic record?")
                    self.assertEqual(academic.status_code, 200)
                    self.assertEqual(captured[-1][1], [saved[0]["content"]])
                    unrelated = ask("What's my cat's name?")
                    self.assertEqual(unrelated.status_code, 200)
                    self.assertEqual(captured[-1][1], [])

                    employment = client.post("/memories", json={"content": "I work as a nurse at a clinic.", "category": "user_profile", "retention_days": 30})
                    self.assertEqual(employment.status_code, 200)
                    ambiguous = ask("What do you remember about my work?")
                    self.assertEqual(ambiguous.status_code, 200)
                    self.assertCountEqual(captured[-1][1], [saved[0]["content"], "I work as a nurse at a clinic."])
                    self.assertIn("both employment and an academic project", main.SYSTEM)
        finally:
            main.app.dependency_overrides.pop(verified_firebase_claims, None)
            main.app.dependency_overrides.pop(verified_firebase_uid, None)
            with Session(self.engine) as db:
                user = db.scalar(select(User).where(User.firebase_uid == uid))
                if user:
                    db.delete(user)
                    db.commit()

    def test_automatic_cross_chat_memory_retries_corrects_and_stays_deleted(self):
        uid = "automatic-memory-" + uuid.uuid4().hex
        claims = {"uid": uid, "email": None, "name": None, "email_verified": True}
        main.app.dependency_overrides[verified_firebase_claims] = lambda: claims
        main.app.dependency_overrides[verified_firebase_uid] = lambda: uid
        captured = []

        class ProviderResponse:
            def __init__(self, result=None, fail=False): self.result = result; self.fail = fail
            def raise_for_status(self):
                if self.fail: raise httpx.ConnectError("provider unavailable")
            def json(self): return self.result

        class ExtractionClient:
            fail_next = True
            async def __aenter__(self): return self
            async def __aexit__(self, *_): return None
            async def post(self, _url, **kwargs):
                if self.fail_next:
                    self.fail_next = False
                    return ProviderResponse(fail=True)
                payload = kwargs["json"]
                request_data = json.loads(payload["contents"][0]["parts"][0]["text"])
                utterance = request_data["conversation"][-1]["content"]
                existing = request_data["existing_memories"]
                item = None
                if "renamed my cat to piku" in utterance.casefold():
                    item = {"content": "My cat's name is Piku", "category": "relationships", "sensitive": False, "confidence": .99, "evidence": "I renamed my cat to Piku."}
                    if existing: item["replaces_memory_id"] = existing[0]["id"]
                elif "my cat's name is prii" in utterance.casefold():
                    item = {"content": "My cat's name is Prii", "category": "relationships", "sensitive": False, "confidence": .99, "evidence": "My cat's name is Prii"}
                generated = {"memories": [item] if item else []}
                return ProviderResponse({"candidates": [{"content": {"parts": [{"text": json.dumps(generated)}]}}]})
        async def mocked_gemini(messages, memories=(), past_excerpts=(), followup=None, display_name=None):
            facts = [memory.content for memory in memories]
            captured.append((messages[-1]["content"], facts))
            return next((fact for fact in facts if "cat's name" in fact), "I don't have your cat's name yet.")

        try:
            with patch.dict(os.environ, {"PGVECTOR_ENABLED": "false"}), \
                 patch.object(main, "verify_token", return_value=claims), \
                 patch.object(main, "_gemini", side_effect=mocked_gemini), \
                 patch.object(main, "_generate_conversation_title", new=AsyncMock(return_value="A cat conversation")), \
                 patch.object(memory_service.httpx, "AsyncClient", return_value=ExtractionClient()):
                with TestClient(main.app) as client:
                    headers = {"Authorization": "Bearer automatic-memory-test"}
                    self.assertEqual(client.get("/auth/me").status_code, 200)
                    self.assertEqual(client.put("/memory-settings", json={"automatic_enabled": True}).status_code, 200)
                    first_thread = client.post("/conversations", json={"title": "New conversation"}).json()["id"]
                    first = client.post("/chat", headers=headers, json={"mode": "account", "message": "My cat's name is Prii", "conversation_id": first_thread})
                    self.assertEqual(first.status_code, 200)
                    self.assertEqual(first.json()["reply"], "I don't have your cat's name yet.")
                    # The provider failed: nothing is saved, the user is told it will retry, and
                    # the message stays pending (no completion marker) instead of being lost.
                    self.assertIn("will retry", first.json()["memory_notice"])
                    self.assertEqual(client.get("/memories").json(), [])

                    recall_thread = client.post("/conversations", json={"title": "New conversation"}).json()["id"]
                    recalled = client.post("/chat", headers=headers, json={"mode": "account", "message": "What's my cat's name?", "conversation_id": recall_thread})
                    self.assertEqual(recalled.status_code, 200)
                    self.assertEqual(recalled.json()["reply"], "My cat's name is Prii")
                    self.assertEqual(captured[-1], ("What's my cat's name?", ["My cat's name is Prii"]))
                    self.assertEqual(recalled.json()["memory_notice"], "A detail was saved to What Buddy remembers.")
                    listed = client.get("/memories").json()
                    self.assertEqual(len(listed), 1)
                    memory_id = listed[0]["id"]
                    self.assertEqual(listed[0]["source"], "learned_from_chat")

                    correction = client.post("/chat", headers=headers, json={"mode": "account", "message": "I renamed my cat to Piku.", "conversation_id": first_thread})
                    self.assertEqual(correction.status_code, 200)
                    self.assertEqual(client.get("/memories").json()[0]["content"], "My cat's name is Piku")
                    fresh = client.post("/conversations", json={"title": "New conversation"}).json()["id"]
                    piku = client.post("/chat", headers=headers, json={"mode": "account", "message": "What's my cat's name?", "conversation_id": fresh})
                    self.assertEqual(piku.status_code, 200)
                    self.assertEqual(piku.json()["reply"], "My cat's name is Piku")
                    self.assertEqual(captured[-1], ("What's my cat's name?", ["My cat's name is Piku"]))

                    self.assertEqual(client.delete(f"/memories/{memory_id}").status_code, 200)
                    # Simulate replaying recent history after a worker restart. The
                    # persisted tombstones must prevent both Prii and Piku returning.
                    with Session(self.engine) as db:
                        user = db.scalar(select(User).where(User.firebase_uid == uid))
                        user_messages = list(db.scalars(select(Message).join(Conversation, Conversation.id == Message.conversation_id).where(Conversation.user_id == user.id, Message.role == "user")))
                        for message in user_messages:
                            db.execute(delete(MemoryEvent).where(MemoryEvent.user_id == user.id, MemoryEvent.event_type == "extraction_completed", MemoryEvent.event_metadata["message_id"].astext == str(message.id)))
                        db.commit()
                    replay_thread = client.post("/conversations", json={"title": "New conversation"}).json()["id"]
                    first_replay = client.post("/chat", headers=headers, json={"mode": "account", "message": "What's my cat's name?", "conversation_id": replay_thread})
                    self.assertEqual(first_replay.status_code, 200)
                    self.assertEqual(captured[-1], ("What's my cat's name?", []))
                    second_replay = client.post("/chat", headers=headers, json={"mode": "account", "message": "Please check my cat's name again.", "conversation_id": replay_thread})
                    self.assertEqual(second_replay.status_code, 200)
                    self.assertEqual(captured[-1][1], [])
                    self.assertEqual(client.get("/memories").json(), [])
        finally:
            main.app.dependency_overrides.pop(verified_firebase_claims, None)
            main.app.dependency_overrides.pop(verified_firebase_uid, None)
            with Session(self.engine) as db:
                user = db.scalar(select(User).where(User.firebase_uid == uid))
                if user:
                    db.delete(user)
                    db.commit()


if __name__ == "__main__": unittest.main()


