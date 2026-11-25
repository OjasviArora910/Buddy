"""End-to-end (PostgreSQL) tests: automatic learning, recall, follow-ups, consent and isolation.

Everything external is mocked: Firebase token verification, the chat model, the extraction
provider, and the clock. These are *mock* verifications, not live Gemini/Firebase checks.
"""
import json
import os
import unittest
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import httpx
from dotenv import load_dotenv
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.orm import Session

load_dotenv()
from app import main
from app.auth import firebase_auth
from app.db.models import Memory, MemoryEvent, Message, User
from app.db.session import make_engine
from app.services import memory as memory_service

CAT = "My cat Prii has been unwell"
CAT_QUESTION = "What do you know about my cat?"


def cat_script(utterance, existing):
    """Deterministic stand-in for the extraction model."""
    said = utterance.casefold()
    if "prii has been unwell" in said:
        return {"memories": [{"content": CAT, "category": "open_threads", "sensitive": False, "confidence": .95,
                              "evidence": CAT, "follow_up_question": "How is Prii doing now?"}]}
    if "better now" in said and existing:
        return {"memories": [], "resolutions": [{"memory_id": existing[0]["id"], "evidence": "Prii is better now"}]}
    if "fabricated recovery" in said and existing:
        return {"memories": [], "resolutions": [{"memory_id": existing[0]["id"], "evidence": "Prii recovered"}]}
    return {"memories": []}


class Harness:
    def __init__(self, engine):
        self.engine = engine
        self.claims_by_token = {}
        self.uids = []
        self.model_calls = []
        self.provider_requests = []
        self.provider_failures = 0
        self.script = cat_script
        self.now = datetime.now(timezone.utc)
        self.client = None

    def add_user(self, name=None, email="person@example.com", verified=True):
        uid = "learn-" + uuid.uuid4().hex
        token = "tok-" + uid
        self.claims_by_token[token] = {"uid": uid, "email": email, "name": name, "email_verified": verified, "aud": "x"}
        self.uids.append(uid)
        return token

    # --- HTTP helpers -------------------------------------------------------
    def _h(self, token):
        return {"Authorization": f"Bearer {token}"}

    def call(self, method, path, token, **kwargs):
        main._rate_buckets.clear()
        return self.client.request(method, path, headers=self._h(token), **kwargs)

    def enable_memory(self, token):
        assert self.call("GET", "/auth/me", token).status_code == 200
        assert self.call("PUT", "/memory-settings", token, json={"automatic_enabled": True}).status_code == 200

    def conversation(self, token):
        return self.call("POST", "/conversations", token, json={"title": "New conversation"}).json()["id"]

    def chat(self, token, conversation_id, message):
        return self.call("POST", "/chat", token, json={"mode": "account", "message": message, "conversation_id": conversation_id})

    def say(self, token, message):
        """Send a message in a brand-new chat."""
        return self.chat(token, self.conversation(token), message)

    def last_model_call(self):
        return self.model_calls[-1]

    def memories(self, token):
        uid = self.claims_by_token[token]["uid"]
        with Session(self.engine) as db:
            user = db.scalar(select(User).where(User.firebase_uid == uid))
            rows = list(db.scalars(select(Memory).where(Memory.user_id == user.id)))
            db.expunge_all()
            return rows

    def edit_memory(self, token, **values):
        uid = self.claims_by_token[token]["uid"]
        with Session(self.engine) as db:
            user = db.scalar(select(User).where(User.firebase_uid == uid))
            memory = db.scalar(select(Memory).where(Memory.user_id == user.id))
            for key, value in values.items():
                setattr(memory, key, value)
            db.commit()


