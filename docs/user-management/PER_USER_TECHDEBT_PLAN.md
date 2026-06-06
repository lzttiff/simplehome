# Per-User Tech Debt Plan (TD-AI-001 to TD-AI-007, TD-CAL-001 to TD-CAL-004, TD-UI-001 to TD-UI-004)

## Purpose
This document is the implementation tracker for migrating user-facing behavior, configuration, and related feature controls from app-wide defaults or local-only assumptions to user-scoped controls.

Primary objective:
- ensure AI provider selection, AI feature enablement, and AI credential usage are controlled per user.
- eliminate runtime AI key fallback from server-level environment/files for request execution paths.
- ensure Calendar Feature Toggles that affect user operations are controlled per user, not by app-wide defaults.
- ensure overlooked user-specific UI/runtime preferences are explicitly modeled when they should persist across sessions or influence authenticated workflows.

## Scope
In scope:
- TD-AI-001 through TD-AI-007
- TD-CAL-001 through TD-CAL-004 (calendar feature toggles for per-user operations)
- TD-UI-001 through TD-UI-004 (user-scoped UI/runtime preferences)
- data model, API surface, routing/provider resolution, migration, auditing, and tests

Out of scope:
- system-wide operational configuration (logging/debug/admin/security tokens) that is intentionally global
- transient one-session UI state that is not intended to persist, influence APIs, or alter downstream user operations
- provider-specific prompt tuning changes

## Success Criteria
- Changing DEFAULT_AI_PROVIDER does not change behavior for users with explicit user-level AI settings.
- Users with aiAgentEnabled=false cannot run AI generation endpoints.
- User AI settings are strictly user-scoped and cannot be read/updated across accounts.
- Runtime AI requests do not read provider credentials from server env/files (for example `GEMINI_API_KEY`, `gemini.key`, runtime OpenAI key).
- AI execution endpoints return explicit 4xx errors when the selected provider key is not configured for the authenticated user.
- All AI provider changes at user scope are auditable.
- Automated tests cover provider isolation and strict user-key enforcement behavior.
- Calendar feature toggles affecting sync/export/AI side-effects are persisted and enforced per user.
- Calendar feature toggle APIs are user-scoped and cannot be read/updated across accounts.
- User-scoped UI/runtime preferences that affect authenticated workflows are migrated away from implicit local-only behavior and have explicit API/storage ownership.

## Backlog Overview
| ID | Title | Planned Effort | Status |
| --- | --- | --- | --- |
| TD-AI-001 | Data model extension for per-user AI settings | Add aiProvider, aiAgentEnabled, aiPolicyVersion to user model and storage mappings | Completed |
| TD-AI-002 | Authenticated endpoint to read/update user AI preferences | Add user-scoped profile API for AI settings with strict validation | Completed |
| TD-AI-003 | Shared provider resolution helper | Centralize provider resolution and remove route-level drift | Completed |
| TD-AI-004 | Existing user migration script | Backfill legacy users with safe defaults (aiAgentEnabled=false) | Completed |
| TD-AI-005 | User-scope AI config audit logging | Emit audit records for settings changes and key resolution paths | Completed |
| TD-AI-006 | Per-user provider isolation tests | Add server and integration tests for isolation/fallback/authorization | Completed |
| TD-AI-007 | Per-user provider credential management | Add encrypted per-user API key storage and retrieval plumbing | Completed |
| TD-CAL-001 | Calendar feature toggle model | Add per-user calendar toggle fields and storage mappings | Completed |
| TD-CAL-002 | Calendar feature toggle API | Add authenticated read/update APIs for per-user calendar toggles | Completed |
| TD-CAL-003 | Calendar toggle enforcement | Apply per-user calendar toggles in calendar and AI side-effect routes | Completed |
| TD-CAL-004 | Calendar toggle migration/tests | Migrate legacy defaults and add isolation/regression coverage | In Progress |
| TD-UI-001 | UI/runtime preference inventory and model | Identify overlooked per-user UI/runtime preferences and define persisted ownership model | Completed |
| TD-UI-002 | UI preference API | Add authenticated read/update APIs for persisted per-user UI/runtime preferences | Completed |
| TD-UI-003 | UI preference enforcement | Apply persisted user preferences in dashboard/export/settings workflows where behavior should survive sessions | Completed |
| TD-UI-003E | Dashboard unsaved preference warning behavior | Warn on browser/tab/page exit when dashboard preferences changed but not yet persisted | Completed |
| TD-UI-003F | AI query readiness gating and setup prompt | Block AI queries when provider/credentials are missing and guide user to AI setup | Completed |
| TD-UI-004 | UI preference migration/tests | Migrate persisted defaults and add user-isolation/regression coverage | In Progress |

## TD-AI-007 Phased Migration Proposal (Pre-Deploy)

Rationale:
- the app has not been deployed yet, so we can move directly to per-user AI configuration without preserving long-term runtime compatibility behavior.
- use short phases to reduce risk and keep each review/test cycle focused.
- scope note: these phases apply only to TD-AI-007 hardening/cutover (runtime endpoint canonicalization, alias deprecation, and strict per-user runtime behavior). They do not re-scope TD-AI-001 through TD-AI-006.

### Phase 1 - Documentation and Contract Freeze (current)
Objectives:
- define canonical user-scoped AI API paths.
- mark legacy `/api/ai/...` paths as deprecated in documentation.
- publish cutover order and exit criteria.

Canonical target endpoints:
- `POST /api/user/ai/generate-tasks`
- `POST /api/user/ai/quick-suggestions`

Deprecated endpoints (documentation-only in this phase):
- `POST /api/ai/generate-tasks` (deprecated)
- `POST /api/ai/quick-suggestions` (deprecated)

