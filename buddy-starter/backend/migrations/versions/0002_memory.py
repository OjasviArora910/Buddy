"""Memory and consent tables; vector search is intentionally deferred."""
from alembic import op

revision = "0002_memory"
down_revision = "0001_initial"
branch_labels = None
depends_on = None

def upgrade():
    op.execute("""CREATE TABLE memories (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, content text NOT NULL, category varchar(40) NOT NULL, sensitivity varchar(20) NOT NULL DEFAULT 'non_sensitive', status varchar(20) NOT NULL DEFAULT 'active', source_conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL, confidence double precision NOT NULL DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1), event_at timestamptz, expires_at timestamptz, last_mentioned_at timestamptz, follow_up_after timestamptz, last_followed_up_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())""")
    op.execute("CREATE INDEX ix_memories_user_id ON memories(user_id)")
    op.execute("CREATE INDEX ix_memories_user_status ON memories(user_id, status)")
    op.execute("CREATE INDEX ix_memories_expires_at ON memories(expires_at)")
    op.execute("""CREATE TABLE memory_consents (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, consent_scope varchar(40) NOT NULL, consent_version varchar(30) NOT NULL, granted_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz)""")
    op.execute("CREATE INDEX ix_memory_consents_user_id ON memory_consents(user_id)")
    op.execute("""CREATE TABLE memory_events (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, memory_id uuid REFERENCES memories(id) ON DELETE SET NULL, event_type varchar(40) NOT NULL, event_metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now())""")
    op.execute("CREATE INDEX ix_memory_events_user_id ON memory_events(user_id)")
    op.execute("CREATE INDEX ix_memory_events_memory_id ON memory_events(memory_id)")

def downgrade():
    op.execute("DROP TABLE memory_events, memory_consents, memories CASCADE")
