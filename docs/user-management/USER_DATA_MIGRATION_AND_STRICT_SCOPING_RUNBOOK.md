# User Data Migration and Strict Scoping Runbook

## Goal

Roll out strict `userId` data ownership without user-visible data loss, while preserving a safe recovery path for existing legacy records.

## Scope

This runbook applies to:

1. `property_templates`
2. `maintenance_tasks`
3. `questionnaire_responses`

Legacy records are documents where `userId` is `null` or missing.

## Why This Is Needed

If strict user-scoped reads are enabled before legacy records are migrated, users can suddenly see empty dashboards even though their historical data still exists in MongoDB.

## Rollout Policy

Use a two-phase rollout with hard deployment gates.

### Phase A: Compatibility + Migration

1. Keep compatibility behavior while migration runs.
2. Run legacy detection guard.
3. Run migration/recovery scripts.
4. Re-run guard until it passes.

### Phase B: Strict Enforcement

1. Enable strict user-scoped reads.
2. Keep guard in CI to prevent regression.
3. Monitor post-release user health signals.

## Hard Gates (Must Pass)

### Gate 1: Legacy Guard

```bash
npm run guard:legacy-userid
```

Pass criteria:

1. `property_templates` legacy count = 0
2. `maintenance_tasks` legacy count = 0
3. `questionnaire_responses` legacy count = 0

### Gate 2: Server Tests

```bash
npm run test:server
```

### Gate 3: Rollout Guard Test Target

```bash
npm run test:rollout-guard
```

This produces a clear failure message with exact legacy counts when rollout is unsafe.

## Recovery Procedure (Per User)

Use this when a specific user appears to have "lost" data after strict scoping.

Dry run:

```bash
npm run recover:legacy-user-data -- --email=<user-email> --dry-run
```

Apply:

```bash
npm run recover:legacy-user-data -- --email=<user-email>
```

Recovery behavior:

1. Copies legacy templates/tasks to the target `userId`.
2. Remaps task `templateId` values to copied template IDs.
3. Avoids duplicate inserts using template type and task signature checks.

## Release Checklist

### Pre-Release

1. Run `npm run guard:legacy-userid`.
2. If guard fails, run migration/recovery and repeat until pass.
3. Run `npm run test:server`.
4. Confirm account lifecycle checks in staging:
	1. register
	2. login
	3. logout
	4. delete + recreate

### Deploy

1. Deploy strict-scoped build only after all gates pass.
2. Record guard output in release notes.

### Post-Deploy (First 24h)

1. Track authenticated users returning zero templates/tasks.
2. Track account delete + recreate behavior.
3. Keep recovery script ready for targeted remediation.

## Rollback Plan

If user-impact is detected:

1. Stop rollout immediately.
2. Temporarily restore compatibility read behavior.
3. Run guard + migration.
4. Re-attempt strict rollout only after zero-legacy guard pass.

## CI/CD Recommendation

Add these as required steps before production deploy:

```bash
npm run guard:legacy-userid
npm run test:rollout-guard
npm run test:server
```

Fail-fast policy:

1. Any guard failure blocks deploy.
2. No manual override without incident review.

## Ownership and Accountability

1. Engineering owns migration script quality and idempotency.
2. Release manager owns gate verification in CI/CD.
3. On-call owns post-release monitoring and recovery execution.

## Success Criteria

1. No authenticated user loses visibility to previously owned data.
2. New users always receive user-owned seeded templates/tasks.
3. Legacy counts remain zero in every release cycle.