Exit criteria:
- maintainer and user-management docs clearly identify canonical vs deprecated paths.
- no new documentation introduces `/api/ai/...` as the preferred path.

### Phase 2 - Backend Cutover with Temporary Alias
Objectives:
- implement canonical `/api/user/ai/...` routes.
- keep `/api/ai/...` as temporary aliases with deprecation signaling.
- enforce strict per-user provider/key runtime behavior.

Exit criteria:
- canonical endpoints are fully functional.
- alias endpoints return deprecation metadata and route parity is verified.

### Phase 3 - Client and Test Migration
Objectives:
- move frontend API calls to canonical `/api/user/ai/...` paths.
- update tests to validate strict per-user behavior and canonical route usage.

Exit criteria:
- client code no longer depends on `/api/ai/...` paths.
- tests pass with canonical routes as primary.

### Phase 4 - Alias Removal and Legacy Cleanup
Objectives:
- remove deprecated `/api/ai/...` aliases.
- remove legacy runtime AI config assumptions from docs and tests.

Exit criteria:
- no `/api/ai/...` runtime routes remain.
- docs and tests reference only canonical user-scoped API paths.

TD-AI-007 phase tracking:
- Phase 1: Completed
- Phase 2: Completed
- Phase 3: Completed
- Phase 4: Completed

## API Deprecation Register

Purpose:
- provide one authoritative list of deprecated API paths during the per-user migration.

| Deprecated Endpoint | Canonical Replacement | Scope | Status | Planned Removal |
| --- | --- | --- | --- | --- |
| `POST /api/ai/generate-tasks` | `POST /api/user/ai/generate-tasks` | TD-AI-007 runtime endpoint canonicalization | Deprecated compatibility alias | TD-AI-007 Phase 4 |
| `POST /api/ai/quick-suggestions` | `POST /api/user/ai/quick-suggestions` | TD-AI-007 runtime endpoint canonicalization | Deprecated compatibility alias | TD-AI-007 Phase 4 |

Deprecation policy:
- deprecated endpoints remain temporarily for compatibility during Phase 2 and Phase 3.
- new client code and documentation must use canonical `/api/user/ai/...` paths only.
- remove deprecated endpoints in Phase 4 after client/test migration is complete.

## API Namespace Policy

Self-service user APIs:
- use `/api/user/...` for the currently authenticated user.
- derive identity from the authenticated request context only.
- do not accept target `userId` in self-service routes.

Admin/server-wide APIs:
- reserve `/api/admin/...` for server-wide configuration or privileged admin-only operations.
- any future cross-user admin operation must live under `/api/admin/...` with explicit authorization.

User listing policy:
- no `GET /api/admin/users` listing API is planned in this workstream.
- database queries remain the preferred operational path when maintainers need user inventory outside the application.

## Completion Tips for Remaining AI Work

Use this as the short execution guide for the items that are not yet fully closed out.

### TD-AI-004 Migration Script
- Keep the migration idempotent and dry-run friendly.
- Run dry-run first, record counts, then apply only after the guard output is clean.
- Preserve an explicit backup/rollback path and document any opt-in exceptions.

### TD-AI-005 Audit Logging
- Verify audit payloads are redacted before writing to disk.
- Test both the mutation event and the removal event so the lifecycle is covered.
- Keep request metadata minimal and structured; do not leak credentials or provider secrets.

### TD-AI-006 Isolation and Fallback Tests
- Add tests that prove one user cannot see or change another user’s AI preferences/credentials.
- Cover request override guard behavior separately from normal user preference resolution.
- Keep the tests focused on API behavior and storage scoping rather than implementation details.

### TD-AI-007 Credential Management and Cutover
- Finish the four-phase cutover in order: docs, backend aliasing, client/test migration, alias removal.
- Keep `/api/user/ai/...` as the canonical path and leave `/api/ai/...` as temporary compatibility only.
- Remove runtime fallback assumptions last, after client and test callers have been moved.

### Cross-cutting Completion Rule
- If a feature changes behavior for a signed-in user across sessions or workflows, it should have an explicit user-scoped API or storage owner.
- If it is server-wide/admin-only, keep it under `/api/admin/...` and require explicit authorization.

## Detailed Plan

## TD-UI Completion Playbook

Use this execution order to complete TD-UI-001 through TD-UI-004 with clean scope boundaries and test evidence.

### Step 1 - Freeze persisted preference contract (TD-UI-001)
Actions:
- finalize the persisted keys that should survive sessions (and explicitly reject transient-only state).
- define one canonical shape for user UI preferences in shared types.
- document default values for missing preference documents.

Implementation targets:
- `shared/schema.ts` for the contract type and validation schema.
- `docs/user-management/PER_USER_TECHDEBT_PLAN.md` TD-UI sections for final accepted keys.

Done when:
- each persisted key has a type, default, and owning workflow.
- transient-only keys are explicitly listed as out of scope.

### Step 2 - Implement user-scoped API and storage (TD-UI-002)
Actions:
- add `GET /api/user/ui-preferences` and `PATCH /api/user/ui-preferences`.
- enforce auth scope from session user only (no target user id in payload/path).
- reject unknown keys and invalid value types.
- add storage methods for read/update with partial patch behavior.

Implementation targets:
- `server/routes.ts` for endpoints and validation wiring.
- `server/storage.ts` for persistence methods.

Done when:
- authenticated users can read/update only their own preferences.
- 400 is returned for schema violations and 401 for unauthenticated requests.

### Step 3 - Wire UI workflows to persisted preferences (TD-UI-003)
Actions:
- load persisted preferences on dashboard/settings/export entry points.
- apply defaults from API for initial state.
- persist preference changes after user actions that should survive sessions.
- keep transient UI-only state local and unpersisted.