@contextmanager
def harness(engine):
    h = Harness(engine)

    def verify(token):
        if token not in h.claims_by_token:
            raise HTTPException(401, "Invalid or expired Firebase token")
        return h.claims_by_token[token]

    async def model(messages, memories=(), past_excerpts=(), followup=None, display_name=None):
        h.model_calls.append({"messages": [m["content"] for m in messages], "memories": [m.content for m in memories],
                              "excerpts": [e["content"] for e in past_excerpts],
                              "followup": followup.follow_up_question if followup else None,
                              "display_name": display_name})
        return "mock reply"

    class Response:
        def __init__(self, result=None, fail=False): self.result, self.fail = result, fail
        def raise_for_status(self):
            if self.fail: raise httpx.ConnectError("provider unavailable")
        def json(self): return self.result

    class Provider:
        async def __aenter__(self): return self
        async def __aexit__(self, *_): return None
        async def post(self, _url, **kwargs):
            data = json.loads(kwargs["json"]["contents"][0]["parts"][0]["text"])
            h.provider_requests.append(data)
            if h.provider_failures:
                h.provider_failures -= 1
                return Response(fail=True)
            result = h.script(data["conversation"][-1]["content"], data["existing_memories"])
            return Response({"candidates": [{"content": {"parts": [{"text": json.dumps(result)}]}}]})

    with patch.dict(os.environ, {"PGVECTOR_ENABLED": "false", "GEMINI_API_KEY": "test-key"}), \
         patch.object(firebase_auth, "verify_token", side_effect=verify), \
         patch.object(main, "verify_token", side_effect=verify), \
         patch.object(main, "_gemini", side_effect=model), \
         patch.object(main, "_generate_conversation_title", new=AsyncMock(return_value="A chat")), \
         patch.object(main, "_now", side_effect=lambda: h.now), \
         patch.object(memory_service.httpx, "AsyncClient", return_value=Provider()):
        with TestClient(main.app) as client:
            h.client = client
            try:
                yield h
            finally:
                with Session(engine) as db:
                    for user in db.scalars(select(User).where(User.firebase_uid.in_(h.uids))):
                        db.delete(user)
                    db.commit()


