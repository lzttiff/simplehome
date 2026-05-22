# SimpleHome Maintainer Configuration and Debugging Guide

## Purpose
This guide helps maintainers operate and troubleshoot the app service. It consolidates:
- environment variables used by runtime configuration
- environment variables used by scripts and tests
- practical debugging workflows for API and calendar sync

## Phase 1: Baseline and Gap Analysis

This section captures Phase 1 of the security consolidation plan.

### Phase 1 status
- Status: Completed (documentation baseline)
- Last reviewed: 2026-05-22

Checklist:
- [x] Baseline inventory documented (auth model, shared controls, fragmented areas)
- [x] Current vs target gap matrix documented
- [x] Code-backed findings captured
- [x] AI per-user configuration tech debt captured with backlog items and acceptance criteria

Remaining from Phase 1:
- [ ] Optional: attach code-reference appendix (file/line references) for each finding if auditors require traceability

### Current state summary
- Provider auth is intentionally different:
	- Google: OAuth app credentials + per-user refresh/access tokens
	- Apple: per-user app-specific password encrypted at rest
- Security controls are partially consolidated already:
	- shared app-level controls: SESSION_SECRET, ADMIN_TOKEN, LOG_LEVEL
	- shared calendar audit controls: CALENDAR_SYNC_AUDIT_ENABLED, CALENDAR_SYNC_AUDIT_PATH
- Security controls are still fragmented:
	- provider-specific encryption and debug conventions are not fully unified
	- duplicated operational guidance across provider docs
- AI provider selection is currently global-first (DEFAULT_AI_PROVIDER), not per-user-first.

### Gap matrix (current vs target)

| Area | Current | Target | Gap |
|---|---|---|---|
| Secret governance | Mixed provider-specific and global controls | One shared security contract for secret handling and operational policy | Need one canonical security policy section with provider deltas only |
| Credential encryption controls | Apple encryption key is provider-specific (APPLE_SYNC_ENCRYPTION_KEY) | Unified calendar credential-protection policy with clear naming and migration notes | Need documented migration strategy and compatibility window |
| Logging/redaction policy | Apple has detailed sanitization path; other paths vary | One redaction standard across calendar and AI error surfaces | Need standard checklist and cross-provider enforcement points |
| Audit trail | Calendar audit log exists and is shared | Keep shared audit path and retention policy | Need retention/rotation guidance and incident workflow |
| Documentation topology | Security guidance split between provider docs and ops docs | One canonical maintainer security/ops doc + lightweight provider-specific pointers | Need dedup pass in provider docs |
| AI provider configuration scope | DEFAULT_AI_PROVIDER applies app-wide unless request override is passed | Per-user AI configuration, with app-level default only as fallback | Major tech debt; requires schema/API/UI updates |

### Confirmed Phase 1 findings from code
- App-wide AI default is currently resolved via DEFAULT_AI_PROVIDER in server routes and maintenance services.
- No persistent per-user AI provider preference is defined in shared User schema.
- Calendar provider auth remains correctly per-user, but app-level trust anchors must remain in env vars.

### Phase 1 code-reference appendix (traceability)

| Finding | Evidence |
|---|---|
| App-wide AI default is global-first | server/routes.ts:472, server/routes.ts:502, server/routes.ts:513, server/routes.ts:1774, server/routes.ts:1813, server/services/maintenanceAi.ts:416 |
| Shared User schema has no per-user AI preference fields | shared/schema.ts:7, shared/schema.ts:12, shared/schema.ts:20 |
| Google sync requires app-level OAuth client credentials | server/services/googleCalendarSync.ts:106, server/services/googleCalendarSync.ts:110, server/services/googleCalendarSync.ts:1466 |
| Apple sync uses per-user credential encryption with app-level key | server/services/appleCalendarSync.ts:211, server/services/appleCalendarSync.ts:231, server/services/appleCalendarSync.ts:246, server/services/appleCalendarSync.ts:1113 |
| Shared security controls exist at app level | server/index.ts:20, server/services/logWithLevel.ts:3, server/services/calendarSyncAudit.ts:14, server/services/calendarSyncAudit.ts:16 |
| Provider-specific debug/config controls remain fragmented | server/services/googleCalendarSync.ts:97, server/services/appleCalendarSync.ts:110, server/services/appleCalendarSync.ts:436 |

