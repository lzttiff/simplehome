# Apple Calendar Two-Way Sync Plan

## Recommended Order
Do the export modal redesign first, with Apple two-way sync as a first-class constraint, then implement Apple sync behind the reorganized UI.

Use the companion document [EXPORT_SCHEDULE_REDESIGN_WITH_APPLE_SYNC.md](EXPORT_SCHEDULE_REDESIGN_WITH_APPLE_SYNC.md) as the UI and sequencing guide for that first step.

## Goal
Add Apple Calendar two-way sync with behavior parity to existing Google two-way sync, while keeping current Apple subscription and file export flows.

## Current Baseline
- Google two-way sync exists and is user-triggered.
- Apple supports one-way subscription feed and ICS file export only.
- Calendar export records already support provider-specific metadata (`google` and `apple`) and `syncMode` (`subscription`, `direct`, `file`).

## Assumptions
- Apple target is iCloud Calendar over CalDAV.
- First release remains manual/user-triggered sync (no background scheduler).
- Apple credentials use app-specific password (no OAuth flow).

## Non-Goals (Initial Release)
- Real-time webhook sync.
- Background auto-sync daemon.
- Multi-account Apple linking in one user profile.
- Full generic CalDAV provider marketplace support.

## Phase 0: Design and Security Decisions
### Outcomes
- Signed-off protocol and UX decisions.
- Security model for Apple credentials finalized.

### Work
1. Finalize provider scope: iCloud CalDAV first.
2. Confirm UX for connect flow:
   - Apple ID email
   - App-specific password
   - Optional calendar selection if multiple calendars are found.
3. Define parity rules with Google:
   - Push and pull date changes
   - Conflict resolution strategy
   - DONE marker behavior
4. Define secret handling:
   - Encrypt Apple credentials at rest.
   - Redact sensitive fields in logs.

### Exit Criteria
- Technical design doc and API contract reviewed.
- Security checklist approved.

## Phase 1: Backend Foundation (Connection + Storage)
### Outcomes
- Apple direct-sync connection can be created, validated, stored, and removed.

### New Environment Variables
- `APPLE_SYNC_ENCRYPTION_KEY` (required for credential encryption)
- Optional: `APPLE_SYNC_DEBUG=true`

### API Endpoints (proposed)
1. `GET /api/calendar/apple/sync/status`
2. `POST /api/calendar/apple/sync/connect`
3. `POST /api/calendar/apple/sync/disconnect`
4. `GET /api/calendar/apple/sync/scope`
5. `PUT /api/calendar/apple/sync/scope`
6. `POST /api/calendar/apple/sync`

### Request/Response Sketches
#### `POST /api/calendar/apple/sync/connect`
Request:
```json
{
  "appleIdEmail": "user@icloud.com",
  "appSpecificPassword": "xxxx-xxxx-xxxx-xxxx",
  "calendarId": "optional-calendar-id"
}
```
Response:
```json
{
  "connected": true,
  "accountEmail": "user@icloud.com",
  "calendarId": "simplehome-maintenance",
  "lastSyncedAt": null
}
```

#### `GET /api/calendar/apple/sync/status`
Response:
```json
{
  "configured": true,
  "connected": true,
  "accountEmail": "user@icloud.com",
  "calendarId": "simplehome-maintenance",
  "lastSyncedAt": "2026-04-30T10:00:00.000Z",
  "activeScopeCount": 8,
  "syncScopeVersion": 3,
  "syncScopeUpdatedAt": "2026-04-30T10:00:00.000Z"
}
```

#### `POST /api/calendar/apple/sync`
Request:
```json
{
  "selections": [
    { "taskId": "task-1", "includeMinor": true, "includeMajor": true }
  ]
}
```
Response:
```json
{
  "syncedTasks": 8,
  "pushedEvents": 14,
  "pulledChanges": 3,
  "createdEvents": 2,
  "updatedEvents": 12,
  "completedFromApple": 1,
  "rescheduledFromApple": 2,
  "lastSyncedAt": "2026-04-30T10:00:00.000Z",
  "calendarId": "simplehome-maintenance"
}
```

### File-Level Work
- `server/storage.ts`
  - Add Apple connection CRUD and sync-scope methods mirroring Google shape.
  - Add encrypted credential persistence.
- `server/routes.ts`
  - Add Apple direct sync routes with input validation and auth checks.