class LearningAndFollowUpTests(unittest.TestCase):
    def setUp(self):
        try:
            self.engine = make_engine()
            with self.engine.connect() as connection: connection.execute(text("select 1"))
        except Exception as exc:
            self.skipTest(f"PostgreSQL unavailable ({type(exc).__name__})")

    def learn_cat(self, h, token):
        """Chat A: the user simply talks; no Memories page, no 'remember this'."""
        chat_a = h.conversation(token)
        sent = h.chat(token, chat_a, CAT)
        self.assertEqual(sent.status_code, 200)
        return chat_a, sent

    # --- 1. automatic learning and cross-chat recall ---------------------------
    def test_cat_is_learned_from_ordinary_chat_and_recalled_in_a_fresh_chat(self):
        with harness(self.engine) as h:
            a = h.add_user(); h.enable_memory(a)
            _, sent = self.learn_cat(h, a)
            self.assertEqual(sent.json()["memory_notice"], "A detail was saved to What Buddy remembers.")
            # Chat A's own model call saw only the current message and no saved facts.
            self.assertEqual(h.model_calls[0], {"messages": [CAT], "memories": [], "excerpts": [], "followup": None, "display_name": None})
            # The provider was asked about the user's own words only, never assistant text.
            self.assertEqual(h.provider_requests[0]["conversation"], [{"role": "user", "content": CAT}])

            saved = h.memories(a)  # read straight from the DB; the Memories page was never opened
            self.assertEqual([(m.content, m.category, m.sensitivity, m.status) for m in saved], [(CAT, "open_threads", "non_sensitive", "active")])
            self.assertEqual(saved[0].source_reason, "Learned from chat")
            self.assertIsNotNone(saved[0].source_conversation_id)
            self.assertEqual(saved[0].follow_up_question, "How is Prii doing now?")
            with Session(self.engine) as db:
                done = db.scalar(select(MemoryEvent).where(MemoryEvent.event_type == "extraction_completed", MemoryEvent.user_id == saved[0].user_id))
                self.assertIsNotNone(done)
                self.assertNotIn("Prii", json.dumps(done.event_metadata))  # completion marker stores ids/counts, not text

            # Chat B (fresh): direct recall question gets exactly the saved fact, no transcript, no duplicate excerpt.
            h.say(a, CAT_QUESTION)
            self.assertEqual(h.last_model_call(), {"messages": [CAT_QUESTION], "memories": [CAT], "excerpts": [], "followup": None, "display_name": None})

    def test_extraction_is_idempotent_and_retryable_after_a_provider_failure(self):
        with harness(self.engine) as h:
            a = h.add_user(); h.enable_memory(a)
            h.provider_failures = 1
            _, sent = self.learn_cat(h, a)
            self.assertIn("will retry", sent.json()["memory_notice"])
            self.assertEqual(h.memories(a), [])  # nothing saved, nothing invented

            # The next signed-in chat retries the pending message (before retrieval, so it helps this very reply).
            h.say(a, CAT_QUESTION)
            self.assertEqual(h.last_model_call()["memories"], [CAT])
            self.assertEqual(len(h.memories(a)), 1)
            # More chats never re-process or duplicate it.
            h.say(a, "Thanks"); h.say(a, "Hello again")
            self.assertEqual(len(h.memories(a)), 1)
            with Session(self.engine) as db:
                cat_message = db.scalar(select(Message).where(Message.content == CAT, Message.role == "user"))
                finished = list(db.scalars(select(MemoryEvent).where(MemoryEvent.event_type == "extraction_completed", MemoryEvent.event_metadata["message_id"].astext == str(cat_message.id))))
                self.assertEqual(len(finished), 1)

    def test_retry_rechecks_consent_and_deletion_before_saving(self):
        with harness(self.engine) as h:
            a = h.add_user(); h.enable_memory(a)
            h.provider_failures = 1
            self.learn_cat(h, a)  # message persisted, extraction pending
            calls_before = len(h.provider_requests)
            # Memory is switched off: the retry must not call the provider or save anything.
            self.assertEqual(h.call("PUT", "/memory-settings", a, json={"automatic_enabled": False}).status_code, 200)
            h.say(a, "Hello"); h.say(a, "Hello")
            self.assertEqual(len(h.provider_requests), calls_before)
            self.assertEqual(h.memories(a), [])
            # Re-enabling is a new opt-in: earlier messages are never back-filled.
            self.assertEqual(h.call("PUT", "/memory-settings", a, json={"automatic_enabled": True}).status_code, 200)
            h.say(a, "Hello")
            self.assertEqual(h.memories(a), [])
            self.assertNotIn(CAT, json.dumps(h.provider_requests[calls_before:]))

        with harness(self.engine) as h:
            b = h.add_user(); h.enable_memory(b)
            h.provider_failures = 1
            self.learn_cat(h, b)  # pending
            # The user deletes that fact (tombstone) before the retry succeeds.
            uid = h.claims_by_token[b]["uid"]
            with Session(self.engine) as db:
                user = db.scalar(select(User).where(User.firebase_uid == uid))
                db.add(MemoryEvent(user_id=user.id, memory_id=None, event_type="deleted", event_metadata={"content_fingerprint": memory_service.content_fingerprint(CAT)}))
                db.commit()
            h.say(b, "Hello")
            self.assertEqual(h.memories(b), [])  # the retry saw the candidate but the tombstone blocked it

    # --- 2. follow-ups ---------------------------------------------------------
    def test_checkin_fires_once_and_is_skipped_for_cooldown_repeat_and_direct_questions(self):
        with harness(self.engine) as h:
            a = h.add_user(); h.enable_memory(a)
            self.learn_cat(h, a)
            t0 = h.now

            h.now = t0 + timedelta(days=1)  # not due yet (due after 7 days)
            h.say(a, "Hi")
            self.assertIsNone(h.last_model_call()["followup"])

            h.now = t0 + timedelta(days=8)
            h.say(a, CAT_QUESTION)  # a direct question gets the answer context, never a check-in
            self.assertIsNone(h.last_model_call()["followup"])
            self.assertEqual(h.last_model_call()["memories"], [CAT])
            h.say(a, "What is the capital of France?")  # unrelated direct question
            self.assertIsNone(h.last_model_call()["followup"])
            self.assertEqual(h.last_model_call()["memories"], [])

            h.say(a, "Hi Buddy")  # a greeting is the opening
            call = h.last_model_call()
            self.assertEqual((call["followup"], call["memories"]), ("How is Prii doing now?", [CAT]))
            self.assertEqual(h.memories(a)[0].last_followed_up_at, t0 + timedelta(days=8))

            h.now = t0 + timedelta(days=8, hours=2)  # repeated greeting, new chat
            h.say(a, "Hello!")
            self.assertIsNone(h.last_model_call()["followup"])
            h.now = t0 + timedelta(days=20)  # cooldown over, but the same check-in is never repeated
            h.say(a, "Hey")
            self.assertIsNone(h.last_model_call()["followup"])

    def test_cooldown_applies_across_chats_and_different_situations(self):
        with harness(self.engine) as h:
            a = h.add_user(); h.enable_memory(a)
            self.learn_cat(h, a)
            t0 = h.now
            uid = h.claims_by_token[a]["uid"]
            with Session(self.engine) as db:
                user = db.scalar(select(User).where(User.firebase_uid == uid))
                db.add(Memory(user_id=user.id, content="My sister's exam results are due", category="open_threads", source_reason="Learned from chat",
                              follow_up_question="How did your sister's exam go?", follow_up_after=t0 + timedelta(days=9),
                              last_mentioned_at=t0, expires_at=t0 + timedelta(days=90)))
                db.commit()
            h.now = t0 + timedelta(days=9)
            h.say(a, "Hi")
            self.assertEqual(h.last_model_call()["followup"], "How is Prii doing now?")  # oldest due situation first
            h.now = t0 + timedelta(days=10)
            h.say(a, "Hi")  # second situation is due but the 7-day cooldown (across chats) holds
            self.assertIsNone(h.last_model_call()["followup"])
            h.now = t0 + timedelta(days=17)
            h.say(a, "Hi")
            self.assertEqual(h.last_model_call()["followup"], "How did your sister's exam go?")

    def test_checkin_stops_when_resolved_stale_or_deleted_and_never_infers_recovery(self):
        with harness(self.engine) as h:  # resolved by the user's own words
            a = h.add_user(); h.enable_memory(a)
            self.learn_cat(h, a)
            t0 = h.now
            h.say(a, "Prii is better now")
            row = h.memories(a)[0]
            self.assertEqual((row.status, row.follow_up_question), ("resolved", None))
            self.assertIsNotNone(row.resolved_at)
            h.now = t0 + timedelta(days=8)
            h.say(a, "Hi")
            self.assertIsNone(h.last_model_call()["followup"])
            self.assertEqual(h.last_model_call()["memories"], [])  # a resolved situation is no longer active context

        with harness(self.engine) as h:  # the model proposes a recovery the user never stated
            a = h.add_user(); h.enable_memory(a)
            self.learn_cat(h, a)
            h.say(a, "this is a fabricated recovery test")
            self.assertEqual(h.memories(a)[0].status, "active")
            h.now = h.now + timedelta(days=8)
            h.say(a, "Hi")
            self.assertEqual(h.last_model_call()["followup"], "How is Prii doing now?")

        with harness(self.engine) as h:  # stale: nothing mentioned it for more than 45 days
            a = h.add_user(); h.enable_memory(a)
            self.learn_cat(h, a)
            h.now = h.now + timedelta(days=46)
            h.say(a, "Hi")
            self.assertIsNone(h.last_model_call()["followup"])

        with harness(self.engine) as h:  # deleted
            a = h.add_user(); h.enable_memory(a)
            self.learn_cat(h, a)
            memory_id = str(h.memories(a)[0].id)
            self.assertEqual(h.call("DELETE", f"/memories/{memory_id}", a).status_code, 200)
            h.now = h.now + timedelta(days=8)
            h.say(a, "Hi")
            self.assertIsNone(h.last_model_call()["followup"])
            self.assertEqual(h.last_model_call()["memories"], [])

    # --- 3/5. consent, expiry, deletion, quick chat, second account -----------
    def test_memory_off_quick_chat_second_account_expiry_and_deletion_limit_model_context(self):
        with harness(self.engine) as h:
            a = h.add_user(); h.enable_memory(a)
            self.learn_cat(h, a)

            # Second account (memory on) never receives the first account's facts or chats.
            b = h.add_user(); h.enable_memory(b)
            h.say(b, CAT_QUESTION)
            self.assertEqual(h.last_model_call(), {"messages": [CAT_QUESTION], "memories": [], "excerpts": [], "followup": None, "display_name": None})

            # Memory off (a third account that never opted in): nothing learned, nothing recalled.
            c = h.add_user()
            assert h.call("GET", "/auth/me", c).status_code == 200
            requests_before = len(h.provider_requests)
            off = h.say(c, CAT)
            self.assertEqual(off.json()["memory_notice"], "Memory is disabled.")
            self.assertEqual(h.last_model_call()["memories"], [])
            h.say(c, CAT_QUESTION)
            self.assertEqual((h.last_model_call()["memories"], h.last_model_call()["excerpts"]), ([], []))
            self.assertEqual(len(h.provider_requests), requests_before)
            self.assertEqual(h.memories(c), [])

            # Quick Chat: anonymous, one message, no memories/excerpts/name, nothing persisted.
            with Session(self.engine) as db:
                messages_before = db.scalar(select(text("count(*)")).select_from(Message))
            main._rate_buckets.clear()
            quick = h.client.post("/chat", json={"mode": "quick", "message": CAT_QUESTION})
            self.assertEqual(quick.status_code, 200)
            self.assertIsNone(quick.json()["conversation_id"])
            self.assertEqual(h.last_model_call(), {"messages": [CAT_QUESTION], "memories": [], "excerpts": [], "followup": None, "display_name": None})
            with Session(self.engine) as db:
                self.assertEqual(db.scalar(select(text("count(*)")).select_from(Message)), messages_before)

            # Expiry: an expired fact (and its source chat) is not recalled, even before the page is opened.
            h.edit_memory(a, expires_at=datetime.now(timezone.utc) - timedelta(seconds=1))
            h.say(a, CAT_QUESTION)
            self.assertEqual((h.last_model_call()["memories"], h.last_model_call()["excerpts"]), ([], []))

        with harness(self.engine) as h:  # deletion forgets the fact and its source transcript
            a = h.add_user(); h.enable_memory(a)
            self.learn_cat(h, a)
            self.assertEqual(h.call("DELETE", f"/memories/{h.memories(a)[0].id}", a).status_code, 200)
            h.say(a, CAT_QUESTION)
            self.assertEqual((h.last_model_call()["memories"], h.last_model_call()["excerpts"]), ([], []))
            self.assertEqual(h.memories(a), [])

    # --- 4. account name -------------------------------------------------------
    def test_display_name_comes_only_from_the_trusted_profile_never_the_email(self):
        with harness(self.engine) as h:
            named = h.add_user(name="Asha Rao", email="someone.else@example.com")
            h.say(named, "Hello there")
            self.assertEqual(h.last_model_call()["display_name"], "Asha Rao")

            anonymous_name = h.add_user(name=None, email="priya.sharma@example.com")
            h.say(anonymous_name, "Hello there")
            self.assertIsNone(h.last_model_call()["display_name"])
            uid = h.claims_by_token[anonymous_name]["uid"]
            with Session(self.engine) as db:
                self.assertIsNone(db.scalar(select(User.display_name).where(User.firebase_uid == uid)))

    # --- 3. verified email, enforced server-side ---------------------------------
    def test_unverified_email_is_blocked_on_account_chat_and_memory_routes_but_not_quick_chat(self):
        with harness(self.engine) as h:
            token = h.add_user(verified=False)
            for method, path, body in [("GET", "/conversations", None), ("POST", "/conversations", {"title": "x"}),
                                       ("GET", "/memories", None), ("GET", "/memory-settings", None),
                                       ("PUT", "/memory-settings", {"automatic_enabled": True}), ("DELETE", "/memories", None),
                                       ("GET", "/auth/me", None),
                                       ("POST", "/chat", {"mode": "account", "message": "hi", "conversation_id": str(uuid.uuid4())})]:
                response = h.call(method, path, token, **({"json": body} if body is not None else {}))
                self.assertEqual(response.status_code, 403, (method, path))
                self.assertIn("Verify your email", response.json()["detail"])
            with Session(self.engine) as db:  # the blocked requests created no account rows
                self.assertIsNone(db.scalar(select(User.id).where(User.firebase_uid == h.claims_by_token[token]["uid"])))
            main._rate_buckets.clear()
            self.assertEqual(h.client.post("/chat", json={"mode": "quick", "message": "hello"}).status_code, 200)

            # After the user verifies, a refreshed ID token carries email_verified=true and the same routes open.
            h.claims_by_token[token] = {**h.claims_by_token[token], "email_verified": True}
            self.assertEqual(h.call("GET", "/memories", token).status_code, 200)
            self.assertEqual(h.call("GET", "/auth/me", token).status_code, 200)

    # --- parallel first requests ---------------------------------------------------
    def test_parallel_first_requests_for_a_new_user_do_not_fail_with_500(self):
        uid = "learn-race-" + uuid.uuid4().hex
        claims = {"uid": uid, "email": "race@example.com", "name": None, "email_verified": True}
        try:
            with Session(self.engine) as winner:  # another request already created the account
                main._provision_user(winner, claims)
            with Session(self.engine) as loser:
                real_scalar = loser.scalar
                calls = {"n": 0}

                def stale_first_read(*args, **kwargs):
                    calls["n"] += 1
                    return None if calls["n"] == 1 else real_scalar(*args, **kwargs)  # this request read before the winner committed

                with patch.object(loser, "scalar", side_effect=stale_first_read):
                    user = main._provision_user(loser, claims)
                self.assertEqual(user.firebase_uid, uid)
            from app.api import auth as auth_api
            with Session(self.engine) as loser:
                real_scalar = loser.scalar
                calls = {"n": 0}

                def stale_first_read_again(*args, **kwargs):
                    calls["n"] += 1
                    return None if calls["n"] == 1 else real_scalar(*args, **kwargs)

                with patch.object(loser, "scalar", side_effect=stale_first_read_again):
                    self.assertEqual(auth_api._provision(loser, uid, claims).firebase_uid, uid)
            with Session(self.engine) as db:
                self.assertEqual(len(list(db.scalars(select(User).where(User.firebase_uid == uid)))), 1)
        finally:
            with Session(self.engine) as db:
                for user in db.scalars(select(User).where(User.firebase_uid == uid)):
                    db.delete(user)
                db.commit()


if __name__ == "__main__":
    unittest.main()
