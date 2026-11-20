# Buddy v3 migration status

## Status: incomplete

Supabase runtime paths have been removed. Firebase-authenticated conversation and manual/automatic memory paths now use PostgreSQL. The database is reachable and was advanced through `0003_memory_metadata`. The pgvector server extension is absent, so `0004_pgvector` and semantic search remain pending; the application uses lexical retrieval while `PGVECTOR_ENABLED=false`.

## Implemented

- Firebase Admin verifies bearer ID tokens; bad tokens return 401 and Firebase configuration/verification outages return 503. Authenticated routes resolve a PostgreSQL user from the verified Firebase UID.
- Conversation CRUD, ownership checks, paginated history and account chat use SQLAlchemy. Gemini failures occur before persistence; successful user/assistant turns commit together. Request IDs make a repeated request return its saved assistant response. Quick Chat is unauthenticated and does not persist messages.
- Memory is disabled by default and requires an active consent record. Manual CRUD, sensitive-memory consent, expiry, delete-one/delete-all and opt-out behavior are PostgreSQL-backed.
- Memory extraction uses Pydantic-validated structured output, exact user-message evidence, confidence thresholding, sensitivity checks, duplicate/contradiction checks, retention rules and conversation provenance. Non-sensitive automatic saves require opt-in; sensitive candidates are returned for explicit approval. Extraction runs inline after chat commit and is best effort, so a process crash may skip it.
- Basic retrieval is user-scoped, consent-gated and expiry-filtered. The fallback ranks lexical overlap and recency. Semantic retrieval uses `gemini-embedding-001` (768 dimensions), pgvector cosine distance plus metadata/recency scoring, and lexical fallback when enabled but unavailable.
- Backend follow-ups are limited to greetings and due, non-sensitive event/open-thread memories, with a one-week user cooldown and follow-up timestamp tracking.
- Added `/chat` process-local rate limiting, multilingual keyword safety checks and safe database/Firebase dependency error responses.

## Database status

- PostgreSQL connectivity: successful; local server reports PostgreSQL 18.7.
- Applied Alembic revision: `0003_memory_metadata`.
- Verified base tables: users, conversations, messages, preferences, memories, consents and events.
- An ORM insert/query smoke test created a temporary user, conversation, messages and memory inside a transaction, then rolled it back successfully.
- PostgreSQL-backed route integration passed for conversation creation, memory opt-in/save/retrieval, idempotent authenticated chat persistence, and cross-user conversation isolation. The test mocked Firebase token verification and Gemini generation; it used the real PostgreSQL database and cleaned up its rows.
- `alembic upgrade head` is currently blocked at `0004_pgvector`: PostgreSQL says extension `vector` is unavailable. The failed DDL was transactional; the database remains at `0003_memory_metadata`.

## Verification

- Backend tests: **21 passed** (Firebase token and 401/503 distinction, PostgreSQL route integration, retrieval ownership/fallback, extraction validation/consent, follow-up gating, English/Hindi/Hinglish and ambiguous-risk cases, Quick Chat crisis path).
- Python compile check: passed.
- Frontend production build and TypeScript check: passed in the preceding run; no subsequent frontend source edits were made.
- Live Firebase signup/token verification, Google sign-in and authenticated Firebase + PostgreSQL + Gemini end-to-end flow: unverified. Firebase Admin project credentials are present, but the frontend Firebase Web API key is absent from `frontend/.env.local`, so disposable Firebase signup could not start.
- A real Gemini Quick Chat request was attempted using the configured key but returned 502; direct provider access failed with a network `ConnectError`. Gemini account chat and embedding requests therefore remain unverified.
- Remaining Supabase runtime references: none. `backend/schema.sql` remains as clearly labeled historical reference only.

## Remaining blockers

Install pgvector on the PostgreSQL 18 server, then apply head and enable semantic retrieval. The official pgvector Windows instructions use Visual Studio C++ build tools and an x64 Native Tools prompt; for PostgreSQL 18 set `PGROOT` to its install directory, clone/build/install pgvector, then enable `vector` in `buddy_db`. See [the official pgvector Windows installation notes](https://github.com/pgvector/pgvector#installation). After that set `PGVECTOR_ENABLED=true` in `backend/.env` and rerun migrations/tests.

Also outstanding: live Firebase/Gemini acceptance, coordinated Firebase/PostgreSQL account deletion, shared rate limiting for multi-worker deployment, and a stronger independent safety classifier. The current deterministic keyword filter is not clinically validated or intended for public crisis use.
