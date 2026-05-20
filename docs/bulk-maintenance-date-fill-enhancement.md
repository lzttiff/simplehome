# Bulk Maintenance Date Fill Enhancement Proposal

## Overview
This document outlines the proposed enhancements to the bulk maintenance date fill feature, focusing on improved validation, user feedback, and per-task event type selection.

---


## 1. Validation: Prevent Dates Earlier Than Last Maintenance
- **Backend Implementation:**
  - The `/api/tasks/bulk-next-maintenance-date` endpoint now checks, for each task, if the chosen date is earlier than its `lastMaintenanceDate` (for the selected kind: minor/major).
  - If any violations are found, the API returns a 400 error with a list of violating tasks (including their IDs and titles).
  - No updates are performed for these tasks; the operation is blocked for them.

- **Frontend Behavior:**
  - When the API returns this error, the UI displays a clear error message and lists the affected tasks to the user.
  - The user must adjust their selection before proceeding.

- **Example Error Response:**
  ```json
  {
    "message": "Selected date is earlier than last maintenance date for some tasks.",
    "violatingTasks": [
      { "id": "task-1", "title": "Replace HVAC Filter", "lastMaintenanceDate": "2026-05-01" },
      { "id": "task-2", "title": "Test Water Pressure", "lastMaintenanceDate": "2026-04-15" }
    ]
  }
  ```

- **User Experience:**
  - The error message is shown in the bulk fill modal or as a toast/alert, with the list of violating tasks for easy review and correction.

---

## 2. Warning: Exceeding Recommended Maintenance Interval
- **Behavior:**
  - For each task, check if the chosen date exceeds the recommended interval (minor/major) from `lastMaintenanceDate`.
  - If `lastMaintenanceDate` is missing, use today's date as the fallback baseline for interval warning checks.
  - If violations exist, show a warning listing all affected tasks:
    > "Warning: The following tasks exceed the recommended interval for [minor/major] maintenance: [Task X, Task Y]. Do you want to proceed?"
  - Allow the user to proceed after acknowledging the warning.

---

## 3. Per-Task Minor/Major Event Selection
- **UI/UX:**
  - In the bulk fill dialog, display a list/table of selected tasks eligible for date update.
  - For each task, provide a dropdown with options:
    - Minor only
    - Major only
    - Both

- **Behavior:**
  - The user selects which event type(s) (minor, major, or both) to update for each task.
  - The bulk operation applies the chosen date only to the selected event type(s) for each task.
  - Backend accepts `taskSelections` payload and validates each selected kind independently.
  - Warning/error responses include task and kind details (for example `Task A (major)`).

- **Implementation Status:**
  - Implemented in `BulkFillDatesModal` and dashboard submit flow.
  - Legacy payload (`taskIds` + `kind`) remains supported for backward compatibility.

---

## 4. Example Table Layout

| Task Name | Last Maintenance | Event Type to Update | Chosen Date |
|-----------|------------------|---------------------|-------------|
| Task A    | 2024-01-01       | Minor only / Major only / Both | 2026-05-20  |
| Task B    | 2025-03-15       | Minor only / Major only / Both | 2026-05-20  |

---

## 5. Implementation Notes
- All validations and warnings should be performed before applying changes.
- UI should clearly indicate errors and warnings, and allow the user to adjust their selection.
- Store the user's event type selection for each task in the bulk update state.
- When validating and applying, use the per-task event type selection.

## 6. Test Updates (Required)
- Unit tests should be updated whenever bulk fill behavior changes.
- Current coverage updates include:
  - UI test alignment with current component APIs for `AccountMenu`, `BulkFillDatesModal`, and `UserSettingsModal`.
  - Server-side validation response shape checks for `violatingTasks` when selected date is earlier than `lastMaintenanceDate`.
- Future updates for Phase 2 and Phase 3 should add/adjust tests in the same pull request as implementation changes.
- Dedicated test update log:
  - `docs/BULK_MAINTENANCE_DATE_FILL_UNIT_TEST_UPDATES.md`

---

## Summary
These enhancements will provide users with clear feedback, prevent invalid operations, and offer fine-grained control over which maintenance events are updated for each task during bulk date fills.