# Export Schedule Redesign With Apple Two-Way Sync

## Purpose
Redesign the Export Schedule experience before adding Apple two-way sync so the modal is easier to scan, easier to extend, and already organized around the Apple sync workflow.

This document is the UX and implementation sequencing guide for the redesign-first path.

## Problem Statement
The current Export Schedule modal combines too many workflows in one vertical stack:
- Google two-way sync connection and scope management
- Apple and Google subscription feeds
- ICS file export
- Task selection and export tracking

That makes the modal feel crowded and makes it harder to add Apple two-way sync without making the layout worse.

## Design Principles
1. Organize by user intent, not by provider.
2. Use progressive disclosure so advanced actions stay hidden until needed.
3. Keep one primary action visible per workflow.
4. Preserve existing Google behavior while making space for Apple parity.
5. Avoid mixing setup, scope selection, and execution in the same visual block.

## Proposed Information Architecture
### Top Level
Split the modal into four clear areas:
- Goal selector
- Scope selector
- Provider panel
- Summary / confirmation area

### Goal Selector
Present the user with three outcome-based options:
- Keep in sync
- Subscribe to updates
- Download a file

These are the main intents. Provider-specific details should come later.

### Scope Selector
Move task selection into a dedicated section with:
- selected count summary
- select all / clear all control
- optional search or filter controls
- collapsible minor/major inclusion details

The scope section should be reusable for both Google and Apple direct sync.

### Provider Panel
Render only the panel that matches the chosen provider and mode:
- Google one-way export options, including file export / ICS download
- Google two-way sync options
- Apple one-way export options, including file export / ICS download
- Apple two-way sync options

Each provider panel should contain its own narrowed actions once the user chooses a mode. The user should not need to choose both providers.

### Summary / Confirmation Area
Use a small confirmation strip or footer inside the active provider panel for the final action:
- Sync now
- Create feed
- Download file / ICS
- Disconnect

This area should be visually subordinate to the provider panel, not a separate always-visible footer.

## Recommended Layout Behavior
1. Show the goal selector first.
2. Reveal only the relevant provider panel after selection.
3. Keep task scope visible while the provider panel changes.
4. Collapse helper text, diagnostics, and legacy notes by default.
5. Keep the export history / tracking area below the fold or behind a disclosure control.

## Apple Two-Way Sync Constraints for the Redesign
The redesign must make room for Apple two-way sync even before the backend is finished.

Requirements:
- Apple connect form needs clear entry points for Apple ID email and app-specific password.
- Apple sync status should be displayed in the same visual language as Google status.
- Apple scope editing should reuse the same selection model as Google where possible.
- Apple disconnect should be a separate destructive action, not mixed into the primary sync flow.
- Subscription and file export paths must remain available as fallback modes.

## Implementation Sequence
### Step 1: Restructure the modal shell
- Extract the current modal into smaller UI sections.
- Keep data fetching and mutations unchanged.
- Preserve current behavior while changing layout only.

### Step 2: Introduce intent-based sections
- Add a goal selector at the top.
- Move instructions and secondary actions behind panels.
- Reduce the amount of always-visible text.

### Step 3: Standardize scope handling
- Reuse the current task selection state.
- Make the selection summary persistent.
- Prepare the scope section for Apple direct sync.

### Step 4: Add Apple sync hooks later
- Add Apple-specific panel placeholders if the backend is not ready yet.
- Keep the layout stable so Apple sync can be plugged in without another redesign.

## Suggested Component Breakdown
Break the current modal into smaller parts:
- ExportGoalSelector
- ExportScopePicker
- GoogleSyncPanel
- AppleSyncPanel
- SubscriptionPanel
- FileExportPanel
- ExportActionFooter

## Rollout Plan
1. Ship the redesign with existing Google and Apple one-way flows intact.
2. Validate the new layout with current users.
3. Add Apple two-way sync into the reserved Apple sync panel.
4. Revisit any copy or spacing problems after Apple sync lands.

## Acceptance Criteria
- The modal reads as a set of intentional workflows instead of one long stack.
- Google behavior remains unchanged.
- Apple subscription and file exports remain available.
- The layout already has a clear place for Apple two-way sync controls.
- The design reduces visual density without removing functionality.

## Related Files
- [client/src/components/export-schedule-modal.tsx](../client/src/components/export-schedule-modal.tsx)
- [docs/APPLE_CALENDAR_TWO_WAY_SYNC_PLAN.md](APPLE_CALENDAR_TWO_WAY_SYNC_PLAN.md)
- [docs/CALENDAR_EXPORT.md](CALENDAR_EXPORT.md)