## Phase 2: Security Model Consolidation

Goal:
- Consolidate shared security controls across providers while preserving provider-specific auth behavior.

### Phase 2 status
- Status: Completed (documentation baseline)
- Last reviewed: 2026-05-22

Scope:
- Shared controls to unify:
	- secret classification and handling policy
	- encryption key governance and naming policy
	- logging redaction rules
	- audit event taxonomy and retention
- Provider-specific controls to keep separate:
	- Google OAuth app credentials and token lifecycle
	- Apple app-specific password validation and CalDAV connectivity

Deliverables:
- One canonical security contract in this document.
- Short provider delta sections in Google/Apple docs pointing back here.

Acceptance criteria:
- No conflicting security guidance across provider docs.
- Shared controls are documented once and referenced everywhere else.

### Canonical shared security contract

This is the source-of-truth security contract for both calendar providers.

| Control area | Canonical policy |
|---|---|
| Secret classes | Separate secrets into: app-level trust anchors (env/secret manager), provider app credentials (env/secret manager), and per-user provider credentials/tokens (database, encrypted where applicable). |
| Storage boundary | Never persist app-level secrets in user records; never return stored provider credentials in API responses. |
| Encryption at rest | Per-user sensitive credentials must be encrypted at rest before persistence. Key material must come from deployment configuration, not hard-coded constants in production. |
| Redaction | Logs and error responses must redact likely secret material (tokens, passwords, auth headers, credential-like fields). Unknown low-level provider errors should be sanitized before returning to clients. |
| Audit logging | Security-relevant sync actions must be captured as structured audit events with timestamps and minimal necessary identifiers. Audit failures must not block core sync operations. |
| Debug controls | Debug verbosity must be opt-in via env flags; defaults should be non-verbose in production. |
| Auth model boundary | Google and Apple auth flows remain provider-specific; only operational security controls are consolidated. |
| Rotation and incident posture | App-level keys/tokens must support rotation; docs must include investigation flow using audit logs and persisted state correlation. |

### Provider security deltas

Google delta (provider-specific):
- Uses OAuth app credentials and per-user OAuth tokens.
- Depends on GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET for configured state.

Apple delta (provider-specific):
- Uses per-user Apple app-specific password entered at connect-time.
- Encrypts stored credential payload using APPLE_SYNC_ENCRYPTION_KEY.
- Supports APPLE_CALDAV_SERVER_URL override for non-default CalDAV endpoint.

## Phase 3: Environment Variable Standardization

Goal:
- Standardize environment variable naming and migration approach without breaking existing deployments.

### Phase 3 status
- Status: Completed (documentation baseline)
- Last reviewed: 2026-05-22

Scope:
- Introduce standardized naming for shared controls where needed.
- Keep backward compatibility for legacy variable names during migration window.
- Document deprecation plan with dates/versions.

Suggested migration pattern:
1. Read new variable first.
2. Fallback to legacy variable.
3. Emit structured warning when legacy variable is used.

Deliverables:
- Current -> target -> deprecate-by mapping table.
- Migration runbook for dev/staging/prod rollout.

Acceptance criteria:
- Existing environments continue to work during migration window.
- Maintainers can identify deprecated variables from logs and docs.

### Current -> target mapping

| Current name | Target name | Deprecate by | Notes |
|---|---|---|---|
| APPLE_SYNC_ENCRYPTION_KEY | CALENDAR_CREDENTIALS_ENCRYPTION_KEY | v2026.08 | Keep APPLE_SYNC_ENCRYPTION_KEY as fallback during migration window. |
| OPENAI_API_KEY_ENV_VAR | OPENAI_API_KEY | v2026.08 | Consolidate to one OpenAI key variable; secondary key kept only for compatibility. |
| DATABASE_URL (fallback path) | MONGODB_URL | v2026.08 | Keep DATABASE_URL fallback for platform compatibility; prefer MONGODB_URL in docs and deployments. |
| ADMIN_TOKEN (calendar feed fallback) | CALENDAR_FEED_SECRET (no fallback target) | v2026.10 | Stop using ADMIN_TOKEN as implicit feed-signing fallback after migration. |

