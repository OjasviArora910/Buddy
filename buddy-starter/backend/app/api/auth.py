from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.auth.firebase_auth import verified_firebase_claims, verified_firebase_uid
from app.db.models import User, UserPreference
from app.db.session import get_db

router = APIRouter(prefix="/auth", tags=["authentication"])

def _profile(user: User) -> dict:
    return {"id": str(user.id), "firebase_uid": user.firebase_uid, "display_name": user.display_name,
            "email": user.email, "created_at": user.created_at}

def _provision(db: Session, uid: str, claims: dict | None = None) -> User:
    user = db.scalar(select(User).where(User.firebase_uid == uid))
    if user is None:
        try:
            user = User(firebase_uid=uid)
            db.add(user)
            db.flush()
            db.add(UserPreference(user_id=user.id, memory_enabled=False))
            db.flush()
        except IntegrityError:
            # Parallel first requests: another request created the row first.
            db.rollback()
            user = db.scalar(select(User).where(User.firebase_uid == uid))
            if user is None:
                raise
    if claims:
        user.email = claims.get("email") or user.email
        user.display_name = claims.get("name") or user.display_name
    db.commit()
    db.refresh(user)
    return user

@router.get("/me")
def me(uid: str = Depends(verified_firebase_uid), db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.firebase_uid == uid))
    if user is None:
        return _profile(_provision(db, uid))
    return _profile(user)

@router.post("/profile/sync")
def sync_profile(claims: dict = Depends(verified_firebase_claims), db: Session = Depends(get_db)):
    return _profile(_provision(db, str(claims["uid"]), claims))
