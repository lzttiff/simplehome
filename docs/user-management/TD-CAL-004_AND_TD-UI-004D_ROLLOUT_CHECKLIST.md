# TD-CAL-004 and TD-UI-004D Rollout Checklist

Date: 2026-06-05
Workspace: simplehome

## Purpose
This artifact is the execution checklist for closing the remaining manual/rollout work:
- TD-CAL-004 (calendar toggle migration and rollout guards)
- TD-UI-004D (manual two-user QA sign-off)

## Preconditions
- Two test users available: User A and User B
- Access to the target MongoDB/database for migration evidence
- Application running with authentication enabled

## Section A: TD-CAL-004 Migration Evidence

### A1) Calendar toggle migration dry-run
Command:
- `npm run migrate:user-calendar-feature-toggles -- --dry-run --sample-limit 5`

Record:
- mode
- scanned
- skippedInvalidUsers
- usersWithUpdates
- defaultsInitialized
- normalizedExisting
- invalidReset

Expected:
- command exits successfully
- counters are deterministic on repeated dry-runs

### A2) Calendar toggle migration apply
Command:
- `npm run migrate:user-calendar-feature-toggles -- --apply --sample-limit 5`

Record:
- same counters as dry-run
- sampleUpdatedUserIds

Expected:
- command exits successfully
- re-running apply is idempotent (no unintended additional updates)

### A3) Post-apply idempotency check
Command:
- `npm run migrate:user-calendar-feature-toggles -- --apply --sample-limit 5`

Expected:
- usersWithUpdates should be 0 unless source documents changed

### A4) Server regression confirmation
Command:
- `npm run test:server -- routes.test.ts`
- `npm run check`

Expected:
- tests pass
- typecheck passes

## Section B: TD-CAL-004 Runtime Toggle Enforcement Manual QA

For each step below, capture request/response snippets and screenshot evidence.

### B1) Google sync toggle enforcement
1. Set User A `googleSyncEnabled=false` using `PATCH /api/user/calendar-feature-toggles`.
2. Call `GET /api/calendar/google/sync/status` as User A.

Expected:
- 403 response with disabled-toggle message.

### B2) Apple sync toggle enforcement
1. Set User A `appleSyncEnabled=false`.
2. Call `GET /api/calendar/apple/sync/status` as User A.

Expected:
- 403 response with disabled-toggle message.

### B3) Calendar export toggle enforcement
1. Set User A `calendarExportEnabled=false`.
2. Call `POST /api/calendar/google/feed-token`.
3. Call `POST /api/calendar/apple/feed-token`.

Expected:
- 403 response for both routes.

### B4) Auto-sync-on-delete toggle behavior
1. Set User A `calendarAutoSyncOnTaskChanges=false`.
2. Delete a task that previously had calendar exports.

Expected:
- Task deletion succeeds.
- No calendar auto-cleanup side-effect should be triggered.

## Section C: TD-UI-004D Manual Two-User Verification

Run with two concurrent authenticated sessions (User A and User B):
1. User A updates dashboard preferences (`includeMinor`, `includeMajor`, `deferredOnly`, `dateFilter`, `categoryFilters`).
2. User A updates export preferences (`selectedProvider`, `keepOutOfScopeEvents`).
3. User A changes settings active tab and reopens settings.
4. Refresh User A session and confirm persisted values are restored.
5. In User B session, confirm User A values do not appear.
6. User B changes one preference; confirm User A values remain unchanged.

Required captures:
- before/after screenshots for both users
- API responses for `GET /api/user/ui-preferences`
- payload snippets for `PATCH /api/user/ui-preferences`

## Sign-off Template

### TD-CAL-004
- Migration dry-run: PASS | FAIL
- Migration apply: PASS | FAIL
- Idempotency re-run: PASS | FAIL
- Runtime toggle enforcement manual QA: PASS | FAIL
- Overall TD-CAL-004 sign-off: PASS | FAIL
- Owner:
- Date:
- Notes:

### TD-UI-004D
- Manual two-user verification: PASS | FAIL
- Overall TD-UI-004D sign-off: PASS | FAIL
- Owner:
- Date:
- Notes:
