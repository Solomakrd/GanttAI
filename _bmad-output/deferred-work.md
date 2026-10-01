- source_plan: none
  summary: Add Excel import and export for the project plan.
  evidence: Split from ProjectDescription.md because file exchange is independently shippable after the core plan model exists.
- source_plan: none
  summary: Add an LLM/MCP chat for natural-language bulk plan editing.
  evidence: Split from ProjectDescription.md because agent integration has independent API, security, and validation concerns.
- source_plan: none
  summary: Add a task-details modal with editable task information.
  evidence: Split from ProjectDescription.md because task inspection is an independently testable UI surface after the chart exists.
- source_plan: plan-task-details-modal.md
  summary: Delivered the deferred editable task-details modal requirement.
  evidence: Added direct task inspection and atomic versioned editing from task labels and bars.
