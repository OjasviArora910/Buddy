# Buddy v3 migration audit

## Current runtime paths

- Frontend authentication lives in `frontend/lib/firebase.ts`, `frontend/lib/auth.ts`, and the login/signup screens. Authenticated API requests use Firebase ID tokens.
- Firebase Admin token verification is in `backend/app/auth/firebase_auth.py`; profiles are provisioned through `backend/app/api/auth.py` and shared FastAPI dependencies.
- `backend/app/main.py` provides PostgreSQL-backed conversations, messages, chat, settings and manual memory APIs using existing SQLAlchemy models.
- Memory extraction, retrieval and follow-up selection are in `backend/app/services/memory.py`.
- Alembic revisions are `0001_initial`, `0002_memory`, `0003_memory_metadata`, and `0004_pgvector`.

## Supabase audit

No Supabase runtime imports, dependencies, API calls, environment variables, or frontend helper remain. `backend/schema.sql` is retained as historical reference only and is not read or applied by Buddy v3. Historical migration reports may mention Supabase as the former backend.

## Current constraints

- Local PostgreSQL 18.7 is reachable. Revisions through `0003_memory_metadata` are applied and were smoke-tested with ORM inserts/queries inside a rolled-back transaction.
- The server has no pgvector extension files. Revision `0004_pgvector` is present but cannot be applied until the server extension is installed.
- Firebase and Gemini live authentication/chat tests depend on usable project credentials and are not equivalent to mocked unit tests.
- Chat rate limiting is in-process; production multi-worker deployments need a shared limiter.
- Safety detection is deterministic keyword matching with prompt instructions. It is not clinically validated or suitable as a public crisis classifier.