Variables already aligned and retained as-is:
- CALENDAR_SYNC_AUDIT_ENABLED
- CALENDAR_SYNC_AUDIT_PATH
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- APPLE_CALDAV_SERVER_URL
- GOOGLE_SYNC_DEBUG
- APPLE_SYNC_DEBUG

### Migration runbook (dev -> staging -> prod)

1. Dev rollout
- Define target variables in local env.
- Keep legacy variables set in parallel.
- Verify startup logs show no missing-secret errors.

2. Staging rollout
- Switch staging manifests/secrets to target names.
- Keep legacy values for one release as fallback.
- Monitor for fallback warnings and resolve before prod.

3. Production rollout
- Deploy with target variables present.
- Keep legacy fallback for one release cycle.
- Track warning volume; if zero for full cycle, schedule legacy removal.

4. Decommission step
- Remove legacy vars from manifests and secret stores.
- Remove fallback code paths in a separate hardening change.

### Logging requirement during migration

When legacy fallback is used, emit a warning with:
- variable name used
- target variable expected
- service/component name
- removal target release

Example warning format:
- [CONFIG_DEPRECATION] using legacy env APPLE_SYNC_ENCRYPTION_KEY; prefer CALENDAR_CREDENTIALS_ENCRYPTION_KEY; remove by v2026.08

## Phase 4: Documentation Consolidation

Goal:
- Make this document the single source of truth for maintainer configuration and security operations.

Scope:
- Keep provider docs implementation-focused.
- Remove duplicated security policy text from provider docs.
- Add explicit links from onboarding and sync docs to this file.

Deliverables:
- Canonical sections in this file for:
	- env var catalog
	- security controls
	- debugging and incident workflow
- Provider docs containing only provider-specific behavior and links to canonical policy.

Acceptance criteria:
- Security policy edits are made in one file only.
- Provider docs do not repeat policy content that can drift.

## Phase 5: Validation and Rollout

Goal:
- Validate consolidated policy and documentation in real operations.

Scope:
- Security and operations checklist execution in staging:
	- secret presence and fallback behavior
	- redaction behavior for failures
	- calendar audit log completeness
	- provider-specific error handling paths
- Rollout and communication:
	- publish migration notes
	- publish maintainer checklist

Deliverables:
- Validation checklist with pass/fail outcomes.
- Final rollout notes with any follow-up tasks.

Acceptance criteria:
- Maintainers can diagnose calendar sync issues using documented flow only.
- No undocumented environment variable is required for normal operations.

## Engineering Implementation Plan (Phase-Aligned)

Purpose:
- Translate the documentation phases into executable engineering workstreams.
- Keep DevOps configuration changes and application code changes synchronized.

### Implementation sequencing
1. Deliver Phase 1 and Phase 2 guardrails first (shared contracts and enforcement points).
2. Implement Phase 3 migration-compatible config reads and warnings.
3. Execute Phase 4 doc cleanup in lock-step with merged code.
4. Run Phase 5 validation as a release gate before removing legacy paths.

### Phase 1 implementation tasks (baseline and gap closure)
- Add a configuration inventory module that centralizes env resolution used by calendar/AI services.
- Add startup diagnostics that report missing required variables by feature area (without printing secret values).
- Add a backlog issue template for each identified gap (owner, target release, risk, rollback).

Definition of done:
- All runtime-resolved env vars are discoverable from one code path.
- Missing-variable failures are explicit and actionable at startup/runtime boundary.

