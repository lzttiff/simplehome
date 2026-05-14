# Apple Calendar Two-Way Sync Plan

## Status Overview
✅ **Completed**: Export modal redesign with tab-based layout ("Select Items", "Export Options", "History", "Help") and Apple two-way sync UI placeholders.

See [EXPORT_SCHEDULE_REDESIGN_WITH_APPLE_SYNC.md](EXPORT_SCHEDULE_REDESIGN_WITH_APPLE_SYNC.md) for redesign details.

**Current State**: The modal now has:
- Apple two-way sync UI in "Export Options" tab with functional status/connect/scope/disconnect controls
- Real Apple sync mutations wired to backend endpoints
- Connection status, scope controls, and disconnect flow are functional
- Backend Apple connection/scope/status/sync/disconnect endpoints are implemented
- Phase 2 push-state scaffold implemented: `apple/direct` `calendarExports` mapping is persisted during sync runs
- CalDAV client integrated (`tsdav`) with Apple credential validation on connect and real event upsert/delete transport in sync flows

**Next Step**: Execute Phase 2 core sync logic (CalDAV event CRUD, push/pull reconciliation, and DONE marker parity).

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
- Decision document captured in-repo and referenced by implementation PRs.

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

### Required Deliverable (add now)
- Create `docs/APPLE_CALENDAR_SYNC_DESIGN_SECURITY_DECISIONS.md` with:
  1. Provider scope and rationale (iCloud CalDAV first).
  2. Credential lifecycle: capture, encryption, storage, rotation, disconnect behavior.
  3. Logging policy: explicit redaction rules and prohibited fields.
  4. Threat model summary: credential theft, replay, accidental logging, misconfiguration.
  5. Operational guardrails: required env vars, startup checks, and failure modes.
  6. API security contract: auth requirements, payload validation, error code strategy.

### Phase 0 Checklist
- [x] Design+security decision doc created.
- [x] Design+security decision doc reviewed/sign-off.
- [x] Redaction assertions added (Apple error sanitizer + server unit tests).
- [x] Production env var validation documented (`APPLE_SYNC_ENCRYPTION_KEY`, optional CalDAV URL override).
- [x] Explicit disconnect semantics documented (what is deleted locally vs remotely).

Reference: `docs/APPLE_CALENDAR_SYNC_DESIGN_SECURITY_DECISIONS.md`

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
### Status
✅ **Core Logic Complete**: Endpoint flow/persistence, CalDAV push/pull, conflict policy, DONE marker parity, and recovery/idempotency hardening are implemented.

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

### Progress Notes (Phase 2)
- ✅ Added `tsdav` dependency and initialized CalDAV client in Apple sync service.
- ✅ Connect flow now validates Apple credentials against CalDAV login/fetch.
- ✅ Sync now performs create/update transport for Apple calendar objects per task-kind.
- ✅ Scope reduction now attempts deletion of out-of-scope Apple events.
- ✅ Pull ingestion for remote date edits now updates local `nextMaintenanceDate` with backlog-state transitions.
- ✅ Conflict policy finalized: timestamp-based arbitration (`LAST-MODIFIED`/`DTSTAMP` vs local `updatedAt`) with deterministic local tie-breaker.
- ✅ DONE marker parity implemented: `[DONE]` in Apple event summary/description now completes current cycle, rolls next date, clears backlog fields, and recreates next-cycle event.
- ✅ Recovery/idempotency hardening implemented:
  - bounded retry for transient DAV operations
  - stale mapping recovery to canonical deterministic filename
  - partial failure isolation (continue syncing remaining task/kind items)

### Phase 2 Execution Slices (tracking)
#### Slice 2A: Push Transport Hardening
- Status: ✅ Complete
- Scope:
  - create/update path via CalDAV
  - out-of-scope deletion attempt
  - `calendarExports` direct mapping updates

#### Slice 2B: Pull Ingestion
- Status: ✅ Complete
- Scope:
  - ✅ fetch Apple event dates by mapped objects
  - ✅ detect remote date edits
  - ✅ write back to `nextMaintenanceDate`
  - ✅ increment `pulledChanges`

#### Slice 2C: Conflict Resolution
- Status: ✅ Complete
- Scope:
  - ✅ define timestamp sources (Apple `LAST-MODIFIED`/fallback `DTSTAMP`, local `updatedAt`, record `lastSyncedAt`)
  - ✅ implement local-vs-remote arbitration
  - ✅ finalize tie-breaker for simultaneous edits (local wins when remote freshness is not provably newer)

#### Slice 2D: DONE Marker Parity
- Status: ✅ Complete
- Scope:
  - ✅ detect `[DONE]` markers from Apple event content
  - ✅ set `lastMaintenanceDate`, roll forward `nextMaintenanceDate`
  - ✅ clear backlog fields consistently with Google behavior

#### Slice 2E: Resilience and Recovery
- Status: ✅ Complete
- Scope:
  - ✅ missing/deleted event remapping strategy
  - ✅ partial failure handling and retry boundaries
  - ✅ idempotent re-runs without duplicate event creation