Implementation targets:
- `client/src/pages/dashboard.tsx`
- `client/src/components/export-schedule-modal.tsx`
- `client/src/components/user-settings-modal.tsx`

Done when:
- user sees stable preference behavior after refresh/re-login.
- one user's preference changes never affect another user session.

### Step 4 - Add migration and regression coverage (TD-UI-004)
Actions:
- add backfill/default initialization for existing users with missing preference records.
- make migration idempotent and dry-run friendly.
- add route tests for auth, validation, and cross-user isolation.
- add UI tests for preference load/apply/save loops.

Implementation targets:
- `scripts/` migration script for UI preferences.
- `tests/server/` route/isolation tests.
- `tests/client/` workflow persistence tests.

Done when:
- re-running migration does not produce unintended changes.
- tests verify isolation, validation, and continuity across sessions.

### Step 5 - Execute rollout evidence checklist
1. Capture pre-migration sample user preference state.
2. Run dry-run migration and save output.
3. Run apply migration and capture before/after diff for sample users.
4. Run server and client targeted tests.
5. Perform manual QA pass with two concurrent test users.
6. Attach command output and screenshots/logs to release evidence.

Suggested validation commands:
- `npm run test:server`
- `npm run test:client:targeted`
- `npm run check`

### Step 6 - Mark TD-UI tickets complete
Completion gate:
- TD-UI-001 complete after contract/default sign-off.
- TD-UI-002 complete after API auth/validation/isolation tests pass.
- TD-UI-003 complete after UI load/apply/save behavior is verified.
- TD-UI-004 complete after migration idempotency and evidence capture are done.

### TD-UI Ticket Breakdown (Execution-Ready)

| Ticket | Scope | Suggested Owner | Estimate | Depends On | Acceptance Test |
| --- | --- | --- | --- | --- | --- |
| TD-UI-001A | Finalize persisted preference key list and defaults | Product + Backend | 0.5 day | None | Approved key/default matrix is documented and signed off |
| TD-UI-001B | Add shared schema/types for persisted UI preferences | Backend | 0.5 day | TD-UI-001A | Typecheck passes and invalid keys/types fail schema validation |
| TD-UI-002A | Add `GET /api/user/ui-preferences` route | Backend | 0.5 day | TD-UI-001B | Authenticated user gets only own preferences; unauthenticated returns 401 |
| TD-UI-002B | Add `PATCH /api/user/ui-preferences` route with strict validation | Backend | 1 day | TD-UI-002A | Valid payload persists, invalid payload returns 400, cross-user write is impossible |
| TD-UI-002C | Storage read/update methods for UI preferences | Backend | 0.5 day | TD-UI-001B | Preference patching is persisted and read back correctly |
| TD-UI-003A | Dashboard preference load/apply/save wiring | Frontend | 1 day | TD-UI-002B, TD-UI-002C | Preferences survive refresh/re-login and match persisted values |
| TD-UI-003B | Export modal preference load/apply/save wiring | Frontend | 1 day | TD-UI-002B, TD-UI-002C | Provider/tab/scope defaults reload correctly for same user |
| TD-UI-003C | Settings modal tab/default preference persistence | Frontend | 0.5 day | TD-UI-002B, TD-UI-002C | Re-entering settings restores persisted tab/default behavior |
| TD-UI-003D | Settings modal Apple Calendar connection setup | Frontend | 0.5 day | TD-UI-003C | Apple Calendar setup is available in Settings alongside Google and can connect/disconnect from the same user-facing surface |
| TD-UI-003E | Dashboard unsaved preference warning behavior | Frontend | 0.5 day | TD-UI-003A | Browser warns on reload/close/navigate-away when dashboard preference snapshot differs from last saved server snapshot |
| TD-UI-003F | AI query readiness gating and setup prompt | Frontend | 0.5 day | TD-UI-002B, TD-UI-003C | AI query entry points block execution when preferred provider or required credential is missing and show a clear setup path |
| TD-UI-004A | UI preference backfill/default migration script | Backend | 1 day | TD-UI-001B | Dry-run and apply modes work; rerun is idempotent |
| TD-UI-004B | Server tests for auth/validation/isolation | QA + Backend | 1 day | TD-UI-002B, TD-UI-002C | Route tests pass for 401/400/isolation cases |
| TD-UI-004C | Client tests for load/apply/save loops | QA + Frontend | 1 day | TD-UI-003A, TD-UI-003B, TD-UI-003C | Client tests pass for persistence across session reloads |
| TD-UI-004D | Rollout evidence capture and sign-off | QA/Release | 0.5 day | TD-UI-004A, TD-UI-004B, TD-UI-004C | Evidence bundle includes migration output, test output, and manual two-user verification |

