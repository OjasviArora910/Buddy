"""Track grounded check-ins and explicit resolution state.

This migration branches from 0003 so the optional pgvector extension in 0004
remains optional for installations that do not have the server extension.
"""
from alembic import op

revision = "0005_memory_followups"
down_revision = "0003_memory_metadata"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE memories ADD COLUMN follow_up_question varchar(240)")
    op.execute("ALTER TABLE memories ADD COLUMN resolved_at timestamptz")


def downgrade():
    op.execute("ALTER TABLE memories DROP COLUMN IF EXISTS resolved_at")
    op.execute("ALTER TABLE memories DROP COLUMN IF EXISTS follow_up_question")
