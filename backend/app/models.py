from datetime import date, datetime

from pydantic import BaseModel, Field, field_validator


class Task(BaseModel):
    id: str = Field(min_length=1)
    task: str = Field(min_length=1)
    description: str = ""
    assignee: str = Field(min_length=1)
    duration: int = Field(gt=0)
    start_date: date
    end_date: date
    predecessors: list[str] = Field(default_factory=list)

    @field_validator("end_date")
    @classmethod
    def end_date_follows_start(cls, value: date, info):
        start = info.data.get("start_date")
        if start and value < start:
            raise ValueError("end_date must be on or after start_date")
        return value


class Plan(BaseModel):
    tasks: list[Task]


class ProjectSnapshot(BaseModel):
    project_id: str
    project_name: str
    conversation_id: str
    version: int
    plan: Plan
    messages: list[dict]


class WorkspaceProject(BaseModel):
    project_id: str
    project_name: str
    version: int
    created_at: datetime


class WorkspaceSnapshot(BaseModel):
    projects: list[WorkspaceProject]
    active_project: ProjectSnapshot
