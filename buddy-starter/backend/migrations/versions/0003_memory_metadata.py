"""Add memory provenance and consent timestamps."""
from alembic import op

revision = "0003_memory_metadata"
down_revision = "0002_memory"
branch_labels = None
depends_on = None

def upgrade():
    op.execute("ALTER TABLE memories ADD COLUMN source_reason text")
    op.execute("ALTER TABLE memories ADD COLUMN consented_at timestamptz")

def downgrade():
    op.execute("ALTER TABLE memories DROP COLUMN IF EXISTS consented_at")
    op.execute("ALTER TABLE memories DROP COLUMN IF EXISTS source_reason")
