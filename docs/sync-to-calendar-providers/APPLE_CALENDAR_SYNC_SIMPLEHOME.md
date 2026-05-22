# Apple Calendar Two-Way Sync Setup and Operations

## Overview

Apple Calendar two-way sync allows you to keep maintenance tasks synchronized between SimpleHome and your iCloud Calendar over CalDAV. Changes made in SimpleHome push to Apple Calendar, and changes made in Apple Calendar pull back into SimpleHome.

This document covers setup, connection management, sync behavior, and troubleshooting.

## Prerequisites

- Apple ID with iCloud Calendar access
- App-specific password (required; see setup below)
- Network access to Apple CalDAV servers

## Security Model (Provider Delta)

Canonical shared security policy lives in:
- [MAINTAINER_CONFIGURATION_AND_DEBUGGING.md](MAINTAINER_CONFIGURATION_AND_DEBUGGING.md)

Apple-specific security delta:
- Authentication is per-user via Apple app-specific password (no OAuth in current implementation).
- Stored Apple credential payload is encrypted at rest using `APPLE_SYNC_ENCRYPTION_KEY`.
- `APPLE_SYNC_DEBUG` is opt-in and should remain disabled in production by default.
- `APPLE_CALDAV_SERVER_URL` may be overridden for advanced deployments.

Policy ownership note:
- Shared security/config policy is maintained only in the maintainer guide to avoid drift.
- This document intentionally keeps provider-specific behavior and implementation details only.

## Environment Setup

Canonical environment variable catalog, migration mapping, and deprecation timelines are maintained in [MAINTAINER_CONFIGURATION_AND_DEBUGGING.md](MAINTAINER_CONFIGURATION_AND_DEBUGGING.md).

### Required Variables

The following environment variable is **required** for production use:

```bash
APPLE_SYNC_ENCRYPTION_KEY=<a-32-byte-hex-string>
```

This key encrypts Apple credentials at rest in the database. Generate a secure key using:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Optional Variables

```bash
# Enable verbose debug logs (development only; DO NOT use in production)
APPLE_SYNC_DEBUG=true

# Override CalDAV server URL (advanced; defaults to iCloud CalDAV)
APPLE_CALDAV_SERVER_URL=https://caldav.icloud.com
```

## Connect Flow

### Step 1: Obtain App-Specific Password

