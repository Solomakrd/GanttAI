---
title: 'Route dependency lines around collisions'
type: 'feature'
ticket: ''
created: '2026-10-02'
status: 'built'
baseline_revision: 'eb5dd1b0d3ffd281811cb215dabcedcf5d1ccf77'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 2
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every dependency currently follows an independently calculated S-curve, so links can cross or overlap each other and can become difficult to trace in branched and merged plans.

**Approach:** Add deterministic corridor-based routing that steers links around task bars, separates competing links into lanes, fans shared connections apart after their fixed anchors, and prefers routes with fewer crossings. Keep rounded transitions and the existing two-color striped treatment.

## Boundaries & Constraints

**Always:** Preserve the exact right-center source and left-center target anchors, source/target task colors, alternating stripes, zoom behavior, horizontal scrolling, and support for upward as well as downward links. Produce stable geometry for identical tasks and zoom. Keep paths within the chart and away from unrelated task bars whenever a valid corridor exists.

**Never:** Change the task/dependency data contract, backend scheduling rules, row order, or task-bar positions. Do not add a graph-layout dependency. Do not claim zero crossings for arbitrarily dense or non-planar dependency graphs; minimize them deterministically and avoid introducing excessive chart width or height.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Simple chain | Consecutive one-to-one dependencies | Compact smooth routes retain exact anchors and remain easy to follow | No fallback needed |
| Branch or merge | Multiple links share a source or target | Routes fan into separate lanes immediately after/before the shared anchor | Shared anchor overlap is allowed only at the endpoint |
| Intervening task | A long unrelated bar occupies the direct route | Connector selects a free row gutter/corridor and does not cross the bar | Use the lowest-cost valid detour |
| Competing routes | Several links need the same corridor | Links receive deterministic lane offsets and prefer fewer crossings/overlaps | Dense graphs may retain the least-cost unavoidable crossing |
| Reverse row direction | Predecessor appears below its dependent task | The same routing rules work upward without leaving chart bounds | Clamp outer lanes to chart bounds |
| Zoom change | Zoom is 75% through 175% | Obstacles and routes recompute from rendered bar geometry | No stale DOM measurements |

</frozen-after-approval>

## Code Map

- `frontend/src/components/GanttChart.jsx` -- owns task positions, rendered bar geometry, dependency construction, zoom state, and the paired target/source SVG paths; replace inline curve calculation with routed path data while preserving colors and layering.
- `frontend/src/components/connectorRouting.js` -- new pure geometry module for obstacle rectangles, deterministic link ordering, lane allocation, collision/crossing scoring, and rounded SVG path generation.
- `frontend/src/components/connectorRouting.test.js` -- new focused unit coverage for collision avoidance, crossing reduction, fan-in/fan-out, upward links, bounds, determinism, and zoomed geometry.
- `frontend/src/App.test.jsx` -- existing integration assertions for anchors, stripes, imports, zoom, resize, and broad plans; adapt exact paths to router output and retain paired-path checks.
- `frontend/src/styles.css` -- existing connector layering and stripe styling; change only if route grouping requires a small selector adjustment.

## Tasks & Acceptance

**Execution:**
- [x] `frontend/src/components/connectorRouting.js` -- implement a pure deterministic router with spatial occupancy and bounded scoring; generate and flatten the actual rounded curves for obstacle, self-intersection, crossing, and overlap checks; search progressively through corridor candidates including both chart edges until an obstacle-free route is found; clamp fans to available space; and use one comparable occupancy sample for every candidate of a link -- prevent invalid fallbacks and geometry/scoring blind spots.
- [x] `frontend/src/components/GanttChart.jsx` -- pass rendered bars and unambiguously keyed links through the router for each zoom level, then render both color layers from each returned path -- preserve current visual semantics while using collision-aware routes.
- [x] `frontend/src/components/connectorRouting.test.js` -- cover every matrix row against flattened visible curves; include the real 10px gap, the reviewed farther-edge-corridor fixture, curved-path and internal-bend intersections, fan-in/fan-out, arbitrary IDs, bounds/determinism, all zoom levels, budget exhaustion with comparable scoring, and a valid 20-task/190-link fixture under 1000ms -- prevent repeated false-green geometry tests.
- [x] `frontend/src/App.test.jsx` -- update integration assertions for routed geometry and verify source/target layers remain identical, striped, correctly colored, marker-free, and responsive to zoom but not workspace resizing -- protect the complete chart behavior.

**Acceptance Criteria:**
- Given a plan with available routing corridors, when dependencies render, then no connector crosses an unrelated task bar and avoidable connector crossings are eliminated.
- Given several dependencies sharing an endpoint, when they render, then they use distinct nearby lanes while retaining the exact shared anchor.
- Given identical plan data and zoom, when the chart rerenders, then every dependency receives identical path data.
- Given an unavoidably dense graph, when routing completes, then the chart remains responsive and uses the deterministic lowest-cost routes rather than failing or leaving bounds.
- Given the frontend verification commands, when they complete, then all routing and existing application tests pass and the production build succeeds.