Implementation status note (2026-06-05):
- TD-UI-002C storage scope (read/update methods and patch persistence behavior) is implemented and verified as part of TD-UI-002A and TD-UI-002B delivery.
- Evidence: commits `c15ecdf` (TD-UI-002A), `71bc341` (TD-UI-002B), and passing `npm run check` plus `npm run test:server -- routes.test.ts`.
- No separate TD-UI-002C-only commit is required unless release bookkeeping later requires ticket-isolated commit history.
- TD-UI-003A dashboard load/apply/save wiring is implemented in `client/src/pages/dashboard.tsx` and validated by targeted client tests.
- Evidence: passing `npm run test:client:targeted` (includes `client/src/pages/dashboard.test.tsx`) and passing `npm run check`.
- TD-UI-003F AI readiness gating is implemented for interactive AI query entry points and now routes users to AI Preferences setup.
- Evidence: client readiness checks in AI query components plus server-side provider-selection guard to prevent provider fallback when user setup is incomplete.
- TD-UI-003F follow-up hardening: item/category AI schedule generation now avoids cross-provider fallback when the secondary provider has no configured user key, so provider-mismatch errors no longer mask the selected provider failure path.
- Evidence: passing `npm run check` and passing `npm run test:server -- maintenanceAi.test.ts ai-provider-routes.test.ts` after the fallback guard update in `server/services/maintenanceAi.ts`.
- TD-UI-003B export modal load/apply/save wiring is implemented in `client/src/components/export-schedule-modal.tsx` for persisted `selectedProvider` and `keepOutOfScopeEvents`.
- Evidence: passing focused test run `./node_modules/.bin/jest --config /tmp/jest.client.single.cjs --runInBand --silent`, plus passing `npm run test:client:targeted` and `npm run check`.
- TD-UI-003C settings modal tab/default persistence is implemented in `client/src/components/user-settings-modal.tsx` via persisted `settingsActiveTab` hydration and debounced save.
- Evidence: passing focused test run `./node_modules/.bin/jest --runInBand --silent --config ./jest.config.js --testMatch='**/client/src/components/user-settings-modal.test.tsx'`, plus passing `npm run test:client:targeted` and `npm run check`.
- TD-UI-003D settings modal Apple Calendar connection setup is implemented in `client/src/components/user-settings-modal.tsx` with Apple sync status, connect/disconnect actions, and calendar ID display alongside Google.
- TD-UI-003D now also includes a masked Apple app-specific password field with a reveal/hide toggle so users can verify what they typed without showing it by default.
- TD-UI-003D now includes a safety recommendation to set a dedicated Apple calendar ID for SimpleHome to reduce risk of affecting unrelated personal events during scope cleanup.
- Evidence: passing focused test run `./node_modules/.bin/jest --runInBand --silent --config ./jest.config.js --testMatch='**/client/src/components/user-settings-modal.test.tsx'`, plus passing `npm run check`.
- TD-UI-003E dashboard unsaved preference warning behavior is implemented in `client/src/pages/dashboard.tsx` using `beforeunload` when the in-memory preference snapshot differs from the last persisted snapshot.
- TD-UI-003E behavior note: browser-native warning appears on tab close, window close, reload, and external navigation; browser text is generic and not customizable.
- TD-UI-003E behavior note: this warning covers browser exit/navigation and does not replace autosave debounced persistence semantics.
- Evidence: passing `npm run check` after implementing the dashboard `beforeunload` guard.
- TD-UI-004A UI preference backfill/default migration script is implemented in `scripts/migrate-user-ui-preferences.ts` with dry-run default behavior and idempotent apply mode.
- Evidence: migration command `npm run migrate:user-ui-preferences` (dry-run) and `npm run migrate:user-ui-preferences -- --apply`; code validation by passing `npm run check`.
- TD-UI-004B server tests for auth/validation/isolation are expanded in `tests/server/routes.test.ts` for `/api/user/ui-preferences`, including unauthenticated 401 and cross-user payload rejection coverage.
- Evidence: passing `npm run test:server -- routes.test.ts` and passing `npm run check`.
- TD-UI-004C client tests for load/apply/save persistence loops are covered across dashboard/export/settings in `client/src/pages/dashboard.test.tsx`, `client/src/components/export-schedule-modal.test.tsx`, and `client/src/components/user-settings-modal.test.tsx`.
- Evidence: passing `npm run test:client:ui-preferences` and passing `npm run check`.
- TD-UI-004D rollout evidence artifact is tracked in `docs/user-management/TD-UI-004D_EVIDENCE.md` with migration dry-run output, server/client/typecheck pass records, and manual two-user verification checklist.
- Current status: automated evidence complete; final TD-UI-004D sign-off pending manual two-user QA execution artifacts.

Suggested execution order:
1. TD-UI-001A
2. TD-UI-001B
3. TD-UI-002C
4. TD-UI-002A
5. TD-UI-002B
6. TD-UI-003A
7. TD-UI-003B
8. TD-UI-003C
9. TD-UI-003D
10. TD-UI-003E
11. TD-UI-003F
12. TD-UI-004A
13. TD-UI-004B
14. TD-UI-004C
15. TD-UI-004D

### TD-UI-001A Approval Artifact

Approval document:
- use this file as the source of truth: `docs/user-management/PER_USER_TECHDEBT_PLAN.md`.
- keep the approved matrix directly in this section so product, backend, and QA sign off on the same artifact.

Matrix to approve for TD-UI-001A:

| Preference Key | Workflow Surface | Persisted (Y/N) | Default | Storage Owner | API Owner | Validation Rule | Reason |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `includeMinor` | Dashboard | Y | `true` | User UI preferences document | `PATCH /api/user/ui-preferences` | boolean only | Affects recurring dashboard filtering across sessions |
| `includeMajor` | Dashboard | Y | `true` | User UI preferences document | `PATCH /api/user/ui-preferences` | boolean only | Affects recurring dashboard filtering across sessions |
| `deferredOnly` | Dashboard | Y | `false` | User UI preferences document | `PATCH /api/user/ui-preferences` | boolean only | Affects recurring dashboard filtering across sessions |
| `sortBy` | Dashboard | Y | `dueDateAsc` | User UI preferences document | `PATCH /api/user/ui-preferences` | enum only | Maintains consistent view ordering per user |
| `dateFilter` | Dashboard | Y | `all` | User UI preferences document | `PATCH /api/user/ui-preferences` | enum only | Controls recurring date scope across sessions |
| `categoryFilters` | Dashboard | Y | `[]` | User UI preferences document | `PATCH /api/user/ui-preferences` | string array only | Keeps user-specific category view preferences |
| `selectedProvider` | Export modal | Y | `google` | User UI preferences document | `PATCH /api/user/ui-preferences` | enum only | Keeps export workflow default provider per user |
| `keepOutOfScopeEvents` | Export modal | Y | `false` | User UI preferences document | `PATCH /api/user/ui-preferences` | boolean only | Controls repeated export behavior choice |
| `activeTab` (settings) | Settings modal | Y | `profile` | User UI preferences document | `PATCH /api/user/ui-preferences` | enum only | Improves continuity in frequently revisited settings flow |
| `activeTab` (export modal) | Export modal | N | N/A | Local component state | N/A | N/A | Transient navigation state; no cross-session requirement |

