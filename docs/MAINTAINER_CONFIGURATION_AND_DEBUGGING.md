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
- [x] Code-reference appendix (file/line references) completed for the documented findings

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
- AI provider selection is per-user-first for runtime AI execution.

### Gap matrix (current vs target)

| Area | Current | Target | Gap |
|---|---|---|---|
| Secret governance | Mixed provider-specific and global controls | One shared security contract for secret handling and operational policy | Need one canonical security policy section with provider deltas only |
| Credential encryption controls | Apple encryption key is provider-specific (APPLE_SYNC_ENCRYPTION_KEY) | Unified calendar credential-protection policy with clear naming and migration notes | Need documented migration strategy and compatibility window |
| Logging/redaction policy | Apple has detailed sanitization path; other paths vary | One redaction standard across calendar and AI error surfaces | Need standard checklist and cross-provider enforcement points |
| Audit trail | Calendar audit log exists and is shared | Keep shared audit path and retention policy | Need retention/rotation guidance and incident workflow |
| Documentation topology | Security guidance split between provider docs and ops docs | One canonical maintainer security/ops doc + lightweight provider-specific pointers | Need dedup pass in provider docs |
| AI provider configuration scope | Per-user AI provider/key controls runtime execution | Per-user AI configuration only, with deprecated legacy aliases removed | Final hardening in phased migration |

### Confirmed Phase 1 findings from code
- Runtime AI routes are moving to canonical user-scoped API paths under `/api/user/ai/...`; legacy `/api/ai/...` routes are deprecated during migration.
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

### Phase 1 appendix status
- Completed: code-reference appendix is now present for all Phase 1 findings documented above.

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
| ADMIN_TOKEN (calendar feed fallback) | CALENDAR_FEED_SECRET (no fallback target) | completed | Calendar feed signing fallback has been removed; ADMIN_TOKEN remains for admin/testing override only. |

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
- [x] Add one release-note entry per migrated variable with deprecation timeline.

Definition of done:
- Existing deployments continue to function unchanged.
- New variable names are honored first.
- Legacy usage is measurable from logs.

### Phase 3 release notes

Use these notes in the release summary / deployment notes when communicating the migration:

- Apple calendar encryption key migration: `CALENDAR_CREDENTIALS_ENCRYPTION_KEY` is now the preferred variable. `APPLE_SYNC_ENCRYPTION_KEY` remains supported as a fallback during the migration window and emits `[CONFIG_DEPRECATION]` when used.
- OpenAI key normalization: `OPENAI_API_KEY` is now the preferred variable. `OPENAI_API_KEY_ENV_VAR` remains supported as a fallback during the migration window and emits `[CONFIG_DEPRECATION]` when used.
- Mongo connection normalization: `MONGODB_URL` is now the preferred variable. `DATABASE_URL` remains supported as a fallback during the migration window and emits `[CONFIG_DEPRECATION]` when used.
- Calendar feed secret normalization: `CALENDAR_FEED_SECRET` is now required for feed signing in production-like environments. `ADMIN_TOKEN` no longer acts as the feed signing fallback and remains for admin/testing override only.

Release-note language to reuse:
- "Phase 3 configuration standardization is now active. New deployments should prefer the target variable names above. Legacy names remain temporarily supported for compatibility and will emit deprecation warnings until the removal window."

### Phase 4 implementation tasks (documentation consolidation)
- [x] Update provider docs to retain provider deltas only and link back to this canonical guide.
- [x] Remove duplicated policy prose that can drift from this file.
- [x] Add a lightweight docs lint check in CI for required cross-links.

Definition of done:
- Security/config policy is edited in one canonical file.
- Provider docs pass link and duplication checks.

### Phase 5 implementation tasks (validation and rollout)
- [x] Create a pre-release validation script/checklist for:
	- secret presence and fallback behavior
	- redaction assertions
	- calendar audit log write/read health
	- provider-specific failure-path checks
- [ ] Run staging validation for one full release cycle.
- [ ] Approve legacy-variable removal only when fallback warning count is zero for the full cycle.

