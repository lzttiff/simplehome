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
Split the modal into clear sections:
- Provider selector (Google / Apple buttons)
- Scope selector (task selection)
- Provider panel with export option cards
- Export tracking section (below fold)
- Footer help text

### Provider Selector
Two buttons at the top: Google and Apple.
User chooses which provider to use. Only one provider is active at a time.

### Scope Selector
Move task selection into a dedicated section with:
- selected count summary
- select all / clear all control
- optional search or filter controls
- collapsible minor/major inclusion details

The scope section should be reusable for both Google and Apple direct sync.

### Provider Panel
Render only the selected provider's panel with card-based options:
- **Keep In Sync Card** (Two-Way): Connection status, sync controls, and disconnect option. Variant: warning (amber background).
- **Subscribe Card** (One-Way): Feed URL generation and sharing. Variant: default (gray background).
- **Download File Card**: ICS export button. Variant: default (gray background).

Each card includes:
- Icon (emoji or small visual indicator)
- Title (clear intent name)
- Description (one-line explanation)
- Self-contained controls and status display
- Action buttons appropriate to that export mode

This design makes each option visually distinct and easy to understand at a glance.

## Recommended Layout Behavior
1. Show the provider selector (Google/Apple) at the top.
2. Show the scope picker below provider selector (always visible).
3. Show only the selected provider's panel with three cards:
   - Keep In Sync (Two-Way) - shows connection status and sync actions
   - Subscribe (One-Way) - shows feed URL controls
   - Download File - shows ICS export button
4. Each card is visually distinct with an icon, title, description, and self-contained controls.
5. Show export tracking section below the fold.
6. Keep help text at the bottom.

## Apple Two-Way Sync Constraints for the Redesign
The redesign must make room for Apple two-way sync even before the backend is finished.

Requirements:
- Apple connect form needs clear entry points for Apple ID email and app-specific password.
- Apple sync status should be displayed in the same visual language as Google status.
- Apple scope editing should reuse the same selection model as Google where possible.
- Apple disconnect should be a separate destructive action, not mixed into the primary sync flow.
- Subscription and file export paths must remain available as fallback modes.

## Implementation Sequence
### Step 1: Restructure the modal shell ✅
- Extract the current modal into smaller UI sections.
- Keep data fetching and mutations unchanged.
- Preserve current behavior while changing layout only.
- **Completed**: ExportScopePicker, GoogleExportPanel, AppleExportPanel, ExportTrackingSection, ExportFooterHelp

### Step 2: Introduce intent-based sections ✅
- Add a provider selector (Google/Apple) at top of modal.
- Organize each provider's options as distinct cards (one-way vs two-way sync, file export).
- Each card is self-contained with its own controls and status.
- Move instructions and secondary actions inside cards (not floating).
- Reduce the amount of always-visible text by using card structure.
- **Completed**: ExportCard component, card-based layout for both Google and Apple panels

### Step 3: Standardize scope handling
- Reuse the current task selection state.
- Make the selection summary persistent.
- Prepare the scope section for Apple direct sync.

### Step 4: Add Apple sync hooks later
- Add Apple-specific panel placeholders if the backend is not ready yet.
- Keep the layout stable so Apple sync can be plugged in without another redesign.

## Suggested Component Breakdown
Current implementation:
- ExportScheduleModal (main shell)
- ExportScopePicker (task selection, always visible)
- ExportCard (reusable card component for each export option)
- GoogleExportPanel (three cards: two-way sync, one-way subscription, file download)
- AppleExportPanel (three cards: two-way sync placeholder, one-way subscription, file download)
- ExportTrackingSection (export history and clear controls)
- ExportFooterHelp (reference text)

Each panel uses the ExportCard component for consistent visual hierarchy and organization.

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