Sign-off checklist for TD-UI-001A:
1. Product confirms persisted keys and defaults.
2. Backend confirms storage owner and API validation feasibility.
3. QA confirms each persisted key has an observable behavior for regression tests.
4. Out-of-scope transient keys are explicitly marked `Persisted (Y/N)=N`.

### TD-UI-001 UI/Runtime Preference Inventory and Model
Objective:
- identify overlooked user-specific UI/runtime preferences and decide which ones must be explicitly persisted under user scope.

Confirmed user-specific surfaces observed in the current app:
- dashboard view preferences in `client/src/pages/dashboard.tsx`:
  - `includeMinor`
  - `includeMajor`
  - `deferredOnly`
  - `sortBy`
  - `dateFilter`
  - category filter selections derived from `categoryFilters`
- export workflow preferences in `client/src/components/export-schedule-modal.tsx`:
  - `selectedProvider`
  - `keepOutOfScopeEvents`
  - `activeTab`
- settings/navigation preferences in `client/src/components/user-settings-modal.tsx`:
  - `activeTab`

Modeling rule:
- persist only preferences that should survive sessions, influence authenticated workflows, or alter downstream operations.
- keep purely transient one-off interaction state out of scope unless product requirements promote it to a persisted preference.

Acceptance checks:
- the plan clearly distinguishes persisted user preferences from transient local UI state.
- each included preference has an owning API/storage path.

### TD-UI-002 UI Preference API
Objective:
- provide authenticated API support for persisted per-user UI/runtime preferences.

Planned API updates:
- `GET /api/user/ui-preferences`
- `PATCH /api/user/ui-preferences`

Initial preference groups to evaluate:
- dashboard preferences:
  - `includeMinor`
  - `includeMajor`
  - `deferredOnly`
  - `sortBy`
  - `dateFilter`
  - category filter selections
- export workflow defaults:
  - preferred calendar/export provider
  - `keepOutOfScopeEvents`
  - default export tab when reopening the workflow

Acceptance checks:
- only authenticated users can read/update their own UI preferences.
- unknown preference keys and invalid types are rejected.

### TD-UI-003 UI Preference Enforcement
Objective:
- apply persisted user preferences to runtime UI workflows where continuity across sessions matters.

Planned enforcement areas:
- dashboard default filter/sort/view behavior.
- export modal default provider/tab/scope behavior.
- settings modal calendar tab Apple connection setup so the Apple flow is available alongside Google.
- any future authenticated workflow that currently relies on implicit local-only state but should become user-owned.

Acceptance checks:
- persisted preferences are applied when the user re-enters the workflow.
- one user’s preferences never leak into another user’s session.

### TD-UI-003E Dashboard Unsaved Preference Warning Behavior
Objective:
- make unsaved dashboard preference state visible and safer by warning users before browser exit/navigation when local changes have not yet been persisted.

Behavior to track:
- dashboard preference persistence remains debounced (currently 350ms) to coalesce rapid edits.
- when current dashboard preference snapshot differs from the last successful persisted snapshot, register a `beforeunload` warning.
- warning is cleared after successful persistence (snapshot parity restored).

Scope notes:
- this ticket is specifically for browser exit/navigation warning semantics.
- browser warning copy is user-agent controlled and not customizable.

Acceptance checks:
- warning appears on tab close, window close, reload, and external navigation while unsaved dashboard preference changes exist.
- warning does not appear when there are no unsaved dashboard preference changes.

### TD-UI-003F AI Query Readiness Gating and Setup Prompt
Objective:
- prevent AI query execution when required user AI setup is incomplete, and direct the user to complete provider and credential configuration.

Delivered work:
- added shared client readiness checks for AI agent enabled status, provider selection, and provider credential presence.
- blocked AI query execution in interactive AI entry points when readiness checks fail.
- added actionable setup prompts that open Settings directly to AI Preferences.
- added server-side provider-selection enforcement for AI query endpoints to prevent execution when no provider is configured.

Behavior to track:
- before running AI query actions, validate that AI agent is enabled, a preferred provider is selected, and required provider credential is available.
- if readiness checks fail, block the AI request at the UI layer and show a clear setup prompt.
- setup prompt should route users to the AI Preferences setup flow in settings.

Scope notes:
- this ticket is UI gating and setup guidance only; backend authorization and strict credential enforcement remain server-side.
- applies to all interactive AI query entry points where user-initiated AI generation can occur.

Acceptance checks:
- AI actions are disabled or blocked with actionable messaging when provider selection is missing.
- AI actions are disabled or blocked with actionable messaging when required credential is missing.
- user can navigate directly from the prompt to the setup surface and retry successfully after configuration.

### TD-UI-004 UI Preference Migration and Tests
Objective:
- backfill or safely initialize persisted UI preferences and add regression coverage.

Planned work:
- define defaults for existing users when no persisted preference document exists.
- add route and integration tests for per-user preference isolation.
- extend strict-scoping rollout checks to cover persisted UI/runtime preference behavior where applicable.

Acceptance checks:
- migration/default initialization is idempotent.
- authenticated workflows remain stable when preferences are missing and are then backfilled.

### TD-UI-004A UI Preference Backfill/Default Migration Script
Objective:
- initialize missing or malformed `uiPreferences` documents to canonical defaults and normalize partial persisted payloads.

