# Apple Calendar Sync Design and Security Decisions

## Status
Draft v1 for Phase 0 sign-off.

## Scope Decision
- Initial provider scope: iCloud CalDAV only.
- Rationale:
  - Meets immediate user need for Apple Calendar two-way sync.
  - Keeps auth and API behavior constrained while reliability is validated.
  - Avoids broad generic CalDAV compatibility overhead in initial rollout.
- Out of scope for initial release:
  - Multi-account linking for a single user.
  - Generic multi-provider CalDAV marketplace behavior.

## Authentication and Credential Model
- Auth method: Basic auth over CalDAV endpoint using Apple ID email + app-specific password.
- Credential capture:
  - Current implementation collects inputs in the export modal flow.
  - Planned UX refinement: in-modal form (replace prompt-based entry).
- Credential storage:
  - App-specific password is encrypted before persistence.
  - Encryption algorithm: AES-256-GCM.
  - Key material source: APPLE_SYNC_ENCRYPTION_KEY.
  - Development-only fallback key is allowed outside production; production requires explicit key.
- Credential use:
  - Decrypted only in memory for sync/connect operations.
  - Never returned from API responses.

## Data Classification
- Sensitive:
  - App-specific password (plaintext and encrypted forms).
  - Any auth headers or authorization payloads.
- Internal:
  - Apple ID email.
  - Calendar URLs/IDs.
- Non-sensitive:
  - Sync counters and status metadata.

## API Security Contract
- All Apple sync endpoints require authenticated user session.
- Endpoint surface:
  - GET /api/calendar/apple/sync/status
  - POST /api/calendar/apple/sync/connect
  - POST /api/calendar/apple/sync/disconnect
  - GET /api/calendar/apple/sync/scope
  - PUT /api/calendar/apple/sync/scope
  - POST /api/calendar/apple/sync
- Input validation:
  - Enforced with schema validation at route boundaries.
  - Reject invalid payloads with 400 class errors.
- Authorization model:
  - User-scoped operations only; no cross-user access allowed.

## Logging and Redaction Rules
- Must never log:
  - App-specific password (raw or encrypted).
  - Authorization headers/tokens.
  - Full credential objects.
- Allowed logs:
  - User ID (if already standard in server logs).
  - Endpoint/action outcome status.
  - Non-sensitive sync counters and error categories.
- Error logging:
  - Use sanitized messages for auth failures.
  - Avoid emitting raw provider responses if they may include sensitive details.

## Threat Model Summary
### 1) Credential Leakage via Logs
- Risk: accidental logging of sensitive fields.
- Mitigation:
  - strict redaction policy and code review checks.
  - avoid logging request bodies on connect routes.

### 2) At-Rest Credential Exposure
- Risk: DB compromise reveals encrypted secrets.
- Mitigation:
  - AES-256-GCM encryption.
  - managed APPLE_SYNC_ENCRYPTION_KEY rotation process.

### 3) Replay or Misuse of Credentials
- Risk: stolen plaintext used against provider.
- Mitigation:
  - decrypt only for operation scope.
  - no credential echo in API payloads.
  - disconnect path removes persisted connection state.

### 4) Misconfiguration in Production
- Risk: running without explicit encryption key.
- Mitigation:
  - production startup guard and deployment checklist requiring APPLE_SYNC_ENCRYPTION_KEY.

## Operational Guardrails
- Required in production:
  - APPLE_SYNC_ENCRYPTION_KEY
- Optional:
  - APPLE_SYNC_DEBUG (non-sensitive diagnostics only)
  - APPLE_CALDAV_SERVER_URL (override when needed)
- Failure modes:
  - Missing key: Apple sync reports not configured.
  - Invalid credentials: connect/sync return actionable error without secret disclosure.

## Disconnect Semantics
- Disconnect always removes local Apple connection record.
- Remote calendar deletion is not fully automated in initial release.
- If user requests delete-calendar behavior, API returns manual cleanup guidance.

## Rollout and Compliance Checks
- Pre-release checks:
  - Verify no sensitive log emissions in connect/sync flows.
  - Confirm production key presence in deployment environments.
  - Validate unauthorized access is blocked on all Apple sync routes.
- Post-release checks:
  - Monitor sync failure categories (auth, calendar-not-found, network).
  - Review support tickets for credential UX and disconnect clarity.

## Open Decisions
- Decide tie-break policy details for conflict resolution timestamp source in pull path.
- Decide final in-modal credential UX and masking behavior.
- Decide whether to add explicit key rotation runbook in docs.