## Implementation Notes

- First implementation was discarded after review found endpoint crossings, self-overlapping short-gap fans, and unacceptable dense-plan runtime.
- Second implementation was discarded after review found omitted distant corridors, polyline-only checks for curved output, ignored bend intersections, and mixed scoring after budget exhaustion.

## Plan Change Log

- Review loop 1: the first router scored only core segments, used fixed 12px fans, and exhaustively compared candidates against all prior segments. Require complete visible-path scoring, gap-clamped fans, bounded candidate generation, spatial occupancy, and a 20-task/190-link runtime test under 1000ms. KEEP: pure pixel-space routing, exact anchors, obstacle clearance, deterministic output, rounded paths, stripe layering, colors, zoom support, and matrix-focused tests.
- Review loop 2: the second router limited corridors before proving a valid route, checked only straight waypoint segments while rendering curves, ignored intersections at internal bends, and exhausted one budget midway through candidate scoring. Require progressive corridor expansion with validated edge fallback, flattened rendered-curve geometry for every collision calculation, route-aware endpoint handling, and an identical occupancy comparison set for every candidate of a link. KEEP: spatial buckets, bounded work, gap-clamped fans, unambiguous keys, exact anchors, colors/stripes, deterministic ordering, and the dense performance fixture.

## Review Triage Log

- `high` -> `bad_plan`: complete rendered fan segments were omitted from occupancy/scoring, leaving an avoidable crossing in the competing-routes fixture despite a passing core-only test.
- `medium` -> `bad_plan`: fixed 12px endpoint fans exceed the real 10px consecutive-task gap and produce self-overlapping hooks in the common chain case.
- `high` -> `bad_plan`: exhaustive candidate, obstacle, and prior-segment comparisons took about 9.7 seconds for a valid 20-task/190-link plan, violating responsiveness.
- `high` -> `bad_plan`: limiting departure/arrival corridors to four nearest values forced an unchecked fallback through unrelated bars even though a chart-edge corridor was free.
- `high` -> `bad_plan`: obstacle and crossing checks used straight waypoint segments while the visible SVG used quadratic curves, so accepted routes could visibly intersect bars or each other.
- `medium` -> `bad_plan`: strict per-segment endpoint tests ignored intersections at internal route bends and allowed avoidable visible touches/crossings.
- `high` -> `bad_plan`: a shared budget could expire midway through a link, comparing fully penalized early candidates against length-only later candidates and selecting a crossing route.
- `false` -> `reject`: the quick review expected expansion after an obstacle-free batch, but the plan explicitly requires expansion only when no obstacle-free candidate exists and requires both chart edges in every batch; no failing route was demonstrated.
- `medium` -> `patch`: insertion-order occupancy truncation could omit more relevant nearby segments in dense plans; rank the fixed sample by geometric proximity with a stable id tie-breaker.
- `medium` -> `patch`: small-graph refinement scored later links against stale initial paths; rebuild bounded occupancy from the currently selected routes for each refinement.

## Design Notes

Use rendered pixel geometry, not DOM measurements. Route longer row spans first and search corridor candidates in deterministic bounded batches, always including both chart edges; expand to the next batch when no obstacle-free candidate exists, and never accept an unchecked fallback. Build the rounded path and a deterministic flattened approximation together, with enough subdivisions that its maximum geometric error stays below the stroke-clearance margin. Use that flattened visible geometry for bar avoidance, self-intersection, occupancy, crossings, and overlaps. Count intersections at internal bends; ignore a contact only when it is the true shared task anchor of both routes. Clamp endpoint fans to the available source-target gap so departure and arrival never reverse or retrace. Before scoring a link, select one deterministic capped set of nearby occupied segments and score every candidate against exactly that same set; never exhaust a budget midway through candidates. Treat obstacle collisions as forbidden, overlap as a stronger penalty than crossing, and length/bends as smaller penalties. Preserve deterministic output and the dense-plan runtime budget.

## Verification

**Commands:**
- `npm test -- --run src/components/connectorRouting.test.js src/App.test.jsx` from `frontend/` -- expected: routing unit tests and chart integration tests pass.
- `npm test -- --run` from `frontend/` -- expected: complete frontend suite passes.
- `npm run build` from `frontend/` -- expected: production build succeeds.

**Manual checks (if no CLI):**
- Open the seeded branch/merge plan and a dense imported plan, inspect 75%, 100%, and 175% zoom, and confirm routes avoid bars, separate where space permits, retain smooth corners and two-color stripes, and stay stable while resizing workspace columns.