### Phase 2 implementation tasks (shared security contract)
- Add shared redaction helpers and use them across calendar and AI error surfaces.
- Standardize structured security/audit event envelope fields (eventType, provider, runId, userId hash/identifier policy, timestamp).
- Add policy tests that reject accidental logging of token/password-like fields.

Definition of done:
- Redaction behavior is consistent across Google, Apple, and AI services.
- Audit event structure is stable and documented for operations tooling.

### Phase 3 implementation tasks (env var standardization)
- Implement target-first, legacy-fallback reads for each mapped variable.
- Emit [CONFIG_DEPRECATION] warning logs only when fallback is used.
- Add unit tests for resolution order and warning emission.
- Add one release-note entry per migrated variable with deprecation timeline.

Definition of done:
- Existing deployments continue to function unchanged.
- New variable names are honored first.
- Legacy usage is measurable from logs.

### Phase 4 implementation tasks (documentation consolidation)
- Update provider docs to retain provider deltas only and link back to this canonical guide.
- Remove duplicated policy prose that can drift from this file.
- Add a lightweight docs lint check in CI for required cross-links.

Definition of done:
- Security/config policy is edited in one canonical file.
- Provider docs pass link and duplication checks.

### Phase 5 implementation tasks (validation and rollout)
- Create a pre-release validation script/checklist for:
	- secret presence and fallback behavior
	- redaction assertions
	- calendar audit log write/read health
	- provider-specific failure-path checks
- Run staging validation for one full release cycle.
- Approve legacy-variable removal only when fallback warning count is zero for the full cycle.

Definition of done:
- Validation checklist is recorded with pass/fail outcomes.
- Legacy fallback removals are evidence-based, not date-only.

### Ownership model (recommended)
- Application engineering: env resolution, fallback logic, service-level guards, tests.
- DevOps/SRE: secret provisioning, rotation cadence, deployment manifests, log retention/alerts.
- QA/Release: staging validation execution, rollback rehearsal, release sign-off artifacts.

### Suggested execution milestones
- Milestone A (1 sprint): Phase 1+2 implementation guardrails merged.
- Milestone B (1 sprint): Phase 3 target-first/fallback logic and warnings merged.
- Milestone C (0.5 sprint): Phase 4 doc dedup and CI docs checks merged.
- Milestone D (1 release cycle): Phase 5 staging validation complete; decision on legacy removal.

## Tech Debt: Per-User AI Agent/Provider Configuration

Business requirement:
- Do not subscribe/enable AI agent behavior for all users by default.
- AI provider and agent enablement should be controlled per user.

### Problem statement
- Current behavior uses app-level DEFAULT_AI_PROVIDER as the primary fallback.
- This creates global behavior changes when maintainers switch default provider.
- Users without explicit preference can be unintentionally moved to a different provider path.

### Proposed target model
1. Add per-user AI settings in user profile (or dedicated user settings collection):
	 - aiProvider: "gemini" | "openai" | null
	 - aiAgentEnabled: boolean
	 - aiPolicyVersion: string (optional, for rollout policy tracking)
2. Provider resolution order:
	 - explicit request override (admin/testing only, guarded)
	 - per-user aiProvider (normal path)
	 - DEFAULT_AI_PROVIDER (final fallback)
3. Gate AI routes by per-user aiAgentEnabled for non-admin traffic.

### Tech debt backlog items
- TD-AI-001: Data model extension for per-user AI settings.
- TD-AI-002: Add authenticated endpoint to read/update user AI preferences.
- TD-AI-003: Refactor provider resolution helper into one shared function used by routes and maintenance services.
- TD-AI-004: Add migration script for existing users (default aiAgentEnabled=false unless explicitly opted in).
- TD-AI-005: Add audit log entry for AI provider changes at user scope.
- TD-AI-006: Update tests to validate per-user provider isolation and fallback behavior.

### Acceptance criteria for this tech debt
- Changing DEFAULT_AI_PROVIDER does not alter AI behavior for users with explicit per-user settings.
- Users with aiAgentEnabled=false cannot trigger AI generation endpoints.
- Per-user settings are user-scoped and not readable/writable across accounts.
- Documentation reflects per-user control as the primary model.

