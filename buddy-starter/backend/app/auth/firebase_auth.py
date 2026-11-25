"""Firebase ID-token verification using Google Application Default Credentials."""

import os
import threading
from pathlib import Path
from typing import Any

import firebase_admin
from firebase_admin import auth
from fastapi import Header, HTTPException

_init_lock = threading.Lock()


def _is_permission_failure(exc: Exception) -> bool:
    """Recognize IAM/ADC authorization failures without exposing provider details."""
    status = getattr(exc, "status_code", None)
    response = getattr(exc, "http_response", None)
    status = status or getattr(response, "status_code", None)
    code = getattr(exc, "code", None)
    if callable(code):
        try:
            code = code()
        except Exception:
            code = None
    code_text = str(getattr(code, "name", code)).upper()
    if status == 403 or code_text in {"403", "PERMISSION_DENIED", "PERMISSIONDENIED"}:
        return True
    # google-auth RefreshError sometimes carries the 403 only in its message.
    if type(exc).__name__ in {"RefreshError", "DefaultCredentialsError"}:
        message = str(exc).lower()
        return any(term in message for term in ("403", "permission", "iam", "service account"))
    return False


def firebase_app():
    project_id = os.getenv("FIREBASE_PROJECT_ID", "").strip()
    if not project_id:
        raise RuntimeError("FIREBASE_PROJECT_ID is required")

    # Firebase Admin's app registry is process-global. The lock prevents two
    # concurrent first requests from racing to initialize the default app.
    with _init_lock:
        try:
            app = firebase_admin.get_app()
        except ValueError:
            configured_key = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
            if configured_key and not Path(configured_key).expanduser().is_file():
                # google-auth otherwise treats a stale path as authoritative and
                # never reaches the user's gcloud ADC credentials.
                os.environ.pop("GOOGLE_APPLICATION_CREDENTIALS", None)
            # Without an explicit credential, Firebase Admin uses Google ADC.
            app = firebase_admin.initialize_app(options={"projectId": project_id})
        if app.project_id != project_id:
            raise RuntimeError("Existing Firebase Admin app uses a different project")
        return app


def verify_token(token: str, check_revoked: bool = False) -> dict[str, Any]:
    try:
        app = firebase_app()
    except Exception as exc:
        if _is_permission_failure(exc):
            raise HTTPException(
                status_code=503,
                detail=(
                    "Firebase Admin ADC lacks required Google Cloud permissions. "
                    "Check the signed-in identity and Firebase project access."
                ),
            ) from exc
        raise HTTPException(
            status_code=503,
            detail=(
                "Firebase Admin credentials are unavailable. Configure Google ADC "
                "with gcloud auth application-default login."
            ),
        ) from exc

    try:
        claims = auth.verify_id_token(token, app=app, check_revoked=check_revoked)
        if claims.get("aud") != os.getenv("FIREBASE_PROJECT_ID"):
            raise ValueError("Firebase project mismatch")
        return claims
    except (auth.ExpiredIdTokenError, auth.InvalidIdTokenError, auth.RevokedIdTokenError, ValueError) as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired Firebase token") from exc
    except Exception as exc:
        # Invalid tokens remain 401; provider/network/IAM failures are service errors.
        if _is_permission_failure(exc):
            raise HTTPException(
                status_code=503,
                detail=(
                    "Firebase Admin ADC lacks required Google Cloud permissions. "
                    "Check the signed-in identity and Firebase project access."
                ),
            ) from exc
        raise HTTPException(
            status_code=503,
            detail="Firebase token verification is temporarily unavailable.",
        ) from exc


def verified_firebase_uid(authorization: str | None = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Firebase sign-in required")
    claims = verify_token(authorization.removeprefix("Bearer "))
    require_verified_email(claims)
    uid = claims.get("uid")
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid Firebase identity")
    return str(uid)


def verified_firebase_claims(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Firebase sign-in required")
    claims = verify_token(authorization.removeprefix("Bearer "))
    require_verified_email(claims)
    return claims


def require_verified_email(claims: dict[str, Any]) -> None:
    """Require a Firebase-verified email before accessing account data."""
    if claims.get("email_verified") is not True:
        raise HTTPException(status_code=403, detail="Verify your email before using Buddy account features.")
