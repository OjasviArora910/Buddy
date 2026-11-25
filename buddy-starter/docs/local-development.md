# Local development

Use Python 3.11+, Node.js supported by Next.js 16, and local PostgreSQL. From `backend`, create/activate a virtual environment and install `pip install -r requirements.txt`. Copy `.env.example` to `.env`; set a PostgreSQL URL, the Firebase project ID, and Gemini API key. For keyless Firebase Admin authentication, leave `GOOGLE_APPLICATION_CREDENTIALS` blank and follow [Firebase setup](firebase-setup.md) to configure Google ADC. Set the same Firebase project ID in `frontend/.env.local`. The database URL must use `postgresql+psycopg://`.

Check connectivity without displaying credentials using `python scripts/check_database.py`. For the standard local setup, apply the base schema through `0003_memory_metadata` with `alembic upgrade 0003_memory_metadata`, then add the check-in columns with `alembic upgrade 0005_memory_followups` (use `alembic upgrade head` only once pgvector is installed). This supports conversations, manual memory, and user-scoped lexical retrieval without pgvector. Do not use `alembic stamp` to skip a migration. The optional pgvector installation and upgrade path is below. Then run `uvicorn app.main:app --reload --reload-dir app --port 8000`. From `frontend`, install with `npm install`, configure `.env.local` Firebase web identifiers and `NEXT_PUBLIC_API_URL`, then run `npm run dev` and open `http://localhost:3000`.

The optional `0004_pgvector` migration adds semantic embeddings. The current local server is PostgreSQL 18.7 and does not have pgvector server files, so leave `PGVECTOR_ENABLED=false` and remain at `0003_memory_metadata` until the extension is installed. Without pgvector the app uses lexical memory retrieval, and normal startup does not query the vector table. If the flag is enabled before the extension and migration exist, runtime checks keep vector operations disabled.

To add pgvector without Docker, install Visual Studio Build Tools with the C++ workload (including the MSVC C++ x64/x86 build tools and a Windows SDK), Git, and the server development headers for the exact PostgreSQL installation. Use the x64 Native Tools Command Prompt matching the installed Visual Studio version, opened as Administrator. These steps follow the [official pgvector Windows instructions](https://github.com/pgvector/pgvector#installation):

```cmd
set "PGROOT=C:\Program Files\PostgreSQL\18"
cd %TEMP%
git clone --branch v0.8.7 https://github.com/pgvector/pgvector.git
cd pgvector
nmake /F Makefile.win
nmake /F Makefile.win install
```

`PGROOT` must match the PostgreSQL 18 server installation used by the running service; do not build for a different major version or architecture. Before building, confirm the matching PostgreSQL server headers and import library exist under `PGROOT\include\server` and `PGROOT\lib\postgres.lib`. After installing the files, verify PostgreSQL can see them:

```powershell
psql -h localhost -p 5432 -U postgres -d buddy_db -c "SELECT name, default_version, installed_version FROM pg_available_extensions WHERE name = 'vector';"
```

Then, from `backend`, run the actual migration using a database role allowed to install the extension and create the migration objects:

```powershell
alembic upgrade 0004_pgvector
alembic current
psql -h localhost -p 5432 -U postgres -d buddy_db -c "SELECT extversion FROM pg_extension WHERE extname = 'vector';"
psql -h localhost -p 5432 -U postgres -d buddy_db -c "SELECT to_regclass('public.memory_embeddings');"
```

Confirm Alembic reports `0004_pgvector`, the extension query returns a version, and `to_regclass` returns `memory_embeddings`. If `buddy_app` cannot create the extension, have a PostgreSQL administrator install it in `buddy_db`, then rerun the migration with a role that can create the table and indexes in the schema. Only after the migration succeeds, set `PGVECTOR_ENABLED=true` in `backend/.env` and restart the API. Missing server files or permissions make the migration fail and leave Alembic at `0003_memory_metadata`; it does not mark `0004` applied or remove existing schema/data.

Firebase web identifiers are public. Admin credentials, PostgreSQL passwords, and Gemini keys are secrets. Never commit local env files or service-account JSON. Quick Chat calls Gemini but does not persist chat data. Account chat requires valid Firebase, PostgreSQL and Gemini configuration.