## Quick Start

### Local development (minimum)
- NODE_ENV=development
- PORT=5000
- SESSION_SECRET=<random-long-string>
- MONGODB_URL=mongodb://localhost:27017
- MONGODB_DB_NAME=simplehome
- DEFAULT_AI_PROVIDER=gemini
- GEMINI_API_KEY=<your-key>

Optional:
- PUBLIC_BASE_URL=http://localhost:5000
- LOG_LEVEL=DEBUG
- DEBUG_CLIENT_REQUESTS=true

### Production baseline
- NODE_ENV=production
- PORT=<service-port>
- SESSION_SECRET=<strong-secret>
- MONGODB_URL=<mongo-uri>
- MONGODB_DB_NAME=<db-name>
- DEFAULT_AI_PROVIDER=<gemini|openai>
- GEMINI_API_KEY=<key> or OPENAI_API_KEY=<key>
- PUBLIC_BASE_URL=<public-https-origin>

If Google sync is enabled:
- GOOGLE_CLIENT_ID=<oauth-client-id>
- GOOGLE_CLIENT_SECRET=<oauth-client-secret>

If Apple sync is enabled:
- APPLE_SYNC_ENCRYPTION_KEY=<strong-secret>

Recommended in production:
- LOG_LEVEL=INFO
- CALENDAR_SYNC_AUDIT_ENABLED=true
- CALENDAR_SYNC_AUDIT_PATH=/app/data/calendar-sync.log

## Environment Variables

### Core server
| Variable | Purpose | Default/Behavior |
|---|---|---|
| NODE_ENV | Runtime mode checks | framework default |
| PORT | HTTP server port | 5000 |
| SESSION_SECRET | Session signing key | dev fallback string |
| DEBUG_CLIENT_REQUESTS | Extra client routing logs | off unless set |
| LOG_LEVEL | Log filtering | INFO |
| PUBLIC_BASE_URL | Canonical base URL for callbacks/links | request host fallback |

### Database
| Variable | Purpose | Default/Behavior |
|---|---|---|
| MONGODB_URL | Mongo connection URI | fallback mongodb://localhost:27017 |
| DATABASE_URL | Alternate DB URI key | used when MONGODB_URL absent |
| MONGODB_DB_NAME | Database name | simplehome |

### AI provider
| Variable | Purpose | Default/Behavior |
|---|---|---|
| DEFAULT_AI_PROVIDER | Default provider | gemini |
| GEMINI_API_KEY | Gemini key | required for Gemini requests |
| OPENAI_API_KEY | OpenAI key | used by OpenAI services |
| OPENAI_API_KEY_ENV_VAR | Secondary OpenAI key lookup | fallback in openai service |

### Google Calendar sync
| Variable | Purpose | Default/Behavior |
|---|---|---|
| GOOGLE_CLIENT_ID | OAuth client ID | sync unavailable if missing |
| GOOGLE_CLIENT_SECRET | OAuth client secret | sync unavailable if missing |
| GOOGLE_SYNC_DEBUG | Verbose Google sync logs | false |

### Apple Calendar sync
| Variable | Purpose | Default/Behavior |
|---|---|---|
| APPLE_SYNC_ENCRYPTION_KEY | Encrypt Apple credentials at rest | required in production |
| APPLE_CALDAV_SERVER_URL | Override CalDAV endpoint | https://caldav.icloud.com |
| APPLE_SYNC_DEBUG | Verbose Apple sync logs | false |

### Feed/admin and diagnostics
| Variable | Purpose | Default/Behavior |
|---|---|---|
| CALENDAR_FEED_SECRET | Feed token signing/validation secret | falls back to ADMIN_TOKEN, then dev default |
| ADMIN_TOKEN | Auth token for admin diagnostics endpoints | none |
| CALENDAR_SYNC_AUDIT_ENABLED | Enable file audit logging | true unless explicitly false |
| CALENDAR_SYNC_AUDIT_PATH | Audit log file path | data/calendar-sync.log |

