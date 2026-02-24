# Calendar Export Feature

## Overview
The calendar export feature allows you to export maintenance tasks to Google Calendar, Apple Calendar, or any calendar application that supports ICS files. The system tracks which tasks have been exported and provides local management of calendar integrations.

## Features

### 1. **Export Options**
- **Google Calendar**: Downloads an ICS file with instructions for importing to Google Calendar
- **Apple Calendar**: Downloads an ICS file that can be double-clicked to add to Apple Calendar
- **Generic ICS**: Downloads a standard ICS file compatible with any calendar application

### 2. **Local Tracking**
Each task tracks its calendar exports in the `calendar_exports` field:
```json
[{
  "provider": "google" | "apple",
  "eventIds": {
    "minor": "task-id-minor@homeguard.app",
    "major": "task-id-major@homeguard.app"
  },
  "eventLinks": {
    "minor": "https://...",
    "major": "https://..."
  },
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
2. Choose your calendar provider (Google, Apple, or Generic)
3. Follow the on-screen instructions to import the ICS file
4. The export will be tracked locally in HomeGuard

### Viewing Exported Tasks
- In the Export modal, scroll down to see "Exported Tasks"
- Each task shows which calendar it was exported to and when
- Green calendar badges appear on task cards

### Re-exporting/Updating
- To update calendar events, simply export again
- The new export will replace the previous tracking record
- For Google/Apple Calendar, you may need to remove old events manually

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
- Direct Google Calendar API integration (OAuth)
- Automatic sync when task dates change
- Calendar event links for direct access
- Two-way sync to update tasks from calendar changes
- Support for recurring events based on maintenance intervals

## Technical Notes
- Event UIDs use format: `{taskId}-{minor|major}@homeguard.app`
- All dates are stored in ISO 8601 format
- ICS files use CRLF line endings per RFC 5545
- Export tracking is client-side only (no external API calls)
