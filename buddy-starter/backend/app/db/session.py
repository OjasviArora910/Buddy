import os
from functools import lru_cache
from collections.abc import Generator
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker


def _database_url() -> str:
    value = os.getenv("DATABASE_URL", "")
    if not value.startswith("postgresql+psycopg://"):
        raise RuntimeError("DATABASE_URL must use postgresql+psycopg://")
    return value


@lru_cache(maxsize=1)
def make_engine():
    return create_engine(_database_url(), pool_pre_ping=True, pool_size=5, max_overflow=5,
                         pool_timeout=10, connect_args={"connect_timeout": 5})


SessionLocal = sessionmaker(autocommit=False, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    engine = make_engine()
    with SessionLocal(bind=engine) as session:
        try:
            yield session
        except Exception:
            session.rollback()
            raise
