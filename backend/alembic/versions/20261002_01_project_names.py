"""reset pre-production data and add required project names"""
from alembic import op
import sqlalchemy as sa


revision = "20261002_01"
down_revision = "20260930_02"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text("DELETE FROM workspaces"))
    op.add_column("projects", sa.Column("name", sa.String(64), nullable=False))


def downgrade():
    op.drop_column("projects", "name")
