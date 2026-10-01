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
- source_plan: none
  summary: Automatically reconnect the chat after a WebSocket connection loss.
  evidence: Deferred at the user's request so the chat keyboard behavior can be implemented and manually verified first.
- source_plan: none
  summary: Automatically retry the last failed chat request without duplicating its message.
  evidence: Deferred at the user's request so fixes are delivered and manually verified in the stated order.
- source_plan: plan-chat-websocket-auto-reconnect.md
  summary: Delivered automatic chat WebSocket reconnection.
  evidence: Added bounded reconnect backoff, lifecycle guards, terminal authentication handling, and stale-version protection.
