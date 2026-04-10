# Timezone and Date-Only Migration Summary

## Scope

This document summarizes the timezone and maintenance-date migration work completed so far.

The goal was to make user timezone the source of truth for date interpretation while storing maintenance schedule dates as canonical date-only values (`YYYY-MM-DD`) instead of instant timestamps.

## What Changed

### 1. User timezone support

- Added/used `timezone` on the `User` model.
- Profile update endpoint supports timezone updates.
- Client settings UI allows selecting and saving an IANA timezone.
- Session/user profile refresh reflects updated timezone in subsequent requests.

Primary files:

- `shared/schema.ts`
- `server/storage.ts`
- `server/routes.ts`
- `client/src/components/user-settings-modal.tsx`
- `client/src/pages/dashboard.tsx`

### 2. Canonical maintenance-date storage (`YYYY-MM-DD`)

- Added shared helpers for:
  - date normalization (`normalizeDateOnly`)
  - local date conversion (`toDateOnlyFromLocalDate`)
  - date math (`addMonthsToDateOnly`)
  - date comparison and day-diff logic
  - maintenance schedule parse/serialize helpers for backward compatibility
- Updated create/update flows to write canonical date-only schedule payloads.
- Added normalization at storage boundary so legacy ISO payloads are normalized when persisted.

Primary files:

- `shared/schema.ts`
- `server/storage.ts`
- `client/src/components/add-task-modal.tsx`
- `client/src/components/edit-task-modal.tsx`
- `client/src/components/task-card.tsx`
- `client/src/pages/dashboard.tsx`

### 3. Calendar and stats behavior aligned to timezone semantics

- Google and Apple feed token payloads include timezone.
- ICS generation uses payload timezone and date-only values.
- Past-due stats now evaluate "today" by authenticated user timezone.
- Google two-way sync schedule handling now keeps canonical date-only schedule values.

Primary files:

- `server/routes.ts`
- `server/services/googleCalendarSync.ts`

## Compatibility

- Existing legacy schedule values (ISO strings) are still accepted.
- Shared parsing logic normalizes legacy values to `YYYY-MM-DD`.
- New writes are canonicalized so data converges over time.

## Current Behavior Model

- Keep UTC/instant timestamps for true instants (e.g., `createdAt`, `updatedAt`, sync metadata).
- Keep maintenance business dates as date-only values (`YYYY-MM-DD`).
- Apply user/feed timezone when evaluating day boundaries or rendering fallback timed values.

## Notes

- Some unrelated workspace file changes existed before this commit; they were intentionally excluded from this migration commit.