Delivered work:
- added migration script: `scripts/migrate-user-ui-preferences.ts`
- added npm command: `npm run migrate:user-ui-preferences`
- dry-run is the default mode; apply mode requires explicit `--apply`
- script emits deterministic summary counters:
  - `scanned`
  - `usersWithUpdates`
  - `defaultsInitialized`
  - `normalizedExisting`
  - `invalidReset`
- script supports optional `--sample-limit` output for rollout evidence snapshots.

Execution examples:
- Dry run (default): `npm run migrate:user-ui-preferences`
- Apply: `npm run migrate:user-ui-preferences -- --apply`
- Apply with larger sample output: `npm run migrate:user-ui-preferences -- --apply --sample-limit 25`

Acceptance checks:
- rerunning after apply produces no additional updates unless source data changed.
- malformed legacy `uiPreferences` payloads are safely reset to schema defaults.

Current evidence state:
- Implementation complete.
- Staging/production execution evidence to be captured during rollout.

### TD-CAL-001 Calendar Feature Toggle Model
Objective:
- define and persist per-user calendar operation toggles used by runtime routes.

Planned work:
- add a user-scoped calendar feature toggle model in storage (embedded user settings or dedicated collection).
- proposed toggle examples (final list to be confirmed during implementation):
  - `googleSyncEnabled`
  - `appleSyncEnabled`
  - `calendarAutoSyncOnTaskChanges`
  - `calendarExportEnabled`
- default new users to safe values with explicit ownership under `userId`.

Acceptance checks:
- toggles are always resolved from authenticated user scope.
- no app-wide default toggle is used as runtime source for user operations.

### TD-CAL-002 Calendar Feature Toggle API
Objective:
- provide user-scoped APIs to read/update calendar feature toggles.

Planned API updates:
- `GET /api/user/calendar-feature-toggles`
- `PATCH /api/user/calendar-feature-toggles`

Validation and auth requirements:
- requests must be authenticated.
- payload validation rejects unknown toggle keys and invalid value types.
- cross-account access is prohibited; user id must come from session/auth context only.

Acceptance checks:
- users can only read/update their own calendar toggle state.
- unauthorized requests return 401.

### TD-CAL-003 Calendar Toggle Enforcement
Objective:
- ensure runtime routes honor per-user calendar toggle settings.

Planned enforcement areas:
- calendar sync trigger paths (Google and Apple).
- calendar export-related paths.
- AI endpoints that create calendar side-effects indirectly through task/calendar flows.

Acceptance checks:
- disabled toggles block corresponding behavior with explicit 4xx responses.
- enabled toggles allow behavior without requiring app-wide switch changes.

### TD-CAL-004 Calendar Toggle Migration and Tests
Objective:
- migrate legacy calendar toggle assumptions and prevent regressions.

Delivered work:
- added migration script: `scripts/migrate-user-calendar-feature-toggles.ts`
- added npm command: `npm run migrate:user-calendar-feature-toggles`
- dry-run is the default mode; apply mode requires explicit `--apply`
- script emits deterministic summary counters:
  - `scanned`
  - `usersWithUpdates`
  - `defaultsInitialized`
  - `normalizedExisting`
  - `invalidReset`
- script supports optional `--sample-limit` output for rollout evidence snapshots.

Execution examples:
- Dry run (default): `npm run migrate:user-calendar-feature-toggles`
- Apply: `npm run migrate:user-calendar-feature-toggles -- --apply`
- Apply with larger sample output: `npm run migrate:user-calendar-feature-toggles -- --apply --sample-limit 25`

Planned work:
- add rollout guard checks for legacy/missing toggle state in strict mode.

Additional implementation evidence (2026-06-05):
- expanded server test coverage in `tests/server/routes.test.ts` for:
  - calendar toggle API auth/validation and cross-user payload rejection behavior
  - Google sync toggle enforcement (`googleSyncEnabled`)
  - calendar export toggle enforcement for Google/Apple feed-token routes (`calendarExportEnabled`)
- Evidence: passing `npm run test:server -- routes.test.ts` and passing `npm run check`.

Acceptance checks:
- migration is idempotent and auditable.
- strict mode does not cause user-visible calendar behavior loss due to missing toggle state.

### TD-AI-001 Data Model Extension
Objective:
- persist per-user AI settings in the user model with backward-compatible defaults.

Planned/Delivered work:
- extend shared User type with aiProvider, aiAgentEnabled, aiPolicyVersion
- default new users to aiProvider=null, aiAgentEnabled=false, aiPolicyVersion=null
- normalize missing legacy fields safely when hydrating users

Completion evidence:
- implemented in storage and shared schema
- typecheck and targeted server tests passing

### TD-AI-002 Authenticated User Preference API
Objective:
- provide authenticated endpoints to fetch and update per-user AI preferences.

Delivered work:
- add user-scoped read API for AI settings
- extend user profile update API (or add dedicated endpoint) for AI fields
- validate provider enum and boolean flags
- reject cross-account writes by deriving user id from session only

Implemented endpoints:
- GET /api/user/ai-preferences
- PATCH /api/user/ai-preferences

Acceptance checks:
- authenticated user can only read/update own settings
- invalid provider values return 400
- unauthenticated requests return 401

### TD-AI-003 Shared Provider Resolution
Objective:
- eliminate duplicated provider selection logic and enforce one canonical order.

Planned work:
- create a shared resolver used by routes and maintenance services
- canonical order:
  1) explicit request override (admin/testing guarded)
  2) per-user aiProvider
  3) DEFAULT_AI_PROVIDER fallback
- remove direct process.env.DEFAULT_AI_PROVIDER usage from route handlers where applicable
- note: provider resolution fallback does not imply credential fallback; execution still requires authenticated user-scoped provider credentials

