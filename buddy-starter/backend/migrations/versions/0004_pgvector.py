"""Enable pgvector semantic memory search."""
from alembic import op
from sqlalchemy import text

revision = "0004_pgvector"
down_revision = "0003_memory_metadata"
branch_labels = None
depends_on = None

def upgrade():
    available = op.get_bind().execute(
        text("SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector')")
    ).scalar_one()
    if not available:
        raise RuntimeError(
            "pgvector server files are not installed for this PostgreSQL instance. "
            "Install a PostgreSQL-version-matched pgvector build, then rerun "
            "'alembic upgrade 0004_pgvector'. The current revision remains 0003."
        )
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    installed = op.get_bind().execute(
        text("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')")
    ).scalar_one()
    if not installed:
        raise RuntimeError("pgvector was not created; revision 0004_pgvector was not applied")
    op.execute("CREATE TABLE memory_embeddings (memory_id uuid PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, embedding vector(768) NOT NULL, created_at timestamptz NOT NULL DEFAULT now())")
    op.execute("CREATE INDEX ix_memory_embeddings_user_id ON memory_embeddings(user_id)")
    op.execute("CREATE INDEX ix_memory_embeddings_hnsw ON memory_embeddings USING hnsw (embedding vector_cosine_ops)")

def downgrade():
    op.execute("DROP TABLE IF EXISTS memory_embeddings")
