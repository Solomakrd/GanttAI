---
title: 'Ignore empty Excel rows when enforcing task limits'
type: 'bugfix'
ticket: ''
created: '2026-09-30'
status: 'built'
route: 'oneshot'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
baseline_revision: '1ae2e5596770869979da64e0cd772d64e7a16670'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The user's workbook has five tasks and 994 empty rows. Import incorrectly rejects physical row 502 because its 500-row check precedes empty-row filtering.

**Approach:** Apply the 500-task limit to nonempty records, ignoring empty/whitespace-only rows including formatted rows and gaps. Keep original worksheet row numbers in diagnostics and preserve existing validation for populated rows, formulas, archive size and column limits. Update README and add route-level regression tests for trailing rows, gaps and genuine overflow.

Given five tasks followed by empty rows through row 1000, when imported, then all five tasks are returned. Given 500 tasks separated by empty rows, when imported, then all 500 are accepted; a 501st nonempty task is rejected at its original sheet row. Given an invalid populated row beyond physical row 500, when imported, then the real validation error and row number are reported.

</frozen-after-approval>

## Implementation Notes

- Small localized fix, estimated below 100 changed lines. User approved working over the existing uncommitted Excel implementation and examples; retain that work.
- Previous Excel plan is historical; its frozen section remains unchanged. This fix supersedes the old physical-row counting behavior described in its implementation notes.
- Implemented nonempty-row counting, whitespace skipping, original row diagnostics and a separate Excel physical-row bound. Updated README. Added six regression cases covering formatted tails, gaps/overflow, malformed populated rows and oversized XML row indices.

## Plan Change Log

## Review Triage Log

- `high` → `patch`: openpyxl synthesizes missing physical rows up to an untrusted XML row index; skipping empty rows could traverse a trillion rows in a tiny workbook. Added a separate physical worksheet bound of 1,048,576 (Excel's limit) while retaining 500 nonempty records; regression injects an oversized XML row index and uses a smaller bound for fast verification.

## Verification

- Backend: `./.venv/bin/python -m pytest tests/test_excel.py` for regressions, then `./.venv/bin/python -m pytest`.
- Import the user-provided workbook through TestClient and verify five tasks, then export/reimport and compare plans. Do not modify the original workbook.
- Results: all 62 backend tests pass. The original user workbook imports with HTTP 200 and five tasks; exported/reimported Plan matches exactly. Quick-review finding fixed and covered by regression. No user workbook changes.
