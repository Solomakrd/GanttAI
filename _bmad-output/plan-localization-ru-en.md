---
title: 'Add Russian and English localization'
type: 'feature'
ticket: ''
created: '2026-10-01'
status: 'built'
route: 'full'
route_source: 'auto'
baseline_revision: 'e20330172d3e483694876360b75bbebdb30387ba'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The frontend is English-only, so Russian-speaking users cannot use the workspace in their preferred language and dates are always formatted with an English locale.

**Approach:** Add complete Russian and English message catalogs and locale-aware formatting. On first load, select Russian for `ru*`, English for `en*`, and Russian for every other or unavailable system locale.

## Boundaries & Constraints

**Always:** Localize visible UI copy, validation and client-generated errors, loading/status text, accessible names, document metadata, task/version/count plurals, dates, weekdays, and duration units. Keep user, project, task, assistant, and server-provided content unchanged. Preserve UTC date arithmetic, canonical date-input values, keyboard/focus behavior, responsive resizing, API payloads, and local-storage keys unrelated to locale.

**Never:** Infer language from arbitrary task or assistant content; translate arbitrary backend/WebSocket error text by matching English strings; alter Excel schema headers, API contracts, timeline calculations, or persisted project data; add a third locale or a heavyweight localization dependency.

**Decision:** Provide a Russian/English selector in the header and persist the explicit choice in local storage. Use the system-derived locale only when no valid saved choice exists.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Russian system | Primary browser locale is `ru` or `ru-*` | Russian UI, metadata, dates, weekdays, units, and plurals render | Fall back to Russian if locale APIs are incomplete |
| English system | Primary browser locale is `en` or `en-*` | English UI and locale formatting render | Fall back to English catalog values for missing English keys |
| Unsupported system | Locale is neither Russian nor English, empty, or unavailable | Russian is selected | Do not expose unsupported locale values |
| Language change | User selects the other supported language | Mounted UI and document metadata update without reloading or losing state | Keep the current language if a malformed value is supplied |
| External message | API, WebSocket, task, or assistant supplies free text | Text is displayed verbatim inside the localized shell | Localize only known client-side fallback errors and statuses |

</frozen-after-approval>

## Code Map

- `frontend/src/i18n.jsx`, `frontend/src/locales/{ru,en}.js` -- add dependency-free locale detection, context, interpolation/plural helpers, and complete catalogs; use primary `navigator.language` subtag and Russian fallback.
- `frontend/src/main.jsx`, `frontend/index.html` -- install the provider and use Russian fallback metadata before React mounts.
- `frontend/src/App.jsx` -- localize project shell, states, notices, count/version text, separator names, and stale-result fallbacks; host the language control without changing workspace state transitions.
- `frontend/src/components/GanttChart.jsx` -- consume active locale for all labels, ARIA, dates, weekdays, counts, and duration units while retaining UTC geometry and zoom behavior.
- `frontend/src/components/PlanChat.jsx` -- localize the assistant shell, connection/operation states, client errors, controls, and composer; preserve message and server-event content verbatim.
- `frontend/src/components/ExcelControls.jsx` -- localize dialog copy, file validation, count feedback, operation states, and ARIA while retaining Russian workbook column headers and import/export behavior.
- `frontend/src/components/TaskDetailsModal.jsx`, `frontend/src/components/ResizeHandle.jsx` -- localize fields, validation, modal controls, and resize help while preserving focus and keyboard contracts.
- `frontend/src/*.test.jsx`, `frontend/src/testSetup.js` -- make locale setup deterministic and cover detection, unsupported fallback, runtime switching, Russian plurals/dates/metadata, and existing English interaction contracts.
- `frontend/src/api.js` -- behavioral boundary: do not change transport contracts or attempt to translate server text.

## Tasks & Acceptance

**Execution:**
- [x] `frontend/src/i18n.jsx`, `frontend/src/locales/{ru,en}.js`, `frontend/src/main.jsx`, `frontend/index.html` -- implement locale selection, catalogs, helpers, provider, and synchronized document metadata.
- [x] `frontend/src/App.jsx`, `frontend/src/components/*.jsx` -- replace hard-coded interface copy and fixed `en-US` formatters with catalog/locale usage while preserving domain content and behavior.
- [x] `frontend/src/styles.css` -- accommodate the language control at desktop and mobile widths without disrupting existing topbar actions.
- [x] `frontend/src/*.test.jsx`, `frontend/src/testSetup.js` -- retain behavioral coverage and test all locale-selection and switching matrix cases.

**Acceptance Criteria:**
- Given either supported locale, when any loading, empty, ready, modal, validation, import/export, chat, resize, or error UI is shown, then its client-owned visible and accessible copy uses that locale consistently.
- Given a locale change while a project is open, when the UI rerenders, then project, task, chat draft, selection, zoom, and operation state are retained.
- Given dates and numeric task durations, when the locale changes, then presentation follows that locale while underlying UTC dates and task values remain unchanged.
- Given the existing frontend suite and production build, when verification runs, then all prior interactions still pass alongside locale-specific tests.

## Implementation Notes

- Added a dependency-free provider with `ganttai.locale` persistence, browser-language detection, Russian fallback, catalog interpolation, and UTC-aware date formatting.
- Localized the full frontend shell and known client-generated API errors while preserving server, task, user, and assistant content verbatim.
- Added focused locale and error-boundary coverage; final verification completed with 53 passing tests, a successful Vite production build, and a clean `git diff --check`.

## Plan Change Log

## Review Triage Log

- `medium` / `patch` -- `App.jsx` discarded tagged server text during initial workspace-load failures; render the preserved server message inside the localized error shell and keep localized fallbacks for client failures.
- `medium` / `patch` -- `api.js` assembled structured validation locations with English `Sheet`/`row`/`column` labels; pass location fields to catalog formatting while preserving the server's validation message verbatim.
- `medium` / `patch` -- untagged JSON and browser exceptions were rendered as server text by operation catches; explicitly tag server-originated errors and map every untagged client exception to the relevant localized fallback.
- `false` / rejected -- the claimed missing-`Intl` failure requires an unsupported browser runtime not established by the repository or its Vite frontend target; unavailable, empty, and unsupported system locale values are already tested and select Russian without relying on locale inference.

## Design Notes

Use one small React context and plain catalogs because the application has two locales and no existing i18n dependency. Catalog functions should own grammar-sensitive plurals rather than constructing translated sentences from fragments. Keep `Intl.DateTimeFormat` in UTC to avoid shifting plan dates.

## Verification

**Commands:**
- `npm test -- --run` in `frontend/` -- expected: existing and locale-specific Vitest tests pass.
- `npm run build` in `frontend/` -- expected: Vite production build succeeds.

**Manual checks (if no CLI):**
- Inspect Russian, English, and unsupported browser locales at desktop/mobile widths; switch languages during an active task/chat/import flow and confirm state and layout are preserved.
