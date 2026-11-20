# Buddy

Buddy is a calm AI emotional-support companion with **Quick Chat** (anonymous, no Buddy chat persistence) and **Your Buddy** (signed-in conversations and user-controlled memory). The product is for internal engineering testing only, not a therapist, crisis service, or clinically reviewed mental-health application.

## V3 migration status

Firebase authentication and PostgreSQL-backed chat, conversations and memory APIs are implemented. Supabase is no longer a runtime dependency. The local PostgreSQL database is at Alembic `0003_memory_metadata`; `0004_pgvector` is pending because the server extension is not installed. Firebase Web API configuration is also missing locally, and live Gemini requests currently fail with a network connection error. Do not treat this branch as a completed v3 release. See [the migration audit](docs/v3-migration-audit.md), [checklist](docs/v3-implementation-checklist.md), and [completion report](docs/v3-completion-report.md).

## Local setup

1. Configure a Firebase Web app and Firebase Admin credentials using [Firebase setup](docs/firebase-setup.md).
2. Install local PostgreSQL, create a least-privilege role, and configure `backend/.env` using [PostgreSQL setup](docs/postgresql-setup.md). Copy placeholders from `backend/.env.example`.
3. Install backend dependencies. Follow `docs/local-development.md` for the pgvector prerequisite; run `alembic upgrade head` from `backend` when the extension is installed, then start `uvicorn app.main:app --reload --port 8000`.
4. Copy `frontend/.env.example` to `frontend/.env.local`, fill in Firebase web identifiers (including the Web API key), run `npm install` and `npm run dev` in `frontend`.

Firebase frontend config consists of public identifiers. Firebase Admin credentials, database passwords, and Gemini keys are backend secrets. Never commit `.env` files or service-account JSON.

Quick Chat remains separate and does not persist Buddy chat records. No old Supabase data migration is planned; v3 starts fresh. Messages are sent to Gemini for inference. Avoid real sensitive information during internal tests.

## Safety and release boundary

The current risk routing is a prototype keyword fallback, not an independent multilingual safety classifier. Emergency resources and crisis workflows require clinical and locale-specific review before release. Do not deploy to public users.