Phase 5 artifacts:
- Command: `npm run validate:phase5`
- Deprecation-cycle command: `npm run validate:phase5:deprecations -- --log <path-to-app-log> --since <cycle-start-iso> --max-count 0`
- Checklist: `docs/security-operations/CONFIG_SECURITY_VALIDATION_CHECKLIST.md`

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
	 - explicit error when user provider is not configured for runtime AI calls
3. Gate AI routes by per-user aiAgentEnabled for non-admin traffic.

Runtime endpoint contract (phased migration):
- Canonical:
	- `POST /api/user/ai/generate-tasks`
	- `POST /api/user/ai/quick-suggestions`
- Deprecated compatibility aliases:
	- `POST /api/ai/generate-tasks`
	- `POST /api/ai/quick-suggestions`

### API Deprecation Register (AI Runtime)

| Deprecated Endpoint | Canonical Replacement | Status | Planned Removal |
|---|---|---|---|
| `POST /api/ai/generate-tasks` | `POST /api/user/ai/generate-tasks` | Deprecated compatibility alias | TD-AI-007 Phase 4 |
| `POST /api/ai/quick-suggestions` | `POST /api/user/ai/quick-suggestions` | Deprecated compatibility alias | TD-AI-007 Phase 4 |

Deprecation usage rules:
- new client and documentation changes must use canonical `/api/user/ai/...` endpoints.
- deprecated `/api/ai/...` endpoints exist only for temporary migration compatibility.

API namespace rule:
- use `/api/user/...` for self-service operations on the authenticated user.
- reserve `/api/admin/...` for server-wide/admin-only configuration and any future cross-user admin actions.
- no `/api/admin/users` listing API is planned; direct database querying remains the preferred operational path when user inventory is needed.

### Tech debt backlog items
- TD-AI-001: Data model extension for per-user AI settings.
- TD-AI-002: Add authenticated endpoint to read/update user AI preferences.
- TD-AI-003: Refactor provider resolution helper into one shared function used by routes and maintenance services.
- TD-AI-004: Add migration script for existing users (default aiAgentEnabled=false unless explicitly opted in).
- TD-AI-005: Add audit log entry for AI provider changes at user scope.
- TD-AI-006: Update tests to validate per-user provider isolation and fallback behavior.

Tracking document:
- docs/user-management/PER_USER_TECHDEBT_PLAN.md

Current status:
- TD-AI-001 completed in code (shared User model + storage defaults/hydration).

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

Operational safety recommendation:
- Configure a dedicated Apple calendar ID for SimpleHome sync instead of a shared personal calendar.
- Scope cleanup and disconnect flows can delete out-of-scope mapped events; using a dedicated calendar reduces risk of affecting unrelated personal events.

### Feed/admin and diagnostics
| Variable | Purpose | Default/Behavior |
|---|---|---|
| CALENDAR_FEED_SECRET | Feed token signing/validation secret | dev fallback only when unset |
| ADMIN_TOKEN | Auth token for admin diagnostics endpoints | none |
| AI_REQUEST_OVERRIDE_IN_PROD | Enables request-level AI provider override in production | false unless explicitly true |
| CALENDAR_SYNC_AUDIT_ENABLED | Enable file audit logging | true unless explicitly false |
| CALENDAR_SYNC_AUDIT_PATH | Audit log file path | data/calendar-sync.log |

### CALENDAR_FEED_SECRET best practices (primary)

Use CALENDAR_FEED_SECRET as the primary high-entropy secret for feed token signing and validation.

Recommended generation:
- macOS/Linux: `openssl rand -base64 48`
- Node: `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`

Handling rules:
- Store in a secret manager or deployment secret store, not in committed files.
- Never log CALENDAR_FEED_SECRET, including partial values.
- Use CALENDAR_FEED_SECRET only for feed signing/validation.
- Keep CALENDAR_FEED_SECRET separate from ADMIN_TOKEN; ADMIN_TOKEN fallback is legacy-compatibility only.