1. Go to [Apple ID account settings](https://appleid.apple.com/account/manage).
2. Navigate to **Security** → **App passwords**.
3. Select **Other Apps** and create a new app password.
4. Copy the generated password (format: `xxxx-xxxx-xxxx-xxxx`).
5. **Do not share this password**; it is treated as a secret and encrypted immediately upon connection.

### Step 2: Connect in SimpleHome

1. Open the **Export Schedule** modal.
2. Navigate to the **Export Options** tab.
3. In the **Apple Calendar** section, click **"Connect Apple Calendar"**.
4. When prompted, enter:
   - **Apple ID Email**: your iCloud email (e.g., `user@icloud.com`)
   - **App-Specific Password**: the 16-character password from Step 1
5. Click **"Connect"**.
6. SimpleHome validates the connection and retrieves your available calendars.

#### Connection Validation

On successful connection, you will see:

```
✓ Connected to: user@icloud.com
  Calendar: SimpleHome Maintenance
  Synced: 0 tasks
```

If validation fails, check:

- Apple ID email is correct.
- App-specific password is current (recent Apple ID security events may invalidate it).
- iCloud Calendar is enabled on your Apple account.
- CalDAV is not disabled by your Apple security settings.

### Step 3: Select Scope

After connecting, choose which tasks to sync with Apple Calendar:

1. Click **"Select Scope"** in the Apple section.
2. Check boxes for **Minor** and/or **Major** maintenance tasks.
3. SimpleHome will:
   - Create corresponding events in Apple Calendar.
   - Create local mapping records.
   - Begin syncing on next **"Sync Now"** action.

## Sync Behavior

### Push (SimpleHome → Apple)

When you click **"Sync Now"**:

1. SimpleHome scans selected tasks for changes since last sync.
2. **New tasks**: Creates new events in Apple Calendar with title `Minor Maintenance: [Task Name]` or `Major Maintenance: [Task Name]`.
3. **Updated tasks**: Modifies Apple event dates and descriptions.
4. **Out-of-scope removals**: Deletes events for tasks you've removed from the scope.

### Pull (Apple → SimpleHome)

During the same sync run, after pushing changes:

1. SimpleHome fetches all Apple events for the current scope.
2. **Date edits**: If you changed an event date in Apple Calendar, SimpleHome detects it and updates `nextMaintenanceDate` locally.
3. **DONE marker**: If you mark an event with `[DONE]` in the title or description (e.g., `Minor Maintenance: [DONE] Roof Inspection`), SimpleHome:
   - Sets `lastMaintenanceDate` to today.
   - Rolls `nextMaintenanceDate` forward by the task's interval.
   - Clears any backlog overflow fields.
   - Deletes the [DONE] event and creates a new event for the next maintenance cycle.

### Conflict Resolution

If both SimpleHome and Apple Calendar have changes to the same task date since the last sync:

- **Timestamps compared**: SimpleHome compares the Apple event's `LAST-MODIFIED` (or `DTSTAMP`) to the local task's `updatedAt`.
- **Tie-breaker**: If both were updated simultaneously (within seconds), **local SimpleHome change wins** to prevent user edits in SimpleHome from being overwritten.
- **Result**: The winning date is pushed back to the losing side on the next sync.

### Example Sync Session

```
Before sync:
  SimpleHome: Minor Roof → nextMaint: 2026-06-01
  Apple: Minor Roof → 2026-06-01

User edits in Apple Calendar:
  Apple: Minor Roof → 2026-07-15

Run "Sync Now":
  ✓ Pushed 0 updates to Apple (no local changes)
  ✓ Pulled 1 change from Apple
  ✓ NextMaintenanceDate updated: 2026-07-15

After sync:
  SimpleHome: Minor Roof → nextMaint: 2026-07-15
  Apple: Minor Roof → 2026-07-15
```

## Monitoring and Status

### Sync Status

The **Apple Calendar** section in the Export modal displays:

- **Connection Status**: ✓ Connected or ✗ Not connected
- **Account Email**: The connected iCloud email
- **Last Synced**: Timestamp of the last successful sync
- **Active Scope**: Number of task kinds (minor/major) selected for sync
- **Sync Version**: Internal version counter for scope changes

### Sync Counters

After each sync, you see:

```
Synced 8 tasks
• Pushed 14 events
• Pulled 3 changes
• 2 created
• 12 updated
• 1 marked DONE
• 2 rescheduled
```

## Disconnect and Cleanup

### Disconnect Flow

1. Click **"Disconnect Apple Calendar"** in the Export modal.
2. Confirm the action.
3. SimpleHome:
   - Revokes local access to the Apple connection.
   - **Deletes all mapped events from Apple Calendar**.
   - Clears credential storage.
   - Resets scope to empty.

**Note**: This action is **permanent**. Your task dates remain in SimpleHome but are no longer synced with Apple Calendar.

### Manual Cleanup

If you need to remove just some events without fully disconnecting:

1. In the **Select Scope** dialog, uncheck the task kinds you want to remove.
2. Click **"Sync Now"**.
3. SimpleHome detects scope reduction and attempts to delete the out-of-scope events from Apple Calendar.

## Troubleshooting

### Connection Fails

**Error**: "Invalid credentials" or "CalDAV server unreachable"

**Causes**:
- App-specific password is incorrect or expired.
- iCloud Calendar is disabled in account settings.
- Network firewall blocks CalDAV (port 443).

**Solutions**:
1. Regenerate app-specific password at [Apple ID settings](https://appleid.apple.com/account/manage).
2. Ensure iCloud Calendar is enabled in Apple ID > Settings > Apps Using Your Apple ID.
3. Check network/firewall allows outbound HTTPS to `caldav.icloud.com`.

### Sync Fails or Hangs

**Error**: "Sync timed out" or "Sync did not complete"

**Causes**:
- Network latency to iCloud.
- Large number of tasks (>100) causing timeout.
- CalDAV server temporary unavailability.

**Solutions**:
1. Wait 1–2 minutes and retry **"Sync Now"**.
2. If issue persists, check Apple System Status: https://www.apple.com/support/systemstatus/
3. For debugging, enable `APPLE_SYNC_DEBUG=true` and check server logs.

### Test Reliability (Jest OOM During Development)

If you are running the Apple sync test suite locally and encounter Jest out-of-memory crashes:

```bash
# Use dedicated Apple sync test runner with memory guardrails:
npm run test:server:apple-sync
```

This command runs only Apple sync tests with:
- Worker memory limit: 512 MB per worker
- Max workers: 50% of CPU cores
- Isolated module loading
- 4 GB Node.js heap

See [TEST_RELIABILITY_MULTI_PHASE_PLAN.md](TEST_RELIABILITY_MULTI_PHASE_PLAN.md) for more details.

### Partial Sync Failures

**Scenario**: Sync completes but some tasks were not synced.

**Reason**: SimpleHome isolates failures per task to prevent a single event issue from blocking others.

**Info**: Check server logs (enable `APPLE_SYNC_DEBUG=true`) for which tasks failed and why:

```
[APPLE_SYNC] Skipping Minor Roof: CalDAV not found (will retry on next sync)
```

**Recovery**: SimpleHome automatically attempts to recover on the next sync. If an event is missing from Apple after deletion, SimpleHome recreates it deterministically using the task ID.

### Security and Credential Safety

- **Credentials are never logged**: All sensitive fields (email, passwords, tokens) are redacted.
- **Encryption**: Credentials are encrypted with `APPLE_SYNC_ENCRYPTION_KEY` before storage.
- **Disconnect clears storage**: Disconnecting removes all traces of credentials from the database.

## Advanced Configuration

### Custom CalDAV Server

If you use a CalDAV provider other than iCloud, set:

```bash
APPLE_CALDAV_SERVER_URL=https://your-caldav-server.example.com
```

**Note**: This is for advanced users only. SimpleHome is tested against iCloud CalDAV. Other providers may have incompatible event formats.

### Debug Logging

Enable verbose logs (development only):

```bash
APPLE_SYNC_DEBUG=true
npm start
```

Logs will include:
- CalDAV request/response details
- Event mapping operations
- Conflict resolution decisions
- Retry attempts and recovery actions

**⚠️ Warning**: Do not enable `APPLE_SYNC_DEBUG` in production; logs may include sensitive values in edge cases.

## Comparison with Other Export Options

| Feature | Google Two-Way | Apple Two-Way | Apple Subscription | Apple ICS File |
|---------|---|---|---|---|
| **Sync Direction** | Both | Both | One-way (→ Apple) | One-time |
| **Real-Time Updates** | Manual trigger | Manual trigger | Manual subscribe | Manual reimport |
| **Conflict Resolution** | Last-write-wins + local tie-breaker | Last-write-wins + local tie-breaker | N/A | N/A |
| **DONE Marker Support** | ✓ Auto-complete + roll-forward | ✓ Auto-complete + roll-forward | ✗ | ✗ |
| **Setup** | OAuth (browser flow) | App-specific password | Copy feed URL | Download file |
| **Credential Storage** | Token encrypted | Password encrypted | Feed URL only | N/A |
| **Best For** | Users wanting automated sync & updates | Users wanting sync without OAuth | Users wanting passive calendar subscription | One-time calendar backup |

## Support and Feedback

If you encounter issues not covered here:

1. Check server logs: `npm run logs` (if available).
2. Verify `APPLE_SYNC_ENCRYPTION_KEY` is set in production.
3. File an issue with:
   - Error message (redacted of credentials).
   - Approximate time of failure.
   - Which tasks were affected.
   - Calendar app version (iCloud web or macOS Calendar).

## Related Documentation

- [APPLE_CALENDAR_SYNC_DESIGN_SECURITY_DECISIONS.md](APPLE_CALENDAR_SYNC_DESIGN_SECURITY_DECISIONS.md) – Design decisions and security model.
- [CALENDAR_EXPORT.md](CALENDAR_EXPORT.md) – General calendar export feature overview.
- [TEST_RELIABILITY_MULTI_PHASE_PLAN.md](TEST_RELIABILITY_MULTI_PHASE_PLAN.md) – Test suite reliability notes.
- [MAINTAINER_CONFIGURATION_AND_DEBUGGING.md](MAINTAINER_CONFIGURATION_AND_DEBUGGING.md) – Centralized environment variable reference and debugging workflows.
