# Timezone and Date-Only Migration Summary

## Objective

Make the application multi-user timezone-safe by:

1. Persisting each user's IANA timezone preference.
2. Treating maintenance schedule dates as business dates (`YYYY-MM-DD`) instead of timestamp instants.
3. Using user/feed timezone for day-boundary logic (filtering, overdue checks, and calendar outputs).

## Final Design

### Time semantics

- **Instant fields** stay as UTC timestamps (for example: `createdAt`, `updatedAt`, sync metadata).
- **Maintenance schedule fields** (`lastMaintenanceDate`, `nextMaintenanceDate`) are stored as date-only payloads in JSON:
  - `{ minor: "YYYY-MM-DD" | null, major: "YYYY-MM-DD" | null }`

### Timezone source of truth

- User timezone is stored on the user profile (`User.timezone`) and used in server-side calculations where day boundaries matter.

## Implemented Changes

### 1) User timezone model, storage, and profile update

- Added timezone to shared user types and storage read/write paths.
- Added profile endpoint support for timezone update.
- Ensured session user refresh after profile change.

Key files:

- `shared/schema.ts`
- `server/storage.ts`
- `server/routes.ts`

### 2) Client timezone settings and display behavior

- Added timezone settings modal with common IANA options and browser-timezone fallback.
- Added timezone-aware date formatting fallback for legacy timed strings.
- Updated date picker storage conversion to output canonical date-only strings.

Key files:

- `client/src/components/user-settings-modal.tsx`
- `client/src/pages/dashboard.tsx`

### 3) Shared date-only utility layer

Added shared helpers to centralize business-date logic:

- `normalizeDateOnly`
- `toDateOnlyFromLocalDate`
- `dateOnlyToUtcIsoString`
- `addMonthsToDateOnly`
- `compareDateOnly`
- `dayDiffDateOnly`
- `parseMaintenanceSchedule`
- `serializeMaintenanceSchedule`

Key file:

- `shared/schema.ts`

### 4) Client write paths migrated to date-only

- Add Task, Edit Task, and Task completion flows now serialize maintenance schedules via shared date-only helpers.
- Next maintenance date calculations now use date-only month math.

Key files:

- `client/src/components/add-task-modal.tsx`
- `client/src/components/edit-task-modal.tsx`
- `client/src/components/task-card.tsx`

### 5) Client filter/sort logic migrated to date-only

- Dashboard date filtering and next-date sorting now compare date-only values directly.
- Avoids timezone drift from instant parsing.

Key file:

- `client/src/pages/dashboard.tsx`

### 6) Storage boundary normalization

- Maintenance schedule blobs are normalized on create/update in storage.
- Legacy ISO-shaped values are accepted and converted to canonical date-only values during persistence.

Key file:

- `server/storage.ts`

### 7) Calendar feed and sync alignment

- Google/Apple feed token payloads include timezone (`tz`).
- ICS feed header timezone uses payload timezone.
- ICS event day clamping (past-date handling) now uses feed timezone day boundary.
- Google two-way sync now keeps canonical date-only schedule values.

Key files:

- `server/routes.ts`
- `server/services/googleCalendarSync.ts`

### 8) Stats overdue logic uses user timezone

- `/api/stats` overdue checks now compute "today" in authenticated user's timezone.

Key file:

- `server/routes.ts`

## Backward Compatibility

- Legacy maintenance date values (ISO strings) remain readable.
- Shared parsing converts legacy inputs to canonical date-only outputs.
- New writes converge data toward date-only canonical format.

## Operational Notes

- The timezone/date-only migration was committed separately from unrelated local changes to keep history focused.
- Temporary reconciliation branch used for upstream history alignment was deleted after merge.

## Recommended Next Validation

1. Verify task add/edit/complete flows in two different user timezones.
2. Verify dashboard filter and sort behavior around local midnight boundaries.
3. Verify Google/Apple subscriptions render same calendar day as in-app schedule.