- `server/services/`
  - Add `appleCalendarSync.ts` for provider implementation.
  - Add `calendarSyncCommon.ts` for shared helpers (schedule parsing, export record upserts, conflict timestamp helpers).

### Exit Criteria
- Apple connect/disconnect/status works end-to-end.
- Scope can be saved and retrieved.
- Sensitive values are encrypted and never returned in API responses.

## Phase 2: Two-Way Sync Core Logic
### Outcomes
- Manual Apple sync pushes local changes and pulls Apple changes.

### Work
1. Implement Apple event upsert by task-kind (minor/major).
2. Persist per-task direct mapping in `calendarExports` with:
   - `provider: "apple"`
   - `syncMode: "direct"`
   - `eventIds`, `eventLinks`, `syncedDates`, `calendarId`, `lastSyncedAt`
3. Implement pull logic with conflict handling:
   - If local changed and Apple changed, use last-write-wins by timestamp.
4. Implement DONE marker behavior parity:
   - Detect `[DONE]` in summary/description.
   - Update `lastMaintenanceDate` and roll `nextMaintenanceDate` by interval months.
   - Remove DONE event and create new next-cycle event.
5. Remove out-of-scope events during scope reductions (same policy as Google).

### Exit Criteria
- Push/pull parity verified against Google behavior on sample tasks.
- No date regressions on timezone/date-only values.

## Phase 3: Frontend Integration
### Outcomes
- Users can connect, scope, sync, and disconnect Apple two-way sync from Export modal.

### Work
- `client/src/components/export-schedule-modal.tsx`
  1. Add Apple Two-Way Sync card beside existing Google section.
  2. Add connect form (Apple ID + app-specific password).
  3. Add sync actions:
     - Sync active scope
     - Update scope from current view
  4. Add disconnect flow and user messaging.
  5. Surface sync counters and failure toasts.
- Keep existing Apple subscription and file export controls unchanged as fallback modes.

### Exit Criteria
- Apple two-way controls are usable and do not break existing Google or one-way Apple flows.

## Phase 4: Tests, Logging, and Docs
### Outcomes
- Implementation is supportable and regression-resistant.

### Tests
- `tests/server/appleCalendarSync.test.ts` (new)
  - connect/disconnect/status
  - push create/update
  - pull date edits
  - conflict resolution
  - DONE marker completion path
  - missing/deleted event recovery
- `tests/server/routes.test.ts`
  - endpoint validation and error contracts
- Optional UI tests for modal state transitions.

### Logging and Observability
- Add provider-specific structured logs at INFO/WARN/ERROR.
- Add optional `APPLE_SYNC_DEBUG` verbose logs (non-sensitive only).
- Ensure no credential fields are logged.

### Documentation
- New doc: `docs/APPLE_CALENDAR_SYNC_SIMPLEHOME.md`
  - setup, env vars, connect flow, sync behavior, troubleshooting
- Update `docs/CALENDAR_EXPORT.md`
  - mark Apple two-way as available and clarify one-way vs two-way options.

### Exit Criteria
- Tests pass in CI.
- Docs are complete for setup and support.

## Dependencies and Libraries
- Add a CalDAV client library (evaluate `tsdav` first).
- Add/implement encryption helper for sensitive credentials.

## Key Risks and Mitigations
1. iCloud CalDAV auth/discovery variability.
   - Mitigation: build and expose explicit connection validation.
2. Provider timestamp differences.
   - Mitigation: isolate conflict resolution in shared helper with provider adapter.
3. Date-only/timezone drift.
   - Mitigation: reuse existing date normalization helpers and add regression tests.
4. Credential handling mistakes.
   - Mitigation: mandatory encryption key, redaction tests, and security review.

## Suggested Ticket Breakdown
1. Design + security decisions (Phase 0)
2. Storage + encrypted credential plumbing
3. Apple direct sync routes scaffold
4. Apple connect/status/disconnect vertical slice
5. Apple push sync implementation
6. Apple pull sync + conflicts
7. DONE marker parity
8. Scope removal parity
9. Export modal Apple two-way UI
10. Server tests
11. Docs and rollout notes

## Rollout Strategy
1. Feature flag Apple two-way sync for internal testing.
2. Dogfood with test iCloud accounts.
3. Enable for all users after validation and monitoring.
