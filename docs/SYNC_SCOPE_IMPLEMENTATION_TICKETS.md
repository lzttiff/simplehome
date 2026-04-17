# Sync Scope Implementation Tickets

This file turns the design into PR-sized execution slices.

## Ticket 1: Phase 1 Foundation (Backend)
Goal: Add persistent active sync scope storage and APIs.

Scope:
- Add Google connection fields:
  - `activeSyncSelections`
  - `syncScopeVersion`
  - `syncScopeUpdatedAt`
- Add storage methods:
  - `getGoogleCalendarSyncScope(userId)`
  - `setGoogleCalendarSyncScope(userId, selections)`
- Add service helpers:
  - `getGoogleCalendarSyncScope(req)`
  - `setGoogleCalendarSyncScope(req, selections)`
  - scope resolution on sync (`initialize from request if empty, otherwise use persisted`)
- Add routes:
  - `GET /api/calendar/google/sync/scope`
  - `PUT /api/calendar/google/sync/scope`

Acceptance:
- First sync initializes active scope from current selection.
- Subsequent sync runs use active scope regardless of filter selection payload.
- Scope can be read and overwritten via API.

## Ticket 2: Phase 2 Intent Semantics (Backend)
Goal: Distinguish completion vs reschedule and add backlog semantics.

Scope:
- Add task fields:
  - `overdueBacklog` (minor/major)
  - `overdueSince` (minor/major)
- Update Google sync mapping:
  - `[DONE]` => completion path
  - date-only edit => reschedule path
- Add counters:
  - `completedFromGoogle`
  - `rescheduledFromGoogle`

Acceptance:
- Completion clears backlog.
- Reschedule from overdue keeps backlog.
- Telemetry exposes completion vs reschedule counts.

## Ticket 3: Phase 3 UI Scope UX
Goal: Make scope behavior explicit and predictable.

Scope:
- Replace current button semantics:
  - `Sync Active Scope`
  - `Update Scope from Current View`
- Show scope numbers:
  - active scope count
  - current selected/filtered count
- Add shrink confirmation:
  - default remove out-of-scope
  - option keep out-of-scope as detached

Acceptance:
- Users can sync without accidental scope changes.
- Scope changes are intentional and previewed.

## Ticket 4: Phase 4 Overdue UI/Stats
Goal: Surface deferred debt clearly and handle corner cases.

Scope:
- UI indicators:
  - Overdue
  - Deferred
- Stats logic includes backlog semantics
- Optional filter: deferred-only

Acceptance:
- Corner case (`past date` + `backlog`) is displayed consistently.
- No double counting in summary totals.

## Ticket 5: Phase 5 Disconnect Enhancements
Goal: Add disconnect option to delete app calendar.

Scope:
- Disconnect modal options:
  - Disconnect only
  - Disconnect + delete app calendar
- Backend delete behavior with safeguards.

Acceptance:
- App calendar can be deleted on disconnect when requested.
- Safe handling if calendar already missing.

## Suggested Delivery Order
1. Ticket 1 (foundation)
2. Ticket 2 (domain correctness)
3. Ticket 3 (UX controls)
4. Ticket 4 (reporting/indicators)
5. Ticket 5 (lifecycle cleanup)
