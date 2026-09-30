from datetime import date, timedelta
from typing import Annotated

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
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


def seeded_tasks() -> list[Task]:
    start = date(2026, 10, 5)
    return [
        Task(
            id="discovery",
            task="Discovery workshop",
            description="Align on the problem, users, and success measures.",
            assignee="Maya",
            duration=3,
            start_date=start,
            end_date=start + timedelta(days=2),
        ),
        Task(
            id="wireframes",
            task="Product wireframes",
            description="Turn the workshop outcomes into a navigable structure.",
            assignee="Noah",
            duration=4,
            start_date=start + timedelta(days=3),
            end_date=start + timedelta(days=6),
            predecessors=["discovery"],
        ),
        Task(
            id="api",
            task="Plan API",
            description="Define the plan contract for the first usable slice.",
            assignee="Priya",
            duration=5,
            start_date=start + timedelta(days=3),
            end_date=start + timedelta(days=7),
            predecessors=["discovery"],
        ),
        Task(
            id="chart",
            task="Gantt timeline",
            description="Render tasks, dates, and dependency connectors.",
            assignee="Leo",
            duration=5,
            start_date=start + timedelta(days=8),
            end_date=start + timedelta(days=12),
            predecessors=["wireframes", "api"],
        ),
        Task(
            id="review",
            task="Team review",
            description="Review the plan view and prepare the next slice.",
            assignee="Maya",
            duration=2,
            start_date=start + timedelta(days=13),
            end_date=start + timedelta(days=14),
            predecessors=["chart"],
        ),
    ]


app = FastAPI(title="GanttAI Plan API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/plan", response_model=Plan)
def get_plan() -> Plan:
    return Plan(tasks=seeded_tasks())


PlanResponse = Annotated[Plan, "Validated plan response"]
