# Test Reliability Multi-Phase Plan

This document tracks the phased hardening plan for front-end unit tests, why each phase exists, and what has been implemented.

## Why this plan exists

Recent test failures were caused by a mix of factors:

- duplicated test setup across suites
- fixture drift when task schema evolved
- fragile selectors tied to UI details that changed
- inconsistent query client/fetch behavior in tests

A multi-phase plan reduces risk by shipping reliability improvements in small, reviewable increments.

## Scope

Current scope focuses on high-churn client suites:

- `client/src/components/task-card.test.tsx`
- `client/src/pages/dashboard.test.tsx`

## Phase breakdown

### Phase 1: Shared foundation

Goal:

- centralize common test setup to reduce copy-paste drift

Implemented:

- Added `client/src/test/test-utils.tsx`:
  - `createTestQueryClient()` with stable defaults (`retry: false`)
  - shared default query function using `fetch`
  - `renderWithQueryClient()` wrapper
  - `mockJsonFetch()` helper for route-based fetch stubbing
- Added `client/src/test/fixtures.ts`:
  - `createMaintenanceTaskFixture()` typed factory for `MaintenanceTask`

Reasoning:

- when schema changes happen, we now update one fixture builder instead of many ad hoc objects
- query setup is consistent across suites, reducing accidental behavior differences

Status: Done

### Phase 2: Suite migration

Goal:

- migrate brittle suites to the shared foundation without changing intended behavior

Implemented:

- Refactored `client/src/components/task-card.test.tsx` to use:
  - `createMaintenanceTaskFixture()`
  - `renderWithQueryClient()`
  - `mockJsonFetch()`
- Refactored `client/src/pages/dashboard.test.tsx` to use:
  - `createMaintenanceTaskFixture()`
  - `renderWithQueryClient()`
  - `mockJsonFetch()` for baseline fetch behavior

Reasoning:

- removes duplicated query-client setup and repeated task object boilerplate
- makes tests easier to update when fields or default behavior evolve

Status: Done

### Phase 3: Verification gates

Goal:

- prove suites are stable after refactor and preserve behavior

Planned validation:

- run targeted suites repeatedly
- keep memory profile (`NODE_OPTIONS=--max-old-space-size=4096`) for reproducibility

Progress update:

- Repeated targeted runs were executed to validate deterministic pass behavior.
- Added follow-up warning hygiene work to reduce noisy output during verification.

Status: In progress

### Phase 4: Ongoing quality guardrails

Goal:

- prevent reliability regression from reappearing

Implemented guardrails:

- Added npm scripts:
  - `npm run test:client:targeted`
  - `npm run test:client:stability`
- Added repeat-run script:
  - `scripts/verify-client-test-stability.sh`
- Added CI workflow:
  - `.github/workflows/test-reliability.yml`
  - PR fast gate runs targeted client reliability suites
  - Nightly job runs repeated stability check

Ongoing practices:

- prefer shared fixture builders for all new client tests
- avoid assertions on incidental text/layout where role-based assertions are available
- keep fetch mocks centralized per suite
- evaluate warning cleanup (`act(...)`) as a separate pass to keep semantic changes isolated

Status: In progress

## Change log

- 2026-04-17: Created this plan and completed Phases 1 and 2 foundation/migration for task-card and dashboard suites.
- 2026-04-17: Committed Phase 1-2 work in `test: phase 1-2 reliability foundation for client suites`.
- 2026-04-17: Began next phase warning-noise reduction (`use-toast` mock in task-card tests, dashboard log suppression in dashboard tests).
- 2026-04-17: Committed phase 3 warning hygiene in `test: phase 3 warning hygiene and cleaner verification output`.
- 2026-04-17: Started phase 4 CI guardrails with targeted/stability scripts and GitHub workflow automation.
