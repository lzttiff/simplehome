# SimpleHome Design: Persistent Sync Scope and Overdue Backlog Semantics

## Status
- Draft design (implementation not started in this document)
- Goal: define behavior before coding

## Problem Statement
Current sync behavior is selection/filter-driven per run. Users expect a stable sync scope after connecting Google Calendar. Also, date edits (reschedule) and completion should be distinguished:
- Completion means maintenance happened.
- Reschedule means maintenance did not happen yet.

A corner case must be explicitly handled:
- `nextMaintenanceDate` is still in the past
- and `overdueBacklog` is true

Without clear rules, UI/counting can be confusing.

## Objectives
1. Make Google two-way sync scope persistent until explicitly changed.
2. Distinguish completion from reschedule in both Google and app workflows.
3. Introduce deterministic overdue semantics for all corner cases.
4. Keep behavior explainable in UI and telemetry.

## Definitions
- Active sync scope: explicit set of task IDs used by two-way sync runs.
- Completion event: user signals done (`[DONE]` in Google or app Complete action).
- Reschedule event: only `nextMaintenanceDate` changes; no completion signal.
- Overdue backlog (per task, per type): unresolved overdue debt from missed maintenance.

Maintenance types are independent:
- `minor`
- `major`

## Data Model Proposal
Extend each task with per-type overdue state:

```json
{
  "overdueBacklog": {
    "minor": false,
    "major": false
  },
  "overdueSince": {
    "minor": null,
    "major": null
  }
}
```

Notes:
- Keep fields optional in storage for migration compatibility.
- Treat missing as `false` / `null`.

## Sync Scope Proposal
Persist scope at user Google sync config level:

```json
{
  "activeTaskIds": ["..."],
  "scopeVersion": 3,
  "updatedAt": "...",
  "updatedBy": "..."
}
```

Behavior:
- `Sync Active Scope`: always uses persisted `activeTaskIds`.
- `Update Scope from Current View`: explicit scope rewrite.

Scope shrink options:
- Default: remove out-of-scope Google events and mark detached-removed.
- Optional: keep out-of-scope Google events and mark detached-kept.

## Overdue Semantics (Normative)
Evaluate per task/per type.

### Inputs
- `nextMaintenanceDate[type]`
- `lastMaintenanceDate[type]`
- `overdueBacklog[type]`
- `today`
- incoming action (complete/reschedule)

### Rule A: Completion
When completed:
1. Set `lastMaintenanceDate[type] = completionDate`.
2. Recompute `nextMaintenanceDate[type]` by interval rule.
3. Clear `overdueBacklog[type] = false`.
4. Clear `overdueSince[type] = null`.

### Rule B: Reschedule from overdue state
If maintenance was overdue before reschedule and no completion happened:
1. Update only `nextMaintenanceDate[type]`.
2. Set/keep `overdueBacklog[type] = true`.
3. If empty, set `overdueSince[type]` to first overdue date.

### Rule C: Reschedule from non-overdue state
If maintenance was not overdue before reschedule:
1. Update only `nextMaintenanceDate[type]`.
2. Keep `overdueBacklog[type] = false`.

### Rule D: Natural overdue (time passes)
If date is now past and not completed:
1. Task is overdue regardless of backlog flag.
2. Optionally set backlog true when crossing due date (implementation option).

Recommended approach:
- Keep backlog as intent/debt marker from explicit defer while overdue.
- Natural overdue can be computed from date alone.

## Corner Case Resolution
Case: `nextMaintenanceDate[type] < today` and `overdueBacklog[type] == true`.

Interpretation:
- Still overdue, with unresolved overdue debt.

Handling:
1. UI badge: `Overdue` (primary) + `Deferred` (secondary)
2. Counting:
- `pastDue` includes this task once for that type.
- Optional analytics counters can additionally track deferred-overdue.
3. Clearing condition:
- Only completion clears backlog.

No contradiction exists; backlog indicates history/intent, date indicates current schedule state.

## Dashboard and Stats Rules
Per maintenance type, a task is considered overdue if either:
1. `nextMaintenanceDate[type] < today`
2. `overdueBacklog[type] == true`

For task-level cards:
- show overdue if either type is overdue.
- show type-level chips where possible (Minor/Major).

## Google Sync Mapping Rules
### Google `[DONE]`
- Maps to Completion (Rule A).

### Google date edit without `[DONE]`
- Maps to Reschedule (Rule B or C based on pre-edit overdue state).

### Telemetry response additions
Return in sync summary:
- `completedFromGoogle`
- `rescheduledFromGoogle`
- `deferredFromGoogle` (optional alias if you prefer debt wording)

Keep `pulledChanges` as aggregate for backward compatibility.

## Disconnect Behavior
Disconnect modal options:
1. Disconnect only (keep calendar)
2. Disconnect and delete app calendar

Scope and detached states:
- Preserve local records unless user chooses hard reset.

## Migration Strategy
1. Add new fields with defaults-on-read.
2. Backfill scope from currently direct-synced task mappings where possible.
3. Do not hard-fail if old records are missing new fields.

## Phased Implementation Plan

### Phase 1: Data + backend foundations
1. Add overdue fields to task model (optional/default-on-read).
2. Add user-level persistent sync scope storage.
3. Update sync engine to read active scope by default.
4. Keep old API path as fallback if no scope exists.

Deliverable:
- No UI changes yet, but stable scope and state semantics exist.

### Phase 2: Intent-aware sync behavior
1. Implement reschedule vs completion branching in sync engine.
2. Add backlog state transitions per Rules A/B/C.
3. Extend sync response counters (`completedFromGoogle`, `rescheduledFromGoogle`).
4. Add tests for corner case combinations.

Deliverable:
- Correct domain behavior and telemetry.

### Phase 3: UI scope controls
1. Replace current button semantics with:
- `Sync Active Scope`
- `Update Scope from Current View`
2. Add shrink confirmation with default remove-out-of-scope.
3. Add optional keep-out-of-scope toggle.
4. Show active scope count vs current filtered count.

Deliverable:
- UX aligns with user mental model.

### Phase 4: Overdue UX and analytics
1. Add Overdue + Deferred indicators.
2. Update stats logic to include backlog rules.
3. Add optional filter: deferred backlog only.

Deliverable:
- Clear visibility of deferred debt.

### Phase 5: Disconnect enhancements
1. Add disconnect modal with delete-calendar option.
2. Wire safe calendar deletion and recovery messaging.

Deliverable:
- Better lifecycle management for connected calendars.

## Test Matrix (Minimum)
1. Complete overdue item -> backlog clears.
2. Reschedule overdue item -> backlog stays true.
3. Reschedule non-overdue item -> backlog stays false.
4. Date past + backlog true -> one overdue count, dual badges.
5. Scope shrink remove-out-of-scope -> events deleted.
6. Scope shrink keep-out-of-scope -> detached-kept.
7. Disconnect with delete -> calendar removed.
8. Disconnect without delete -> calendar remains.

## Open Decisions
1. Should natural overdue (time pass) auto-set backlog, or reserve backlog only for explicit defer?
2. Should overdue counts be per task or per maintenance type in summary cards?
3. Should keep-out-of-scope default vary by environment (prod vs dev)?

## Recommended Defaults
1. Backlog set only on explicit defer while overdue.
2. Overdue summary remains task-level for now (compatibility), type-level in details.
3. Scope shrink default: remove out-of-scope events.
4. Disconnect default: keep calendar unless user explicitly deletes.
