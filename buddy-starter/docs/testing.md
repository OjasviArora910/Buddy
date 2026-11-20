# Testing

Run backend unit tests from `backend`: `.venv\\Scripts\\python.exe -m unittest discover -s tests -v` on Windows, or `python -m unittest discover -s tests -v` with the venv active elsewhere. Frontend check: `npm run build`. PostgreSQL integration requires a local service and migrated database. Firebase login and OAuth require a Firebase project and authorized local domain. Mocked token tests are not live integration verification.
