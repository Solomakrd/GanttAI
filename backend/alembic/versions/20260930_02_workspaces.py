"""move anonymous ownership from projects to workspaces"""
from alembic import op
import sqlalchemy as sa


revision = "20260930_02"
down_revision = "20260930_01"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "workspaces",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_workspaces_token_hash", "workspaces", ["token_hash"], unique=True)
    op.add_column("projects", sa.Column("workspace_id", sa.String(36), nullable=True))
    op.execute(sa.text("INSERT INTO workspaces (id, token_hash, created_at) SELECT id, token_hash, created_at FROM projects"))
    op.execute(sa.text("UPDATE projects SET workspace_id = id"))
    op.alter_column("projects", "workspace_id", nullable=False)
    op.create_foreign_key("fk_projects_workspace_id", "projects", "workspaces", ["workspace_id"], ["id"], ondelete="CASCADE")
    op.create_index("ix_projects_workspace_id", "projects", ["workspace_id"])
    op.drop_index("ix_projects_token_hash", table_name="projects")
    op.drop_column("projects", "token_hash")


def downgrade():
    op.add_column("projects", sa.Column("token_hash", sa.String(64), nullable=True))
    op.execute(sa.text("UPDATE projects SET token_hash = workspaces.token_hash FROM workspaces WHERE projects.workspace_id = workspaces.id"))
    op.alter_column("projects", "token_hash", nullable=False)
    op.create_index("ix_projects_token_hash", "projects", ["token_hash"])
    op.drop_index("ix_projects_workspace_id", table_name="projects")
    op.drop_constraint("fk_projects_workspace_id", "projects", type_="foreignkey")
    op.drop_column("projects", "workspace_id")
    op.drop_table("workspaces")
