# User Management and Bulk Date Fill Plan

## Goal

Implement user account lifecycle features and bulk scheduling tools with safe migration behavior for both existing and newly registered users.

## Scope

1. User account actions after login:
- Log out
- Change password
- Delete account

2. Bulk next maintenance date fill:
- Select multiple items/tasks
- Set nextMaintenanceDate for minor or major schedule
- Fill empty only or overwrite existing values

3. Far-future major dates:
- Date picker supports fast year selection for multi-year schedules

---

## Delivery Phases

## Phase 1: Account Actions UI

### UI additions

1. Add account menu on authenticated pages (dashboard shell):
- Log out
- Change password
- Delete account

2. Add dialogs:
- Change Password dialog
- Delete Account dialog

3. Log out wiring:
- Use existing endpoint POST /api/auth/logout
- Clear auth and user-scoped query cache
- Redirect to auth page

### Acceptance criteria

1. User can log out from authenticated UI.
2. Session is cleared and /api/auth/me returns unauthenticated.

---

## Phase 2: Account APIs (with optional calendar data deletion)

### New endpoints

1. PATCH /api/auth/password
2. DELETE /api/auth/account

### Request and response contracts

#### PATCH /api/auth/password

Request body:

{
  "currentPassword": "string",
  "newPassword": "string"
}

Validation:

1. currentPassword required
2. newPassword required, min length 8
3. newPassword must differ from currentPassword

Responses:

1. 200:
{
  "message": "Password updated"
}

2. 400 invalid payload
3. 401 not authenticated
4. 403 current password mismatch
5. 500 server error

#### DELETE /api/auth/account

Request body:

{
  "password": "string",
  "deleteCalendarData": true
}

Rules:

1. password required
2. deleteCalendarData optional, default false

Behavior when deleteCalendarData is true:

1. Remove Google sync scope and connection for user
2. Attempt to delete remote Google events created by app (best effort)
3. Remove local calendar export metadata from user tasks
4. Continue account data deletion

Behavior when deleteCalendarData is false:

1. Skip remote Google event deletion
2. Still remove all app-side user data including auth/session

Responses:

1. 200 full success:
{
  "message": "Account deleted",
  "calendarCleanup": {
    "requested": true,
    "status": "success",
    "eventsDeleted": 123,
    "eventsFailed": 0
  }
}

2. 200 account deleted with partial calendar cleanup:
{
  "message": "Account deleted with calendar cleanup warnings",
  "calendarCleanup": {
    "requested": true,
    "status": "partial",
    "eventsDeleted": 120,
    "eventsFailed": 3,
    "warnings": ["..."]
  }
}

3. 401 not authenticated
4. 403 password mismatch
5. 500 server error

### Data deletion order

1. Calendar cleanup optional path
2. Google connection record
3. Questionnaire responses
4. Maintenance tasks where userId equals current user
5. Property templates where userId equals current user
6. User record
7. Session logout and destroy

### Reliability policy

1. Remote calendar deletion is best effort
2. Account deletion should still complete if remote cleanup is partial
3. Return structured warning details for observability

### Acceptance criteria

1. Password change requires current password and succeeds with valid credentials.
2. Delete account removes user and user-scoped data.
3. deleteCalendarData true triggers remote deletion attempts and structured cleanup report.
4. deleteCalendarData false skips remote deletion and still deletes account.

---

## Phase 3: Bulk Next Maintenance Date Fill

### UI workflow

1. User selects multiple tasks from dashboard list
2. User clicks Bulk Fill Dates
3. Modal options:
- Date kind: minor or major
- Date value
- Apply mode: fill-empty-only or overwrite

### API

Endpoint:

POST /api/tasks/bulk-next-maintenance-date

Request body:

{
  "taskIds": ["task-id-1", "task-id-2"],
  "kind": "minor",
  "date": "2027-09-01",
  "mode": "fill-empty-only"
}

Rules:

1. taskIds non-empty
2. kind is minor or major
3. date is valid yyyy-mm-dd
4. mode is fill-empty-only or overwrite
5. user ownership enforced per task

Response:

{
  "updated": 18,
  "skipped": 7,
  "failed": 0
}

### Acceptance criteria

1. Selected tasks update in one action.
2. fill-empty-only preserves existing values.
3. overwrite replaces existing values.
4. No cross-user updates possible.

---

## Phase 4: Year-Selectable Date UX

### UX requirements

1. Date picker provides month and year controls
2. User can jump years quickly for long major intervals
3. Works for single-item edit and bulk-fill modal

### Suggested bounds

1. minYear: current year minus 10
2. maxYear: current year plus 30

### Acceptance criteria

1. Users can set major due dates several years ahead without excessive month-by-month navigation.
2. Stored format remains yyyy-mm-dd.

---

## Enhancement: Google Calendar ID Visibility & Quick Access

### Feature

User Settings modal displays connected Google Calendar details and provides quick access to Google Calendar:

1. **Calendar ID Display**: Shows the connected Google Calendar ID (e.g., `hliu94539@gmail.com` or calendar-specific ID)
2. **Copy Button**: One-click copy of calendar ID to clipboard
3. **Quick Link**: "Open Google Calendar Settings" button opens Google Calendar in a new tab
4. **Connection Status**: Displays connected account email and last sync timestamp

### Implementation

**Component**: `client/src/components/user-settings-modal.tsx`

**Data Source**: 
- GET `/api/calendar/google/sync/status` (cached 30s, requires auth)
- Returns: `{configured, connected, accountEmail, calendarId, lastSyncedAt, activeScopeCount, syncScopeVersion}`

**UI Location**: User Settings modal → Google Calendar ID section (below timezone selector)

**UX Details**:
- Shows "Google Calendar is not connected" if sync not configured
- Displays loading state while fetching sync status
- Google Calendar link uses reliable main calendar view URL: `https://calendar.google.com/calendar/u/0/r`
- Copy button shows toast feedback on success/failure

### Acceptance Criteria

1. Users can view their connected Google Calendar ID without leaving the app
2. Calendar ID can be copied to clipboard with one click
3. Users can open Google Calendar from the quick link to manage or verify their SimpleHome calendar
4. No errors on connection failures or missing calendar data

---

## Phase 5: Testing and Rollout

### Tests

1. Server tests for password change and account deletion paths
2. Server tests for bulk date endpoint modes and ownership checks
3. UI tests for account dialogs and bulk date modal interactions
4. Google Calendar sync status query and link rendering tests

### Rollout order

1. Phase 1 and Phase 2
2. Phase 3
3. Phase 4
4. Google Calendar ID visibility enhancement
5. Phase 5 verification gate before production deploy

### Operational checklist

1. Add structured logs for account deletion and calendar cleanup stats
2. Add alerting for repeated calendar cleanup failures
3. Confirm session invalidation across all clients after account deletion
4. Monitor Google Calendar sync status API response times and errors

---

## Suggested Implementation Slices

1. PR 1: Account menu plus logout UX
2. PR 2: Change password endpoint plus dialog
3. PR 3: Delete account endpoint plus dialog with deleteCalendarData option
4. PR 4: Bulk nextMaintenanceDate endpoint plus modal
5. PR 5: Year-picker enhancement for all date entry points
6. PR 6: Google Calendar ID visibility in User Settings (with quick link)
7. PR 7: Test hardening and release checklist
