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
- [ ] Run `npm run validate:phase5` in staging environment with production-like secrets configured.
- [ ] Confirm no FAIL checks and investigate any WARN checks.
- [ ] Execute one full release cycle while monitoring legacy fallback warnings (`[CONFIG_DEPRECATION]`).
- [ ] Confirm fallback warning count is zero for the full cycle before approving legacy-path removal (`npm run validate:phase5:deprecations -- --log <path-to-app-log> --since <cycle-start-iso> --max-count 0`).
- [ ] Record final pass/fail evidence and approver in rollout notes.

## Evidence Notes
Use this section to paste command output snippets and timestamps from staging runs.
