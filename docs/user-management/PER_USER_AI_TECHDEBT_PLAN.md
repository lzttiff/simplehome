# Per-User AI Tech Debt Plan (TD-AI-001 to TD-AI-007)

## Purpose
This document is the implementation tracker for migrating AI behavior from app-wide defaults to user-scoped controls.

Primary objective:
- ensure AI provider selection and AI feature enablement are controlled per user, with app-level defaults used only as fallback.

## Scope
In scope:
- TD-AI-001 through TD-AI-007
- data model, API surface, routing/provider resolution, migration, auditing, and tests

Out of scope:
- non-user-scoped feature toggles unrelated to AI behavior
- provider-specific prompt tuning changes

## Success Criteria
- Changing DEFAULT_AI_PROVIDER does not change behavior for users with explicit user-level AI settings.
- Users with aiAgentEnabled=false cannot run AI generation endpoints.
- User AI settings are strictly user-scoped and cannot be read/updated across accounts.
- All AI provider changes at user scope are auditable.
- Automated tests cover provider isolation and fallback behavior.

## Backlog Overview
| ID | Title | Planned Effort | Status |
| --- | --- | --- | --- |
| TD-AI-001 | Data model extension for per-user AI settings | Add aiProvider, aiAgentEnabled, aiPolicyVersion to user model and storage mappings | Completed |
| TD-AI-002 | Authenticated endpoint to read/update user AI preferences | Add user-scoped profile API for AI settings with strict validation | Completed |
| TD-AI-003 | Shared provider resolution helper | Centralize provider resolution and remove route-level drift | Completed |
| TD-AI-004 | Existing user migration script | Backfill legacy users with safe defaults (aiAgentEnabled=false) | Implemented (pending staged execution evidence) |
| TD-AI-005 | User-scope AI config audit logging | Emit audit records for settings changes and key resolution paths | Implemented (pending rollout evidence) |
| TD-AI-006 | Per-user provider isolation tests | Add server and integration tests for isolation/fallback/authorization | Implemented (server test scope) |
| TD-AI-007 | Per-user provider credential management | Add encrypted per-user API key storage and retrieval plumbing | Implemented (core server scope) |

## Detailed Plan

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
- added server tests for credential status/mutation/validation, stored-key resolution, and end-to-end route lifecycle flow (set -> status -> validate -> remove)

Pending work:
- expand non-mocked integration coverage (real provider sandbox keys and failure-mode matrix) during staging rollout

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
