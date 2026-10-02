---
title: 'Fix import modal text contrast'
type: 'bugfix'
ticket: ''
created: '2026-10-02'
status: 'built'
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

**Problem:** Several labels and controls in the Excel import modal inherit white text from the dark top bar, making the workbook prompt, date field/help, Clear, and Cancel actions unreadable on the modal's light background.

**Approach:** Give the light import modal an explicit dark foreground color, retain muted styling for supporting text, and verify every visible modal text state remains readable without changing import behavior.

</frozen-after-approval>

## Implementation Notes

This is a localized CSS regression caused by inherited color, so it uses the oneshot route. The modal root should establish the foreground context instead of patching each currently affected child independently.
- Set the import modal's base foreground to navy so the workbook prompt, date input, and secondary buttons are readable regardless of their dark top-bar ancestor.
- Kept form help copy muted while preserving existing explicit colors for headings, upload metadata, schema guidance, and the primary action.
- All 71 frontend tests and the production build pass; the isolated local preview was rebuilt and its page and API respond successfully on port 8080.

## Plan Change Log

## Review Triage Log

- `medium`, patched: the global disabled opacity reduced navy controls below normal-text contrast during an active import; disabled controls inside the modal now use 0.7 opacity, remaining visibly disabled while retaining readable contrast.

## Verification

**Commands:**
- `npm test -- --run` from `frontend/` -- expected: frontend test suite passes.
- `npm run build` from `frontend/` -- expected: production bundle builds successfully.
- Rebuild the `ganttai-preview` web image and load `http://localhost:8080/` -- expected: all import modal text and controls are legible on light surfaces.
