"""Check PostgreSQL connectivity without displaying the configured URL or credentials."""
from pathlib import Path
import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
raw = os.getenv("DATABASE_URL", "")
if not raw:
    raise SystemExit("DATABASE_URL is not configured")
url = make_url(raw)
print(f"Configured: driver={url.drivername}, host={url.host}, port={url.port}, database={url.database}, username_present={bool(url.username)}, password_present={bool(url.password)}")
engine = create_engine(url, connect_args={"connect_timeout": 5})
try:
    with engine.connect() as conn:
        database = conn.execute(text("select current_database()")).scalar()
        print(f"Connection successful; current database: {database}")
        revision = conn.execute(text("select to_regclass('public.alembic_version')")).scalar()
        current = conn.execute(text("select version_num from alembic_version")).scalar() if revision else "not migrated"
        print(f"Alembic revision: {current}")
        vector = conn.execute(text("select exists(select 1 from pg_available_extensions where name='vector')")).scalar()
        print(f"pgvector server extension files available: {bool(vector)}")
        required = {"users", "conversations", "messages", "user_preferences", "memories", "memory_consents", "memory_events"}
        present = set(conn.execute(text("select tablename from pg_tables where schemaname='public'")).scalars())
        missing = sorted(required - present)
        print(f"Required base tables present: {not missing}")
        if missing: print("Missing tables:", ", ".join(missing))
        if not missing:
            checks = conn.execute(text("""select table_name, privilege,
              has_table_privilege(current_user, format('public.%I', table_name), privilege) as allowed
              from (values ('users','SELECT'),('users','INSERT'),('users','UPDATE'),
                    ('conversations','SELECT'),('conversations','INSERT'),('conversations','UPDATE'),('conversations','DELETE'),
                    ('messages','SELECT'),('messages','INSERT'),('memories','SELECT'),('memories','INSERT'),('memories','UPDATE'),('memories','DELETE')) p(table_name,privilege)""")).all()
            denied = [f"{table}:{privilege}" for table, privilege, allowed in checks if not allowed]
            print(f"Required table privileges present: {not denied}")
            if denied: print("Missing privileges:", ", ".join(denied))
except Exception as exc:
    message = str(getattr(exc, "orig", exc)).lower()
    print(f"Connection/diagnostic failed ({type(exc).__name__}). Credentials are not shown.")
    if "password authentication failed" in message: print("PostgreSQL rejected the configured role password.")
    elif "connection refused" in message: print("PostgreSQL is not accepting connections at the configured host and port.")
    elif "database" in message and "does not exist" in message: print("The configured database does not exist.")
    elif "role" in message and "does not exist" in message: print("The configured PostgreSQL role does not exist.")
    elif "permission denied" in message or "insufficient privilege" in message: print("The PostgreSQL role lacks required database or table privileges.")
    elif "no pg_hba.conf entry" in message: print("PostgreSQL rejected this host/user/database combination in pg_hba.conf.")
    elif "timeout" in message: print("PostgreSQL connection timed out; verify the service, host, port, and firewall.")
    elif "does not exist" in message and "alembic_version" in message: print("Alembic has not initialized the migration table.")
    raise SystemExit(1)
