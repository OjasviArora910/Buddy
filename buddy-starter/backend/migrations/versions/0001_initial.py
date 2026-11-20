"""Initial application tables."""
from alembic import op

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    op.execute("""CREATE TABLE users (id uuid PRIMARY KEY, firebase_uid varchar(128) NOT NULL UNIQUE, display_name varchar(200), email varchar(320), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())""")
    op.execute("CREATE INDEX ix_users_firebase_uid ON users(firebase_uid)")
    op.execute("""CREATE TABLE conversations (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, title varchar(120) NOT NULL DEFAULT 'New conversation', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())""")
    op.execute("CREATE INDEX ix_conversations_user_id ON conversations(user_id)")
    op.execute("CREATE INDEX ix_conversations_updated_at ON conversations(updated_at)")
    op.execute("""CREATE TABLE messages (id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, role varchar(12) NOT NULL CHECK (role IN ('user','assistant')), content text NOT NULL, client_request_id varchar(100), created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT uq_message_request UNIQUE (conversation_id, client_request_id))""")
    op.execute("CREATE INDEX ix_messages_conversation_id ON messages(conversation_id)")
    op.execute("CREATE INDEX ix_messages_created_at ON messages(created_at)")
    op.execute("""CREATE TABLE user_preferences (user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, preferred_language varchar(20) NOT NULL DEFAULT 'auto', preferred_tone varchar(40) NOT NULL DEFAULT 'warm', memory_enabled boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())""")

def downgrade():
    op.execute("DROP TABLE user_preferences, messages, conversations, users CASCADE")
