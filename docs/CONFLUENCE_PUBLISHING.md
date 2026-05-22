# Confluence Publishing (Docs Since 2026-04-30)

This project includes a script that publishes all docs changed in `docs/` since a target date.

## Script

- Path: `scripts/publish-confluence-docs.mjs`
- Behavior:
  - Finds files changed in git since `CONFLUENCE_SINCE_DATE` (default `2026-04-30`)
  - Converts Markdown to Confluence storage HTML
  - Upserts pages in Confluence by page title (create if missing, update if exists)

## Required Environment Variables

- `CONFLUENCE_EMAIL`: Atlassian account email
- `CONFLUENCE_API_TOKEN`: Atlassian API token
- `CONFLUENCE_SPACE_KEY`: Confluence space key

## Optional Environment Variables

- `CONFLUENCE_BASE_URL`: default `https://tiffanyjiang.atlassian.net/wiki`
- `CONFLUENCE_PARENT_PAGE_ID`: parent page id to nest created pages
- `CONFLUENCE_SINCE_DATE`: default `2026-04-30`

## Usage

Dry run (recommended first):

```bash
node scripts/publish-confluence-docs.mjs --dry-run
```

Publish:

```bash
CONFLUENCE_EMAIL="you@example.com" \
CONFLUENCE_API_TOKEN="your_token" \
CONFLUENCE_SPACE_KEY="YOURSPACE" \
CONFLUENCE_PARENT_PAGE_ID="123456" \
node scripts/publish-confluence-docs.mjs
```

## Docs Currently Detected Since 2026-04-30

- `docs/APPLE_CALENDAR_TWO_WAY_SYNC_PLAN.md`
- `docs/DEFAULT_TEMPLATE_INITIALIZATION.md`
- `docs/user-management/USER_MANAGEMENT_BULK_DATE_COMPLETION_SUMMARY.md`
- `docs/user-management/USER_MANAGEMENT_BULK_DATE_ROLLOUT_PROCEDURES.md`
- `docs/USER_DATA_MIGRATION_AND_STRICT_SCOPING_RUNBOOK.md`
- `docs/user-management/USER_MANAGEMENT_AND_BULK_DATE_PLAN.md`
