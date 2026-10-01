---
title: 'Submit chat messages with Enter'
type: 'bugfix'
ticket: ''
created: '2026-10-02'
status: 'built'
baseline_revision: '5c2afd430d30fd7084dac030aacb857bb5adcfd2'
route: 'oneshot'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Pressing Enter in the chat composer currently inserts a newline, forcing users to click the send button for the normal send action.

**Approach:** Make Enter submit a valid message while preserving Shift+Enter as the explicit newline shortcut.

</frozen-after-approval>

## Implementation Notes

This is a localized, low-risk change to one component and its focused test file. Reuse the existing form submission path and its guards so keyboard and button submission remain behaviorally identical.

- Added a textarea keydown path that delegates plain Enter to the existing guarded send function and leaves Shift+Enter to native textarea behavior.
- Added focused coverage for multiline draft preservation under Shift+Enter and submission/clearing under Enter.
- Preserved IME composition confirmation behavior by ignoring Enter while the browser reports an active composition.

## Plan Change Log

## Review Triage Log

| Verdict | Location | Evidence | Route |
|---|---|---|---|
| medium | `frontend/src/components/PlanChat.jsx` composer keydown handler | Enter during IME composition reached `send`, which could submit and clear incomplete composed text; guarded with `nativeEvent.isComposing` and covered by the focused keyboard test. | patch |

## Verification

**Commands:**
- `npm test -- --run src/PlanChat.test.jsx` from `frontend/` — expected: chat composer tests pass, including Enter submission and Shift+Enter newline behavior.
- `npm run build` from `frontend/` — expected: production frontend build succeeds.

- 2026-10-02: focused Vitest suite passed (6 tests); production Vite build passed.
- 2026-10-02: post-review focused suite and production build passed after adding the IME composition guard.
