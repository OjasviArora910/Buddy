# Buddy v3 implementation checklist

- [x] Firebase web authentication and Firebase Admin token verification with 401/503 separation.
- [x] SQLAlchemy models and Alembic revisions for users, conversations, messages, preferences, memories, consent and events.
- [x] Firebase-provisioned PostgreSQL users; authenticated conversation CRUD, pagination and ownership checks.
- [x] Authenticated Gemini chat, atomic message/reply persistence and idempotency keys; unauthenticated non-persistent Quick Chat.
- [x] Manual PostgreSQL memory CRUD, per-memory sensitive consent, opt-in default-off automatic consent, expiry, deletion and user-scoped retrieval.
- [x] Structured Gemini memory candidate extraction with Pydantic validation, user-authored evidence checks, confidence, sensitivity, duplicate/contradiction guards, expiry and source references. Inline best-effort execution is documented.
- [x] PostgreSQL lexical retrieval fallback and pgvector semantic query code, with user filters, metadata scoring and embedding fallback.
- [x] Greeting-only, non-sensitive, due-event follow-ups with a one-week per-user cooldown and persisted follow-up timestamps.
- [x] In-process `/chat` request rate limit, safe database/Firebase error handling and multilingual keyword risk tests.
- [x] Removed Supabase runtime dependencies/settings/imports; historical SQL schema explicitly marked non-runtime.
- [x] Applied migrations through `0003_memory_metadata`; verified expected base tables, a rolled-back ORM insert/query smoke test, and PostgreSQL-backed route integration with chat idempotency and user isolation.
- [ ] Install pgvector server extension and apply `0004_pgvector`; current PostgreSQL 18.7 host reports the extension unavailable.
- [ ] Real Firebase + PostgreSQL + Gemini account end-to-end flow and Google OAuth acceptance.
- [ ] Coordinated Firebase/PostgreSQL account deletion workflow; production distributed rate limiting and stronger independent safety evaluation.

Do not report v3 complete until pgvector setup and the live authenticated account flow are verified. The keyword safety check is not clinically validated.