Runtime usage rules:
- Configure via environment/secret store only; do not send CALENDAR_FEED_SECRET in API request payloads or headers.
- Require HTTPS for all feed URLs in non-local environments.
- Treat feed URLs as bearer-style secrets and avoid sharing beyond intended subscribers.

Rotation policy:
- Rotate at least every 90 days and immediately after suspected exposure.
- Rotate during planned windows by updating secret store first, then restarting/redeploying service.
- After rotation, reissue calendar subscriptions/feed URLs and verify old feed tokens are rejected.

Operational checks:
- Ensure production environments always set CALENDAR_FEED_SECRET explicitly (no empty value).
- Alert on repeated feed-token validation failures to detect abuse/misconfiguration.
- Review logs to ensure no token-like values are emitted by feed endpoints.

#### ADMIN_TOKEN notes (secondary)

ADMIN_TOKEN policy is subordinate to CALENDAR_FEED_SECRET policy:
- CALENDAR_FEED_SECRET is the primary feed signing/validation secret for all environments.
- ADMIN_TOKEN may be accepted only as temporary legacy fallback for feed secret resolution during migration windows.
- Do not plan new deployments around ADMIN_TOKEN for feed signing.

ADMIN_TOKEN usage scope:
- Use ADMIN_TOKEN for admin/testing override controls only (for example `x-admin-token` in guarded override paths).
- Keep ADMIN_TOKEN lifecycle separate from CALENDAR_FEED_SECRET lifecycle.
- When CALENDAR_FEED_SECRET is rotated, treat any ADMIN_TOKEN-based feed fallback as deprecated and remove it on schedule.

#### Admin/testing override policy (recommended)

Primary secret boundary:
- `CALENDAR_FEED_SECRET` is for feed signing/validation only.
- `ADMIN_TOKEN` (sent as `x-admin-token`) is for guarded override/diagnostics only.
- Do not send `CALENDAR_FEED_SECRET` as `x-admin-token` and do not reuse one value for both roles.

Production override lane:
- Keep request override disabled by default for normal user traffic.
- Only allow override when all of the following are true:
	- `AI_REQUEST_OVERRIDE_IN_PROD=true` is explicitly set,
	- `x-admin-token` matches `ADMIN_TOKEN` via timing-safe comparison,
	- caller is on an override-capable endpoint.
- Restrict override-capable routes to a short allowlist (diagnostics and controlled admin endpoints only).
- Require TLS and ingress-layer protections (WAF/rate-limit/IP allowlist where possible).
- Record override attempts (allowed/denied) as security events without logging token contents.
- Keep feed security independent: override controls must not weaken or replace feed token validation with `CALENDAR_FEED_SECRET`.

Automated/local test lane:
- In local dev and CI test jobs, allow request override only when explicitly enabled for tests.
- Prefer a dedicated test token value injected by test harness/CI secrets, not developer personal tokens.
- Avoid sharing production ADMIN_TOKEN with local or CI environments.
- Avoid reusing production `CALENDAR_FEED_SECRET` in tests; use separate non-production test secrets.
- Keep override tests deterministic:
	- positive case: valid test token applies request override
	- negative case: missing/invalid token does not apply override and falls back to user/default resolution
- Ensure tests cover both runtime modes:
	- production-mode guard behavior
	- non-production testing behavior

Suggested rollout for stronger controls:
1. Current baseline: production override disabled unless `AI_REQUEST_OVERRIDE_IN_PROD=true` and valid `x-admin-token`.
2. Near term: add authenticated admin-role check and keep token as defense-in-depth.
3. Final target: override requires admin identity; token acts as secondary control for privileged operations.

Example (production override with `x-admin-token`):

```bash
curl -X POST "https://<host>/api/item-schedule" \
	-H "Content-Type: application/json" \
	-H "x-admin-token: ${ADMIN_TOKEN}" \
	-d '{
		"provider": "openai",
		"item": {
			"id": "water-heater",
			"name": "Water Heater",
			"category": "Plumbing & Water"
		}
	}'
```

Expected behavior:
- with a valid `x-admin-token`, request provider override can be applied (`provider=openai`)
- with missing/invalid token, override is rejected and provider selection falls back to user/context/default order

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