### Exit Criteria
- Push/pull parity verified against Google behavior on sample tasks.
- No date regressions on timezone/date-only values.

## Phase 3: Frontend Integration (UI Wiring)
### Status
✅ **Substantially Complete**: Apple two-way sync UI is wired to backend endpoints (connect/sync/scope/disconnect), with status and error handling.

### Outcomes
- Keep Apple sync flows stable while Phase 2 CalDAV event logic is added.
- Optional UX refinement: replace temporary prompt-based connect flow with in-modal form.

### Work
- `client/src/components/export-schedule-modal.tsx`
  1. ✅ Replace stub mutations with real API calls to backend Apple sync endpoints.
  2. ✅ Implement Apple connect submission path (currently prompt-based).
  3. ✅ Wire disconnect flow with optional calendar deletion guidance.
  4. ✅ Connect sync action buttons to `/api/calendar/apple/sync` endpoint.
  5. ✅ Ensure error toasts and sync counters display correctly.
  6. Optional: move connect inputs from prompts to an in-modal form.
- Existing Apple subscription and file export controls in same modal remain unchanged (already functional).

### Exit Criteria
- ✅ Real API mutations work end-to-end without breaking existing Google or one-way Apple flows.
- ✅ All Apple sync state flows through working backend endpoints.

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

Local reliability note:
- If Jest crashes with OOM while running Apple server tests, use `npm run test:server:apple-sync` (memory guardrails + in-band execution).
- Troubleshooting reference: `docs/TEST_RELIABILITY_MULTI_PHASE_PLAN.md` (Jest OOM Troubleshooting section).

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
- ✅ CalDAV client library added: `tsdav@2.2.1`.
- Add/implement encryption helper for sensitive credentials.

## Implementation Status Checklist

### Already Implemented ✅
- [x] Export modal UI redesign with tabs
- [x] Apple two-way sync "Keep In Sync" card in Export Options tab
- [x] AppleCalendarSyncStatus and AppleCalendarSyncScope interfaces
- [x] Stub mutations (show "coming soon" toast)
- [x] Connection status display structure
- [x] Sync control buttons (disabled/placeholder)
- [x] Disconnect button with confirmation dialog
- [x] Selection picker reused for Apple scope

### Not Yet Implemented ❌
- [x] Phase 0: Design + security decisions document
  - [x] `docs/APPLE_CALENDAR_SYNC_DESIGN_SECURITY_DECISIONS.md` created
  - [x] Review/sign-off completed
  - [x] Redaction and threat model review sign-off
- [x] Phase 1: Backend Apple connection storage
  - [x] MongoDB collection for Apple connections
  - [x] Encrypted credential persistence
  - [x] Connection CRUD methods in `storage.ts`
- [x] Phase 1: Apple sync routes
  - [x] `GET /api/calendar/apple/sync/status`
  - [x] `POST /api/calendar/apple/sync/connect`
  - [x] `POST /api/calendar/apple/sync/disconnect`
  - [x] `GET /api/calendar/apple/sync/scope`
  - [x] `PUT /api/calendar/apple/sync/scope`
  - [x] `POST /api/calendar/apple/sync`
- [x] Phase 1: Apple sync service scaffold
  - [x] `server/services/appleCalendarSync.ts`
  - [x] CalDAV client integration
  - [x] Push event CRUD operations (create/update/delete for scope removals)
- [ ] Phase 2: Two-way sync core logic
  - [x] Push-state mapping scaffold (`calendarExports` `apple/direct` metadata + counters)
  - [x] Push transport (local → Apple via CalDAV event CRUD)
  - [x] Slice 2B: Pull (Apple → local)
  - [ ] Slice 2C: Conflict resolution (tie-breaker/documentation completion)
  - [ ] Slice 2D: DONE marker handling
  - [ ] Slice 2E: Recovery and idempotency hardening
- [x] Phase 3: Wire real mutations
  - [x] Replace stub mutations with real API calls
  - [x] Connect form implementation (prompt-based)
  - [ ] Optional UX upgrade: in-modal credential form
- [ ] Phase 4: Tests and docs

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
1. Phase 0 decision doc (`APPLE_CALENDAR_SYNC_DESIGN_SECURITY_DECISIONS.md`) + review sign-off
2. ~~CalDAV client integration and account/calendar discovery~~ ✅ Implemented
3. ~~Slice 2A: Apple push sync implementation~~ ✅ Implemented (transport + mapping)
4. Slice 2B: Apple pull ingestion
5. Slice 2C: Conflict resolution policy + implementation
6. Slice 2D: DONE marker parity
7. Slice 2E: Recovery/idempotency hardening
8. Server tests (Phase 4)
9. Docs and rollout notes (Phase 4)
10. Optional UX upgrade: in-modal Apple credential form

## Rollout Strategy
1. Feature flag Apple two-way sync for internal testing.
2. Dogfood with test iCloud accounts.
3. Enable for all users after validation and monitoring.