### Script-only (Confluence)
| Variable | Purpose | Default/Behavior |
|---|---|---|
| CONFLUENCE_SINCE_DATE | Lower-bound date for publish script | 2026-04-30 |
| CONFLUENCE_BASE_URL | Confluence base URL | tiffanyjiang.atlassian.net/wiki |
| CONFLUENCE_EMAIL | Confluence auth email | empty |
| CONFLUENCE_API_TOKEN | Confluence token | empty |
| CONFLUENCE_SPACE_KEY | Confluence space key | empty |
| CONFLUENCE_PARENT_PAGE_ID | Parent page id | empty |

### Test-oriented flags
| Variable | Purpose | Default/Behavior |
|---|---|---|
| PROVIDER | Test-time provider selector | gemini |
| DEFAULT_AI_PROVIDER | Test provider fallback path | gemini |
| GEMINI_API_KEY | Set/unset in tests | varies by test |
| GOOGLE_CLIENT_ID | Mocked in tests | varies by test |
| GOOGLE_CLIENT_SECRET | Mocked in tests | varies by test |

## Debugging Workflows

### General startup checks
1. Verify DB variables and session secret are loaded.
2. Verify AI provider and corresponding key are set.
3. Verify PUBLIC_BASE_URL is correct for callback links.

### Calendar sync investigation
1. Enable:
- GOOGLE_SYNC_DEBUG=true
- APPLE_SYNC_DEBUG=true
- LOG_LEVEL=DEBUG
2. Trigger sync from UI/API.
3. Inspect audit log:
- data/calendar-sync.log
4. Correlate with persisted task state in:
- data/storage.json
5. Confirm per-task calendarExports fields:
- eventIds
- syncedDates
- calendarId
- lastSyncedAt

### Verifying DONE behavior
Look for audit events:
- done_completion_applied
- remote_date_applied
- calendar_event_updated / calendar_object_updated

Confirm in storage:
- lastMaintenanceDate updated for target kind
- nextMaintenanceDate rolled forward
- overdueBacklog/overdueSince reset when completion path applies

### OAuth callback issues (Google)
- Confirm PUBLIC_BASE_URL matches public origin.
- Confirm GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET pair is valid.
- Confirm callback receives code and matching state.

### Apple connectivity issues
- Confirm APPLE_SYNC_ENCRYPTION_KEY is set (especially in production).
- Confirm app-specific password and iCloud calendar access.
- If using custom CalDAV, verify APPLE_CALDAV_SERVER_URL and network TLS reachability.

## Example .env Template
NODE_ENV=development
PORT=5000
SESSION_SECRET=change-me
MONGODB_URL=mongodb://localhost:27017
MONGODB_DB_NAME=simplehome
PUBLIC_BASE_URL=http://localhost:5000

DEFAULT_AI_PROVIDER=gemini
GEMINI_API_KEY=
OPENAI_API_KEY=
OPENAI_API_KEY_ENV_VAR=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_SYNC_DEBUG=false

APPLE_SYNC_ENCRYPTION_KEY=
APPLE_CALDAV_SERVER_URL=https://caldav.icloud.com
APPLE_SYNC_DEBUG=false

CALENDAR_FEED_SECRET=
ADMIN_TOKEN=

LOG_LEVEL=INFO
DEBUG_CLIENT_REQUESTS=

CALENDAR_SYNC_AUDIT_ENABLED=true
CALENDAR_SYNC_AUDIT_PATH=data/calendar-sync.log

CONFLUENCE_SINCE_DATE=2026-04-30
CONFLUENCE_BASE_URL=
CONFLUENCE_EMAIL=
CONFLUENCE_API_TOKEN=
CONFLUENCE_SPACE_KEY=
CONFLUENCE_PARENT_PAGE_ID=

PROVIDER=gemini

## Related Docs
- docs/GOOGLE_CALENDAR_SYNC_SIMPLEHOME.md
- docs/APPLE_CALENDAR_SYNC_SIMPLEHOME.md
- docs/LOCAL_FILES.md
