---
title: 'Localize AI operation statuses'
type: 'feature'
ticket: ''
created: '2026-10-01'
status: 'built'
route: 'full'
route_source: 'auto'
baseline_revision: 'd025d6f61a960f10a1d7c2b242a54a19c9ae8581'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Plan-chat progress currently exposes backend-authored English strings and raw tool identifiers, so changing the application language does not localize the active AI operation.

**Approach:** Replace human-readable progress payloads with a closed structured contract and render every known operation status from the existing Russian/English catalogs on the frontend.

## Boundaries & Constraints

**Always:** Emit stable machine-readable progress fields for planning and all allowlisted tools; localize planning, running, completion, failure, tool names, and validated task counts; retain structured operation state so an in-flight status immediately changes language when the user switches locale; use a safe localized generic status for malformed or future unknown progress values; preserve busy, cancel, retry, and reconnect behavior.

**Never:** Localize or alter final AI answers, clarification text, persisted transcript content, terminal server errors, request payloads, plan data, or tool execution behavior; expose tool failure details or provider internals through progress events; add legacy string matching or a second progress protocol.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Planning | Backend starts a provider round | `status` carries a stable planning code and UI renders it in the active locale | Unknown status code renders a localized generic operation status |
| Tool running | Any allowlisted tool begins | Tool identifier and `running` state map to localized copy | Unknown tool identifier is not rendered raw |
| Tool complete | Tool returns a validated plan and task count | UI names the tool and reports the count with locale-correct pluralization | Missing/invalid count uses completion copy without a count |
| Tool failed | Tool invocation fails and the agent may recover | UI shows a localized non-terminal recovery status with no backend detail | Failure detail remains internal to the agent loop |
| Locale switch | Progress is visible while language changes | Existing operation rerenders in the new locale without reconnecting or losing busy state | Unsupported locale handling remains unchanged |
| Terminal content | Complete, clarification, cancellation, or error event arrives | Existing lifecycle behavior runs and meaningful server/AI text remains verbatim | Existing localized protocol/network fallbacks remain intact |

</frozen-after-approval>

## Code Map

- `backend/app/agent.py:OpenAIPlanAgent._run` -- replace `message`/`result` progress strings with `code`, closed tool lifecycle values, and numeric `task_count`; keep tool-output errors internal.
- `backend/app/main.py:run_chat` -- forwards progress events unchanged; preserve final completion, clarification, cancellation, and terminal error shapes.
- `backend/tests/test_chat.py` -- assert exact safe progress payloads, retry lifecycle, counts, unknown-tool suppression, and unchanged final messages.
- `frontend/src/components/PlanChat.jsx` -- store structured progress events and derive display text during render so locale changes update an active operation.
- `frontend/src/locales/en.js`, `frontend/src/locales/ru.js` -- add localized planning/tool/status messages, tool labels, generic fallback, and task-count grammar.
- `frontend/src/PlanChat.test.jsx` -- cover known and unknown progress events, all lifecycle states, count handling, no raw identifiers/details, and cancellation behavior.
- `frontend/src/i18n.test.jsx` -- replace verbatim progress assertions with live RU/EN status translation while retaining verbatim final AI/server content checks.
- `frontend/src/api.js:connectPlanChat` -- transport boundary; keep protocol/network event generation and validated complete-plan parsing unchanged.

## Tasks & Acceptance

**Execution:**
- [x] `backend/app/agent.py`, `backend/tests/test_chat.py` -- define and verify the structured, detail-free progress contract for planning and all tool lifecycle states.
- [x] `frontend/src/components/PlanChat.jsx`, `frontend/src/locales/{en,ru}.js` -- render structured operations through locale catalogs with safe fallbacks and live language switching.
- [x] `frontend/src/PlanChat.test.jsx`, `frontend/src/i18n.test.jsx` -- cover the full matrix and preserve terminal-content behavior.

**Acceptance Criteria:**
- Given any backend progress event, when it reaches the chat UI, then no backend-authored status sentence, raw tool identifier, or internal failure detail is shown to the user.
- Given Russian or English is active, when planning or an allowlisted tool runs, succeeds, or fails, then the operation text is complete and natural in that language.
- Given a visible operation, when the language changes, then the operation text changes immediately while the request remains active and cancellable.
- Given a final AI response, clarification, cancellation, or terminal server error, when it arrives, then its existing state transition and verbatim meaningful content are preserved.

## Implementation Notes

- Backend progress now exposes only `planning`, closed tool identifiers/lifecycle states, and validated numeric task counts; tool failure details remain inside the agent loop.
- Frontend stores the structured operation event and formats it at render time, including localized tool labels, plurals, malformed-event fallback, and live locale switching.
- Verification completed with 11 backend chat tests and 54 frontend tests passing, a successful Vite build, and a clean `git diff --check`.

## Plan Change Log

## Review Triage Log

- `medium` / `patch` -- inherited object names such as `constructor` could bypass the closed tool map and expose function source; require an own-property match and cover the prototype-collision case.
- `medium` / `patch` -- safe but out-of-contract integer counts above the 500-task plan limit were rendered as validated counts; accept only safe integers in `0..500` and use count-free completion text otherwise.

## Design Notes

Use a small closed mapping for `planning`, the five existing tool identifiers, and `running|complete|failed`. Backend progress should contain only the data needed for presentation, for example `{"type":"status","code":"planning"}` and `{"type":"tool","tool":"update_task","status":"complete","task_count":12}`. Do not persist rendered progress text.

## Verification

**Commands:**
- `./.venv/bin/python -m pytest tests/test_chat.py` in `backend/` -- expected: chat contract and lifecycle tests pass.
- `npm test -- --run` in `frontend/` -- expected: all Vitest suites pass, including localized progress coverage.
- `npm run build` in `frontend/` -- expected: Vite production build succeeds.

**Manual checks (if no CLI):**
- Start a chat edit, switch RU/EN while planning and during a tool step, cancel another request, and confirm localized progress changes without exposing raw codes or losing state.