Acceptance checks:
- all AI endpoints use shared resolver
- behavior remains unchanged for users without explicit setting

### TD-AI-004 Legacy User Migration
Objective:
- safely migrate existing users to explicit per-user AI fields.

Delivered work:
- added migration script: `scripts/migrate-user-ai-settings.ts`
- added npm command: `npm run migrate:user-ai-settings`
- defaults legacy users with missing `aiAgentEnabled` to `false` unless explicitly opted in
- supports explicit opt-in lists for approved users (`--opt-in-user-ids`, `--opt-in-emails`)
- emits migration summary output with scanned/updated/field update counts

Execution examples:
- Dry run (default): `npm run migrate:user-ai-settings`
- Apply: `npm run migrate:user-ai-settings -- --apply`
- Apply with approved opt-ins: `npm run migrate:user-ai-settings -- --apply --opt-in-user-ids user-1,user-2 --opt-in-emails admin@example.com`

Test engineer confirmation flow:
1. Run the dry run command first and capture the scanned/updated counts.
2. Review the output for any unexpected opt-in or defaulting behavior.
3. Re-run with `--apply` only after the dry-run output is accepted.
4. Compare the before/after user records for a small sample to confirm `aiAgentEnabled=false` was set where expected.
5. Save the command output as rollout evidence.

Notes for step 4 above
1. Set connection vars once

   export MONGO_URI="${MONGODB_URL:-${DATABASE_URL:-mongodb://localhost:27017}}"
export DB_NAME="${MONGODB_DB_NAME:-simplehome}"

2. Pick a sample of candidate users (missing aiAgentEnabled before migration)

   mongosh "$MONGO_URI/$DB_NAME" --quiet --eval '
  db.users.find(
  { aiAgentEnabled: { $exists: false } },
  { _id: 0, id: 1, email: 1 }
  ).limit(10).toArray().forEach(u => print(u.id))
  '

3. Save those IDs into a shell variable (comma-separated), for example

   SAMPLE_IDS="user-1,user-2,user-3"

4.  Capture before snapshot for exactly those users

    mongosh "$MONGO_URI/$DB_NAME" --quiet --eval '

    const ids = process.env.SAMPLE_IDS.split(",");
    
    const rows = db.users.find(
{ id: { $in: ids } },
{ _id: 0, id: 1, email: 1, aiAgentEnabled: 1, aiProvider: 1, aiPolicyVersion: 1 }
).sort({ id: 1 }).toArray();
print(JSON.stringify(rows, null, 2));
' > /tmp/td-ai-004-before.json

5. Run migration (dry-run first, then apply)

   npm run migrate:user-ai-settings

   npm run migrate:user-ai-settings -- --apply
6. Capture after snapshot for the same users

    mongosh "$MONGO_URI/$DB_NAME" --quiet --eval '

    const ids = process.env.SAMPLE_IDS.split(",");

    const rows = db.users.find(
{ id: { $in: ids } },
{ _id: 0, id: 1, email: 1, aiAgentEnabled: 1, aiProvider: 1, aiPolicyVersion: 1 }
).sort({ id: 1 }).toArray();
print(JSON.stringify(rows, null, 2));
' > /tmp/td-ai-004-after.json

7. Compare before vs after

    diff -u /tmp/td-ai-004-before.json /tmp/td-ai-004-after.json

Acceptance checks:
- script is idempotent
- dry-run or no-op rerun produces stable output
- rollback/backup steps documented

Current evidence state:
- Implementation complete.
- Staging/production execution evidence to be recorded during rollout.

### TD-AI-005 Audit Logging for User-Scoped AI Changes
Objective:
- provide traceability for AI setting changes and effective provider selection.

Delivered work:
- emit audit log event on user AI preference update
- redact log payloads via shared redaction utility before write
- include actor, userId, old/new safe values, timestamp, and request metadata
- write structured JSONL records to `data/ai-config-audit.log` (override path via `AI_CONFIG_AUDIT_PATH`)

Acceptance checks:
- audit entry generated on every AI settings mutation
- no secrets/token-like values in logs

Current evidence state:
- Route-level unit test coverage added for `ai_preferences_updated` audit emission.
- Staging/production retention and incident workflow evidence pending operational rollout.

Manual test-engineer process:
1. Update a user AI setting through the authenticated UI or API.
2. Confirm a new record appears in the audit log file at `data/ai-config-audit.log` or the path set by `AI_CONFIG_AUDIT_PATH`.
3. Verify the record includes actor, target userId, old/new safe values, timestamp, and request metadata.
4. Search the emitted log entry for secrets, tokens, or raw provider keys and confirm none are present.
5. Repeat with a remove/disable action to confirm the lifecycle emits the expected removal/update event.

### TD-AI-006 Test Coverage for Isolation and Fallback
Objective:
- prove correctness of user-level isolation and fallback behavior.

Delivered work:
- route tests for auth and user scoping on AI preference endpoints
- provider resolution tests for explicit override and fallback behavior
- tests ensuring `aiAgentEnabled=false` blocks AI generation endpoints
- production override guard tests (`AI_REQUEST_OVERRIDE_IN_PROD` + valid `x-admin-token` required)

Acceptance checks:
- all new tests pass in CI
- negative tests included for unauthorized/cross-user access

Current evidence state:
- Targeted server test suites are passing for routes/provider/fallback coverage.
- Additional integration-level validation can be expanded in future if end-to-end user-key flows are added.

Manual test-engineer process:
1. Sign in as user A and set AI preferences and, if applicable, stored provider credentials.
2. Open a second session as user B and confirm user B cannot read or modify user A settings.
3. Trigger AI generation with `aiAgentEnabled=false` and confirm the endpoint returns the expected 4xx response.
4. Exercise the override path only in the approved test environment and confirm the production guard rejects it without the admin token.
5. Record the request/response pairs for each case as test evidence.

