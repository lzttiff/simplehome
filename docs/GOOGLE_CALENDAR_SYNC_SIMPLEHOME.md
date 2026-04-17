# Google Calendar Sync in SimpleHome

## Purpose
SimpleHome supports two Google calendar flows:
- Google two-way direct sync (OAuth-based)
- Google subscription feed (one-way)

This document describes how the current implementation works and what data moves in each direction.

## Modes

### 1) Two-way direct sync
- UI entry: Export Schedule modal, button `Sync Selected Two-Way`
- Auth: Google OAuth2 (`/api/calendar/google/sync/start` and callback)
- Calendar target: dedicated calendar named `SimpleHome Maintenance`
- Transport: Google Calendar API (read + write)

### 2) Subscription feed (one-way)
- UI entry: `Subscribe in Google Calendar (Selected)`
- Auth: none (tokenized signed URL)
- Calendar target: user subscribes by URL in Google Calendar
- Transport: ICS feed URLs served by SimpleHome

## API Endpoints

### OAuth and connection state
- `GET /api/calendar/google/sync/status`
- `POST /api/calendar/google/sync/start`
- `GET /api/calendar/google/oauth/callback`
- `POST /api/calendar/google/disconnect`

### Two-way sync execution
- `POST /api/calendar/google/sync`
- Body: selected task IDs and whether minor/major schedules are included

### Subscription feed
- `POST /api/calendar/google/feed-token`
- `GET /api/calendar/google/feed/:token`
- `GET /api/calendar/google/feed/s/:feedId`
- `GET /api/calendar/google/subscriptions/:feedId.ics`

## Data Model Used by Sync

For each maintenance task, sync primarily uses:
- `nextMaintenanceDate` JSON: `{ minor, major }`
- `calendarExports` JSON record for provider `google` + sync mode `direct`

In direct sync, per-task mapping is stored in `calendarExports`:
- `eventIds.minor` / `eventIds.major`
- `eventLinks.minor` / `eventLinks.major`
- `syncedDates.minor` / `syncedDates.major`
- `lastSyncedAt`
- `calendarId`

## Two-way Direct Sync Behavior

### Push logic (SimpleHome -> Google)
For each selected task and maintenance type (minor/major):
1. Read local `nextMaintenanceDate`.
2. Build all-day Google event payload with:
- summary: `Minor Maintenance: <task>` or `Major Maintenance: <task>`
- description: task list or fallback task description
- extended private properties with task ID + maintenance type
3. If event does not exist, create it.
4. If event exists but summary/description/date changed, patch it.

### Pull logic (Google -> SimpleHome)
During the same run:
1. Read current Google event start date.
2. Compare against last synced date (`syncedDates`).
3. If Google changed and local did not, pull Google date into local `nextMaintenanceDate`.
4. If both changed, use last-write-wins by comparing Google event `updated` timestamp with local task `updatedAt`.
5. If event summary or description contains `[DONE]`, treat it as a completion action:
- copy event date into `lastMaintenanceDate` for that maintenance type
- compute new `nextMaintenanceDate` using interval months
- delete the DONE event
- create a fresh event for the new next date

Compatibility notes:
- DONE detection only applies to Google two-way direct sync events (not subscription feeds).
- For older synced events created before rebranding, sync also checks legacy event metadata keys to find matching events.

### Persisted local updates
At end of item sync, server updates:
- `calendarExports`
- `nextMaintenanceDate`
- `lastMaintenanceDate` (when `[DONE]` completion is applied)

Notes:
- Current sync does not change task `status`.
- Pull is user-triggered, not background real-time.

## Subscription Feed Behavior (One-way)

1. Client requests feed token for selected tasks.
2. Server signs payload and returns stable feed URLs (`.ics` variants included).
3. Google periodically fetches ICS feed from SimpleHome.
4. Feed emits all-day events using each selected task's `nextMaintenanceDate`.

Notes:
- Subscription mode is one-way from SimpleHome to Google.
- Editing or deleting subscribed events in Google does not write back to SimpleHome.

## Conflict Handling

In direct sync when both sides changed the same event date:
- compare `event.updated` (Google) vs `task.updatedAt` (SimpleHome)
- newer side wins

This is applied independently for minor and major event tracks.

## Error and Operational Notes

- If Google OAuth tokens expire, refresh is handled via token callbacks and persisted server-side.
- If selected calendar is missing, a new `SimpleHome Maintenance` calendar is created.
- Sync response includes counters:
  - `syncedTasks`
  - `pushedEvents`
  - `pulledChanges`
  - `createdEvents`
  - `updatedEvents`

## Current Limitations

- Sync does not update task `status`; completion is reflected through maintenance dates.
- To apply Google date edits or DONE actions, user must run `Sync Selected Two-Way` again.

## Using DONE From Google

To complete a task from Google Calendar:
1. Open the event in the direct sync calendar (`SimpleHome Maintenance`).
2. Prefix event summary with `[DONE]` and keep the maintenance prefix and task title, for example:
- `[DONE] Major Maintenance: Driveway`
3. Run `Sync Selected Two-Way` in SimpleHome.

Expected result:
- `lastMaintenanceDate` is set from the event date.
- `nextMaintenanceDate` is rolled forward using interval months.
- DONE event is removed.
- New next-cycle event is created.

Troubleshooting:
- If you use subscription feeds, DONE is ignored (one-way mode).
- Optional verbose sync diagnostics can be enabled with `GOOGLE_SYNC_DEBUG=true`.
