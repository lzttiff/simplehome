# TD-UI-004D Rollout Evidence

Date: 2026-06-05
Workspace: simplehome

## Scope
This artifact records rollout evidence for TD-UI-004D:
- migration output evidence
- automated server/client/typecheck evidence
- manual two-user verification checklist

## Automated Evidence

### 1) Migration dry-run evidence
Command:
- `npm run migrate:user-ui-preferences -- --dry-run --sample-limit 3`

Result:
- mode: `dry-run`
- scanned: `3`
- skippedInvalidUsers: `0`
- usersWithUpdates: `2`
- defaultsInitialized: `2`
- normalizedExisting: `0`
- invalidReset: `0`
- status: `PASS`

### 2) Server route coverage evidence
Command:
- `npm run test:server -- routes.test.ts`

Result:
- suites: `11 passed`
- tests: `140 passed`
- status: `PASS`

### 3) Client persistence coverage evidence
Command:
- `npm run test:client:ui-preferences`

Result:
- suites: `3 passed`
- tests: `16 passed`
- status: `PASS`

### 4) Type safety evidence
Command:
- `npm run check`

Result:
- TypeScript compile: `PASS`

## Manual Two-User Verification (Required)
Status: `PENDING MANUAL EXECUTION`

Run with two concurrent authenticated sessions (User A and User B):
1. User A updates dashboard filters (`includeMinor`, `includeMajor`, `deferredOnly`, `dateFilter`, `categoryFilters`).
2. User A updates export preferences (`selectedProvider`, `keepOutOfScopeEvents`).
3. User A changes settings active tab and reopens settings.
4. Refresh User A session and confirm all persisted values are restored.
5. In User B session, confirm User A changes do not appear.
6. Repeat one update in User B and confirm User A values remain unchanged.
7. Record screenshots and request/response logs for both users.

Required artifacts to attach:
- before/after screenshots for User A and User B
- captured API responses for `GET /api/user/ui-preferences`
- captured patch payload snippets for `PATCH /api/user/ui-preferences`

## Verdict
- Automated validation: `COMPLETE`
- Manual two-user verification: `PENDING`
- TD-UI-004D overall sign-off: `PENDING MANUAL QA`
