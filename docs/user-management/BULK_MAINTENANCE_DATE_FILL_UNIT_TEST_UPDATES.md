# Bulk Maintenance Date Fill Unit Test Updates

## Purpose
Track and standardize unit-test updates for bulk maintenance date fill changes.

## Scope
This document covers test updates for:
- API validation behavior for bulk next maintenance date updates.
- Dashboard and modal workflows related to bulk fill dates.
- Supporting account/settings UI tests touched during related feature work.

## Current Test Updates Implemented

### 1. Dashboard and Account Menu Stability
- Updated component safety for account name/email handling to avoid runtime and test crashes.
- File updated:
  - `client/src/components/account-menu.tsx`
- Validated by:
  - `client/src/pages/dashboard.test.tsx`

### 2. Client UI Test Suite Alignment
- Reworked stale UI test assumptions to match current component contracts and accessibility behavior.
- File updated:
  - `tests/client/user-management-ui.test.tsx`
- Key updates:
  - Uses `@jest-environment jsdom` for browser APIs.
  - Uses `userEvent` for Radix-based menu/popover interactions.
  - Uses current `BulkFillDatesModal` props (`selectedCount`, `onSubmit`).
  - Uses deterministic calendar mocking for stable date selection.
  - Uses timezone-safe date assertion format for submitted payload.

### 3. Server Validation Response Coverage
- Added coverage for bulk fill validation error payload that includes violating tasks.
- File updated:
  - `tests/server/user-management.test.ts`
- Key assertion:
  - Error response includes `message` and `violatingTasks[]` with `id`, `title`, and `lastMaintenanceDate`.

## Verification Command
Use this command chain to validate the updated tests:

npm run check && npx jest --testMatch='**/client/src/pages/dashboard.test.tsx' && npx jest --testMatch='**/tests/client/user-management-ui.test.tsx' && npx jest --testMatch='**/tests/server/user-management.test.ts'

## Policy For Future Feature Changes
For every bulk date fill feature update, include matching test changes in the same pull request.

### Required Checklist
- Update server tests for any new request/response validation behavior.
- Update client tests for any UI copy/interaction/props changes.
- Ensure test queries match current accessibility output.
- Re-run the verification command chain and record status.

## Next Planned Test Coverage (Phase 2 and 3)
- Phase 2 warning flow:
  - Add tests for warning payload with per-task details and confirm/continue behavior.
- Phase 3 per-task minor/major/both selection:
  - Add tests for per-row selection state and payload composition.
  - Add tests for mixed selection scenarios in one bulk operation.

## Phase 3 Coverage Added

### Client UI
- Updated `tests/client/user-management-ui.test.tsx` to validate:
  - Per-task kind selector rendering in `BulkFillDatesModal`.
  - Submit payload includes `taskSelections` with `minor`, `major`, or both per task.

### Server Contract
- Updated `tests/server/user-management.test.ts` to validate payload structure for:
  - `taskSelections: [{ taskId, kinds: [...] }]`
  - Mixed selection types including both `minor` and `major`.
  - Interval warning behavior when `lastMaintenanceDate` is missing (fallback baseline uses today).

## Calendar [DONE] Parity Coverage Added

- Updated `tests/server/googleCalendarSync.test.ts` to assert future `[DONE]` completion dates are clamped to today.
- Updated `tests/server/appleCalendarSync.test.ts` to assert Apple sync follows the same clamped completion behavior via shared helper logic.
