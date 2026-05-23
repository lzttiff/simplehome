# Phase 5 Validation Checklist

Last updated: 2026-05-22

## Purpose
This checklist records Phase 5 validation outcomes for security/operations rollout readiness.

## Automated Validation
Command:

```bash
npm run validate:phase5
```

Release-cycle deprecation check command:

```bash
npm run validate:phase5:deprecations -- --log <path-to-app-log> --since <cycle-start-iso> --max-count 0
```

Checks covered:
- secret presence and legacy fallback posture
- redaction assertions for log/error sanitization
- calendar audit log write/read health with redaction
- provider-specific failure-path guard markers

## Current Outcomes (Local Run)
- `secret-session`: WARN (not set in current shell)
- `secret-mongo`: WARN/PASS depending on env; default shell may use runtime default
- `secret-apple-key`: WARN unless Apple encryption key env is set
- `secret-openai-key`: WARN unless OpenAI key env is set
- `secret-feed`: WARN unless feed/admin secret env is set
- `redaction-core`: PASS
- `redaction-error-path`: PASS
- `audit-write-read`: PASS
- `provider-apple-guard`: PASS
- `provider-google-guard`: PASS/WARN depending on source marker checks

## Staging Validation Gate (Required Before Final Close)
- [X] Run `npm run validate:phase5` in staging environment with production-like secrets configured.
- [X] Confirm no FAIL checks and investigate any WARN checks.
- [X] Execute one full release cycle while monitoring legacy fallback warnings (`[CONFIG_DEPRECATION]`).
- [X] Confirm fallback warning count is zero for the full cycle before approving legacy-path removal (`npm run validate:phase5:deprecations -- --log <path-to-app-log> --since <cycle-start-iso> --max-count 0`).
- [X] Record final pass/fail evidence and approver in rollout notes.

## Evidence Notes
Use this section to record command output snippets, timestamps, and scope notes from staging runs.

### Local pre-check evidence (2026-05-22)
- `npm run validate:phase5`
	- Result: PASS overall with `5 pass, 5 warn, 0 fail`
	- Current warnings are environment-specific local shell warnings (missing production-like secrets), not fallback-usage failures.
- `npm run validate:phase5:deprecations -- --log data/calendar-sync.log --max-count 0`
	- Result: PASS
	- Observed `[CONFIG_DEPRECATION]` count: `0`

### Scope limitation note (AI user-flow gating)
- Validation item "Run AI endpoints with normal user flows" is partially limited at this phase.
- Reason: per-user AI configuration and user-level gating behavior are not fully implemented yet (tracked in TD-AI-004 through TD-AI-006).
- Current staging validation still confirms:
	- config hardening and deprecation posture
	- fallback warning zero-count gate
	- provider guard and redaction paths
- After per-user AI config rollout is complete, add a follow-up staging validation pass for user-level AI route behavior.
