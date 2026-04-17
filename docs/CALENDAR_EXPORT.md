# Calendar Export Feature

## Overview
The calendar export feature allows you to export maintenance tasks to Google Calendar, Apple Calendar, or any calendar application that supports ICS files. The system tracks which tasks have been exported and provides local management of calendar integrations.

## Features

### 1. **Export Options**
- **Google Calendar**: Downloads an ICS file with instructions for importing to Google Calendar
- **Apple Calendar**: Downloads an ICS file that can be double-clicked to add to Apple Calendar
- **Generic ICS**: Downloads a standard ICS file compatible with any calendar application
- **Google Two-Way Sync**: Connects a Google account with OAuth, creates a dedicated `SimpleHome Maintenance` calendar, and syncs selected task dates in both directions when you run sync

### 2. **Local Tracking**
Each task tracks its calendar exports in the `calendar_exports` field:
```json
[{
  "provider": "google" | "apple",
  "syncMode": "subscription" | "direct" | "file",
  "eventIds": {
    "minor": "task-id-minor@simplehome.app",
    "major": "task-id-major@simplehome.app"
  },
  "eventLinks": {
    "minor": "https://...",
    "major": "https://..."
  },
  "selected": {
    "minor": true,
    "major": true
  },
  "syncedDates": {
    "minor": "2026-04-01T00:00:00.000Z",
    "major": "2026-10-01T00:00:00.000Z"
  },
  "calendarId": "simplehome@example.com",
  "lastSyncedAt": "2025-12-18T10:30:00.000Z"
}]
```

### 3. **Visual Indicators**
- Tasks with calendar exports show a green calendar badge (G for Google, A for Apple)
- Export modal displays all previously exported tasks with their sync status
- Hover over badges to see which calendars the task was exported to

### 4. **Event Details**
Each exported event includes:
- **Title**: "Minor Maintenance: [Task Name]" or "Major Maintenance: [Task Name]"
- **Date**: The scheduled maintenance date
- **Description**: List of specific maintenance tasks
- **Category**: The task category for organization
- **Unique ID**: Persistent identifier for event tracking

## Usage

### Exporting Tasks
1. Click "📋 Export Schedule" in the Dashboard sidebar
2. Choose one of these flows:
  - Google two-way sync: connect your Google account, then click `Sync Selected Two-Way`
  - Google subscription: copy the feed URL into Google Calendar `Add by URL`
  - Apple subscription: copy the feed URL into Apple Calendar `Subscribe`
  - Apple or Generic file export: download the ICS file
3. Follow the on-screen instructions
4. The export or sync state will be tracked locally in SimpleHome

### Google Two-Way Sync Setup
The Google OAuth flow requires these environment variables on the server:

```bash
GOOGLE_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
PUBLIC_BASE_URL=https://your-public-app-host
```

Your Google OAuth client must allow this redirect URI:

```text
https://your-public-app-host/api/calendar/google/oauth/callback
```

Notes:
- `PUBLIC_BASE_URL` must be a publicly reachable HTTPS URL for both Google OAuth and Google subscription feeds
- The current two-way sync flow is user-triggered: run sync again after editing Google event dates if you want those changes pulled back into SimpleHome immediately
- SimpleHome stores Google OAuth tokens server-side and stores per-task event mappings in `calendar_exports`

### Viewing Exported Tasks
- In the Export modal, scroll down to see "Exported Tasks"
- Each task shows which calendar it was exported to and when
- Green calendar badges appear on task cards

### Re-exporting/Updating
- To update calendar events, simply export again
- The new export will replace the previous tracking record
- For Google/Apple Calendar, you may need to remove old events manually
- For Google two-way sync, rerun `Sync Selected Two-Way` to push SimpleHome changes and pull Google-side date edits

## Database Schema

### Migration
Run the migration to add the `calendar_exports` column:
```sql
ALTER TABLE maintenance_tasks ADD COLUMN IF NOT EXISTS calendar_exports TEXT;
```

### Field Definition
```typescript
calendarExports: text("calendar_exports")
// Stores: [{provider, eventIds, eventLinks, lastSyncedAt}]
```

## ICS File Format
The exported ICS file follows RFC 5545 standard and includes:
- `VCALENDAR` container with metadata
- `VEVENT` entries for each scheduled maintenance
- Proper date formatting (YYYYMMDD for all-day events)
- UTF-8 encoding for international characters

## Future Enhancements
- Automatic sync when task dates change without requiring a manual sync run
- Calendar event links for direct access
- Support for recurring events based on maintenance intervals

## Technical Notes
- Event UIDs use format: `{taskId}-{minor|major}@simplehome.app`
- All dates are stored in ISO 8601 format
- ICS files use CRLF line endings per RFC 5545
- Export tracking is client-side only (no external API calls)
