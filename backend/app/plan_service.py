import re
import uuid
from copy import deepcopy
from datetime import date, timedelta

from .excel import ExcelError, text, validate_schedule
from .models import Plan


class PlanEditError(Exception):
    pass


def validate_plan(value) -> Plan:
    plan = Plan.model_validate(value)
    tasks = plan.model_dump()["tasks"]
    try:
        for index, task in enumerate(tasks):
            location = {"row": index + 1}
            task["id"] = text(task["id"], "id", location, required=True)
            task["task"] = text(task["task"], "task", location, required=True, trim=True)
            task["description"] = text(task["description"], "description", location)
            task["assignee"] = text(task["assignee"], "assignee", location, required=True)
        validate_schedule(tasks, [{"row": index + 1} for index in range(len(tasks))])
    except ExcelError as error:
        raise PlanEditError(error.detail["message"]) from error
    return Plan.model_validate({"tasks": tasks})


class PlanEditor:
    def __init__(self, plan: Plan):
        self.plan = validate_plan(plan)

    def _tasks(self):
        return self.plan.model_dump()["tasks"]

    @staticmethod
    def _by_name(tasks):
        return {task["task"]: task for task in tasks}

    @staticmethod
    def _descendants(tasks, roots):
        affected = set(roots)
        changed = True
        while changed:
            changed = False
            for task in tasks:
                if task["id"] not in affected and any(key in affected for key in task["predecessors"]):
                    affected.add(task["id"])
                    changed = True
        return affected

    def _commit(self, tasks, reschedule=(), root_start=None, fixed_starts=()):
        affected = self._descendants(tasks, set(reschedule))
        fixed_starts = set(fixed_starts)
        by_id = {task["id"]: task for task in tasks}
        pending = set(affected)
        while pending:
            progress = False
            for key in list(pending):
                task = by_id[key]
                if any(parent in pending for parent in task["predecessors"]):
                    continue
                if key not in fixed_starts:
                    latest = max((by_id[parent]["end_date"] for parent in task["predecessors"]), default=None)
                    if latest:
                        task["start_date"] = latest + timedelta(days=1)
                    elif root_start is not None:
                        task["start_date"] = root_start
                try:
                    task["end_date"] = task["start_date"] + timedelta(days=task["duration"] - 1)
                except OverflowError as error:
                    raise PlanEditError(f"Task {task['task']!r} ends outside the supported date range.") from error
                pending.remove(key)
                progress = True
            if not progress:
                break
        self.plan = validate_plan({"tasks": tasks})
        return self.plan

    def read(self):
        return self.plan.model_dump(mode="json")

    def add(self, task, assignee, duration, description="", predecessors=None, start_date=None):
        tasks = self._tasks()
        if task in self._by_name(tasks):
            raise PlanEditError(f"Task name {task!r} already exists.")
        names = self._by_name(tasks)
        predecessor_names = predecessors or []
        unknown = [name for name in predecessor_names if name not in names]
        if unknown:
            raise PlanEditError(f"Unknown predecessor {unknown[0]!r}.")
        if start_date:
            try:
                start = date.fromisoformat(start_date)
            except ValueError as error:
                raise PlanEditError("start_date must use YYYY-MM-DD.") from error
        else:
            latest = max((names[name]["end_date"] for name in predecessor_names), default=None)
            start = latest + timedelta(days=1) if latest else min((item["start_date"] for item in tasks), default=date.today())
        base = re.sub(r"[^a-z0-9]+", "-", task.lower()).strip("-") or "task"
        used = {item["id"] for item in tasks}
        key, suffix = base, 2
        while key in used:
            key, suffix = f"{base}-{suffix}", suffix + 1
        tasks.append({"id": key, "task": task.strip(), "description": description, "assignee": assignee,
                      "duration": duration, "start_date": start, "end_date": start + timedelta(days=duration - 1),
                      "predecessors": [names[name]["id"] for name in predecessor_names]})
        return self._commit(tasks)

    def update(self, task, new_name=None, description=None, assignee=None, duration=None, start_date=None):
        tasks = self._tasks()
        target = self._by_name(tasks).get(task)
        if not target:
            raise PlanEditError(f"Unknown task {task!r}.")
        if new_name and new_name != task and new_name in self._by_name(tasks):
            raise PlanEditError(f"Task name {new_name!r} already exists.")
        if new_name is not None:
            target["task"] = new_name.strip()
        if description is not None:
            target["description"] = description
        if assignee is not None:
            target["assignee"] = assignee
        if duration is not None:
            target["duration"] = duration
        if start_date is not None:
            try:
                target["start_date"] = date.fromisoformat(start_date)
            except ValueError as error:
                raise PlanEditError("start_date must use YYYY-MM-DD.") from error
        schedule_changed = duration is not None or start_date is not None
        return self._commit(tasks, [target["id"]] if schedule_changed else [],
                            fixed_starts=[target["id"]] if start_date is not None else [])

    def edit_task(self, task_id, task, description, assignee, duration, start_date, predecessors):
        tasks = self._tasks()
        by_id = {item["id"]: item for item in tasks}
        target = by_id.get(task_id)
        if not target:
            raise PlanEditError(f"Unknown task ID {task_id!r}.")
        name = task.strip()
        owner = assignee.strip()
        if not name:
            raise PlanEditError("Task name is required.")
        if not owner:
            raise PlanEditError("Assignee is required.")
        if any(item["id"] != task_id and item["task"] == name for item in tasks):
            raise PlanEditError(f"Task name {name!r} already exists.")
        if len(predecessors) != len(set(predecessors)):
            raise PlanEditError("A predecessor can be selected only once.")
        unknown = [key for key in predecessors if key not in by_id]
        if unknown:
            raise PlanEditError(f"Unknown predecessor ID {unknown[0]!r}.")
        if task_id in predecessors:
            raise PlanEditError("A task cannot be its own predecessor.")
        try:
            start = date.fromisoformat(start_date)
        except ValueError as error:
            raise PlanEditError("start_date must use YYYY-MM-DD.") from error
        schedule_changed = (duration != target["duration"] or start != target["start_date"] or
                            list(predecessors) != target["predecessors"])
        target.update(task=name, description=description, assignee=owner, duration=duration,
                      start_date=start, predecessors=list(predecessors))
        return self._commit(tasks, [task_id] if schedule_changed else [],
                            fixed_starts=[task_id] if schedule_changed else [])

    def create_task(self, task, description, assignee, duration, start_date, predecessors):
        tasks = self._tasks()
        by_id = {item["id"]: item for item in tasks}
        name = task.strip()
        owner = assignee.strip()
        if not name:
            raise PlanEditError("Task name is required.")
        if not owner:
            raise PlanEditError("Assignee is required.")
        if any(item["task"] == name for item in tasks):
            raise PlanEditError(f"Task name {name!r} already exists.")
        if len(predecessors) != len(set(predecessors)):
            raise PlanEditError("A predecessor can be selected only once.")
        unknown = [key for key in predecessors if key not in by_id]
        if unknown:
            raise PlanEditError(f"Unknown predecessor ID {unknown[0]!r}.")
        try:
            start = date.fromisoformat(start_date)
            end = start + timedelta(days=duration - 1)
        except ValueError as error:
            raise PlanEditError("start_date must use YYYY-MM-DD.") from error
        except OverflowError as error:
            raise PlanEditError(f"Task {name!r} ends outside the supported date range.") from error
        tasks.append({"id": str(uuid.uuid4()), "task": name, "description": description,
                      "assignee": owner, "duration": duration, "start_date": start,
                      "end_date": end, "predecessors": list(predecessors)})
        self.plan = validate_plan({"tasks": tasks})
        return self.plan

    def dependencies(self, task, predecessors):
        tasks = self._tasks()
        names = self._by_name(tasks)
        target = names.get(task)
        if not target:
            raise PlanEditError(f"Unknown task {task!r}.")
        unknown = [name for name in predecessors if name not in names]
        if unknown:
            raise PlanEditError(f"Unknown predecessor {unknown[0]!r}.")
        target["predecessors"] = [names[name]["id"] for name in predecessors]
        return self._commit(tasks, [target["id"]])

    def delete(self, tasks_to_delete):
        tasks = self._tasks()
        names = self._by_name(tasks)
        unknown = [name for name in tasks_to_delete if name not in names]
        if unknown:
            raise PlanEditError(f"Unknown task {unknown[0]!r}.")
        removed = {names[name]["id"] for name in tasks_to_delete}
        remaining = [deepcopy(task) for task in tasks if task["id"] not in removed]
        affected = []
        for task in remaining:
            if any(key in removed for key in task["predecessors"]):
                task["predecessors"] = [key for key in task["predecessors"] if key not in removed]
                affected.append(task["id"])
        root_start = min((task["start_date"] for task in tasks), default=date.today())
        return self._commit(remaining, affected, root_start)
