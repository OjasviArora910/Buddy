"""Merge the optional pgvector branch with the follow-up columns branch.

0004_pgvector and 0005_memory_followups both descend from 0003_memory_metadata.
This empty revision gives Alembic a single head. Installations without the
pgvector server extension should upgrade to 0005_memory_followups explicitly.
"""

revision = "0006_merge_heads"
down_revision = ("0004_pgvector", "0005_memory_followups")
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