### TD-AI-007 Per-User Provider Credential Management
Objective:
- support user-owned provider API keys without exposing secrets in profile APIs.

Delivered work:
- added runtime key resolver for AI user credentials encryption (`AI_USER_CREDENTIALS_ENCRYPTION_KEY` with compatibility fallback)
- added crypto service for encryption/decryption of per-user provider keys
- added storage plumbing using dedicated collection (`user_ai_credentials`) to avoid exposing secrets in `User` profile payloads
- added storage methods for:
  - credential status (presence flags)
  - encrypted upsert
  - provider-specific decrypted retrieval for server-side use
- added authenticated credential management routes:
  - `GET /api/user/ai-credentials` (presence/status only)
  - `PATCH /api/user/ai-credentials` (set/rotate/remove key material)
  - `DELETE /api/user/ai-credentials/:provider` (provider-specific remove)
- added provider credential validation route:
  - `POST /api/user/ai-credentials/:provider/validate` (validates request key or stored key)
- added structured audit events for key mutation operations (`ai_credentials_updated`, `ai_credentials_removed`)
- wired AI generation routes to prefer per-user stored provider keys before environment/file fallback
- hardened AI generation/runtime routes to strict user-scoped key mode:
  - `/api/item-schedule` and `/api/category-schedule` require authenticated users and provider key presence in user credentials
  - `POST /api/user/ai/generate-tasks` and `POST /api/user/ai/quick-suggestions` are the canonical user-scoped runtime endpoints
  - `POST /api/ai/generate-tasks` and `POST /api/ai/quick-suggestions` are documented as deprecated compatibility paths during migration
  - maintenance AI and provider service calls now require explicit provider API key injection
  - credential status API reports effective source as `stored` or `none` only
- added server tests for credential status/mutation/validation, stored-key resolution, and end-to-end route lifecycle flow (set -> status -> validate -> remove)

Current operator note:
- per-user AI preference and key management is exposed via authenticated backend APIs and in-app user settings UI.
- users can now configure provider, enable/disable AI agent, set/remove provider keys, and run provider validation checks from the web app.
- runtime fallback indicators were removed from user AI key status UX to match strict per-user credential policy.

Pending work:
- expand non-mocked integration coverage (real provider sandbox keys and failure-mode matrix) during staging rollout
- execute TD-AI-007 phased hardening/cutover plan (Phase 1 through Phase 4) defined above
- complete TD-CAL-004 migration and expanded isolation/regression coverage for calendar feature toggles
- complete TD-UI-004D manual two-user QA evidence capture/sign-off and then mark TD-UI-004 as completed

Calendar implementation status note (2026-06-05):
- TD-CAL-001 per-user calendar toggle model is implemented in `shared/schema.ts` and `server/storage.ts` via `userCalendarFeatureTogglesSchema` and user-scoped read/update persistence methods.
- TD-CAL-002 calendar toggle API is implemented with authenticated endpoints `GET /api/user/calendar-feature-toggles` and `PATCH /api/user/calendar-feature-toggles` in `server/routes.ts`.
- TD-CAL-003 toggle enforcement is implemented in calendar runtime routes:
  - Google sync routes respect `googleSyncEnabled`
  - Apple sync routes respect `appleSyncEnabled`
  - Calendar export token routes respect `calendarExportEnabled`
  - Task deletion calendar side-effect cleanup respects `calendarAutoSyncOnTaskChanges`
- Evidence: passing `npm run check` and passing `npm run test:server -- routes.test.ts` after adding toggle API/enforcement coverage.

Manual test-engineer process:
1. Open the per-user AI credentials screen or use the authenticated credential API to set a provider key for one test account.
2. Confirm `GET /api/user/ai-credentials` returns presence/status only, not raw secret material.
3. Validate the stored key using `POST /api/user/ai-credentials/:provider/validate` and confirm the response reflects the correct provider.
4. Run one AI generation request using the stored key, then remove the key with `DELETE /api/user/ai-credentials/:provider` and confirm the next request fails with the expected credential-missing error.
5. Verify the deprecated `/api/ai/...` aliases still work only during the migration window and are marked for removal after Phase 4.

## Sequencing and Dependencies
Recommended order:
1. TD-AI-001 (completed)
2. TD-AI-002
3. TD-AI-003
4. TD-AI-004
5. TD-AI-005
6. TD-AI-006
7. TD-AI-007

Dependency notes:
- TD-AI-003 depends on TD-AI-002 user preference availability.
- TD-AI-005 depends on TD-AI-002 mutation path finalization.
- TD-AI-006 should be expanded as TD-AI-002 through TD-AI-005 land.
- TD-AI-007 storage plumbing should be in place before adding user key management endpoints.

## Risks and Mitigations
- Risk: behavior drift across endpoints before resolver centralization.
  - Mitigation: prioritize TD-AI-003 immediately after TD-AI-002.
- Risk: accidental user-wide enablement during migration.
  - Mitigation: TD-AI-004 defaults aiAgentEnabled=false and requires explicit opt-in.
- Risk: sensitive data exposure in audit logs.
  - Mitigation: enforce shared redaction and add log-focused tests.

## Rollout and Operational Checklist
- implement each TD in small, reviewable commits
- run typecheck and targeted server tests after each TD
- document behavior changes in maintainer notes
- verify staged behavior with mixed users:
  - user with aiAgentEnabled=true and explicit provider
  - user with aiAgentEnabled=false
  - user with no explicit aiProvider

## Ownership
- Application engineering: TD-AI-001/002/003/006 implementation
- Ops/security: TD-AI-004 migration execution controls and TD-AI-005 audit retention policy
- QA/release: validation matrix and sign-off evidence
