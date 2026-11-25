# Testing

Run backend unit tests from `backend`: `.venv\\Scripts\\python.exe -m unittest discover -s tests -v` on Windows, or `python -m unittest discover -s tests -v` with the venv active elsewhere. Frontend check: `npm run build`. PostgreSQL integration requires a local service and migrated database. Firebase login and OAuth require a Firebase project and authorized local domain. Mocked token tests are not live integration verification.

## Learning, check-ins, verification and diagnostics

Backend (PostgreSQL required for the integration files): `.venv\Scripts\python.exe -m unittest discover -s tests`. `tests/test_learning_followups.py` uses the real verified-email dependencies with a mocked chat model (it records exactly which messages, saved facts, excerpts, check-in question and display name reach the model), a fake extraction provider, and a controlled clock (`main._now`). It covers learning "My cat Prii has been unwell" without the Memories page, fresh-chat recall, retry after provider failure, idempotency, consent and deletion rechecks, check-in firing and skip rules, resolution, staleness, memory off, Quick Chat, a second account, expiry, deletion, display name, unverified-email 403s, and parallel first requests for a new user. These tests create and delete rows with random `learn-*` Firebase UIDs in the configured local database.

Frontend: `npm run build` (Turbopack, includes TypeScript). Diagnostics are `[buddy.diagnostic]` browser console entries (`operation`, `route_template`, `status`, `elapsed_ms`, `request_id`); the same `request_id` appears in the backend `http_request` log line (`buddy.api` logger, INFO). `app.main` configures the `buddy` loggers itself, so plain `uvicorn app.main:app` prints them.

Mocked results are not live verification. Live Gemini, Firebase email delivery and Google sign-in need network access to those services.
