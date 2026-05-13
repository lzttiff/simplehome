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

That makes the modal feel crowded and makes it harder to add Apple two-way sync without making the layout worse. Additionally, the card-based design (Steps 1-3) increased vertical height, causing content overflow beyond typical window bounds, especially when Google sync status information is present.

## Design Principles
1. Organize by user intent, not by provider.
2. Use progressive disclosure so advanced actions stay hidden until needed.
3. Keep one primary action visible per workflow.
4. Preserve existing Google behavior while making space for Apple parity.
5. Avoid mixing setup, scope selection, and execution in the same visual block.

## Proposed Information Architecture
### Tab-Based Organization
To manage visual density and organize workflows cleanly, the modal uses a tab-based layout with four tabs:

**Tab 1: "Select Items"**
- Scope picker (checkboxes for task selection)
- Select All / Clear All controls
- Selection summary (count + task list)
- Purpose: Choose which maintenance items to export

**Tab 2: "Export Options"**
- Provider selector (Google / Apple buttons)
- Provider panel with three export cards:
  - **Keep In Sync Card** (Two-Way): Connection status, sync controls, disconnect option. Variant: warning (amber background).
  - **Subscribe Card** (One-Way): Feed URL generation and sharing. Variant: default (gray background).
  - **Download File Card**: ICS export button. Variant: default (gray background).
- Purpose: Choose how to export the selected items

**Tab 3: "History"**
- Export tracking section showing past exports per task
- Clear all exports control
- Purpose: Review and manage export history

**Tab 4: "Help"**
- Footer help text with instructions for each provider
- Configuration requirements and tips
- Purpose: Self-service reference documentation

### Benefits of Tab-Based Design
- **Reduced vertical overflow**: Each tab stays compact within typical window bounds
- **Progressive disclosure**: Users only see the tab they need
- **Clear workflow**: Select → Export → Review → Learn
- **Scalable for Apple sync**: Apple two-way sync backend can extend Tab 2 without crowding other tabs
- **Information hierarchy**: Related controls grouped logically

## Recommended Layout Behavior
1. **Modal Size**: Wider dialog (`max-w-2xl` or `max-w-3xl`) with scrollable content area to accommodate tabs and content.
2. **Tab Bar**: Four tabs at the top: "Select Items", "Export Options", "History", "Help".
3. **Tab: Select Items**
   - Always starts in this tab on modal open
   - Shows scope picker with select all / clear all controls
   - Shows selection summary (blue background) with selected count and task list
4. **Tab: Export Options**
   - Shows provider selector buttons (Google / Apple)
   - Shows provider panel with three cards:
     - Keep In Sync (Two-Way) with status and sync controls
     - Subscribe (One-Way) with feed URL controls
     - Download File with ICS export button
   - Each card has icon, title, description, and self-contained controls
5. **Tab: History**
   - Shows export tracking section with past exports
   - Clear all exports control
6. **Tab: Help**
   - Shows footer help text
   - Configuration tips and instructions

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
- **Completed**: 
  - ExportCard component with variants (default, warning, success, error)
  - GoogleExportPanel refactored: Keep In Sync (warning), Subscribe (default), Download File (default)
  - AppleExportPanel refactored: Keep In Sync (warning, placeholder), Subscribe (default), Download File (default)
  - All export functionality consolidated into intuitive cards with unified styling

### Step 3: Standardize scope handling ✅
- Reuse the current task selection state (already implemented via `buildSelections()`)
- Create SelectionSummary component showing selected task count and names
- Place SelectionSummary below ExportScopePicker for persistent visibility across provider switches
- Reduce redundancy by consolidating selection feedback
- **Completed**:
  - SelectionSummary component displays selected count and task list
  - Positioned below ExportScopePicker, visible for both Google and Apple providers
  - Selection state unified and reused across both providers
  - Blue styling differentiates selection summary from task picker

### Step 4: Organize into tabs for visual density
- Convert modal layout from single-page stack to tab-based organization
- Create four tabs: "Select Items", "Export Options", "History", "Help"
- Move ExportScopePicker and SelectionSummary to "Select Items" tab
- Move GoogleExportPanel and AppleExportPanel to "Export Options" tab
- Move ExportTrackingSection to "History" tab
- Move ExportFooterHelp to "Help" tab
- Increase modal width to accommodate tab bar and content comfortably
- **In Progress**:
  - Tab component integration
  - Content reorganization across tabs
  - Styling and spacing adjustments

### Step 5: Add Apple sync hooks
- Add Apple-specific panel placeholders if the backend is not ready yet.
- Keep the layout stable so Apple sync can be plugged in without another redesign.

## Suggested Component Breakdown
Current implementation (Pre-Tab):
- ExportScheduleModal (main shell)
- ExportScopePicker (task selection)
- SelectionSummary (persistent selection feedback)
- ExportCard (reusable card component for each export option)
- GoogleExportPanel (three cards: two-way sync, one-way subscription, file download)
- AppleExportPanel (three cards: two-way sync placeholder, one-way subscription, file download)
- ExportTrackingSection (export history and clear controls)
- ExportFooterHelp (reference text)

Post-Tab Implementation (Step 4):
- ExportScheduleModal (main shell with tab bar)
- ExportTabBar (navigation component)
- SelectItemsTab (contains ExportScopePicker + SelectionSummary)
- ExportOptionsTab (contains provider selector + GoogleExportPanel + AppleExportPanel)
- HistoryTab (contains ExportTrackingSection)
- HelpTab (contains ExportFooterHelp)
- ExportCard, GoogleExportPanel, AppleExportPanel (reused, no changes)

Each tab contains logically grouped content for a specific workflow step.

## Rollout Plan
1. Ship the redesign with existing Google and Apple one-way flows intact.
2. Validate the new layout with current users.
3. Add Apple two-way sync into the reserved Apple sync panel.
4. Revisit any copy or spacing problems after Apple sync lands.

## Acceptance Criteria
- The modal uses tab-based organization to manage visual density.
- "Select Items" tab contains scope picker and selection summary.
- "Export Options" tab contains provider selector and export cards.
- "History" tab contains export tracking.
- "Help" tab contains reference documentation.
- The modal is wide enough to accommodate all content comfortably (no horizontal overflow).
- Google behavior remains unchanged.
- Apple subscription and file exports remain available.
- The layout already has a clear place for Apple two-way sync controls.
- Each tab stays compact within typical window bounds (no excessive vertical overflow).

## Related Files
- [client/src/components/export-schedule-modal.tsx](../client/src/components/export-schedule-modal.tsx)
- [docs/APPLE_CALENDAR_TWO_WAY_SYNC_PLAN.md](APPLE_CALENDAR_TWO_WAY_SYNC_PLAN.md)
- [docs/CALENDAR_EXPORT.md](CALENDAR_EXPORT.md)
