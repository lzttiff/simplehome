-- Migration: Add calendar_exports column to maintenance_tasks table
-- This column stores JSON data tracking calendar exports for each task
-- Format: [{provider: 'google'|'apple', eventIds: {minor?: string, major?: string}, eventLinks?: {minor?: string, major?: string}, lastSyncedAt: date}]

ALTER TABLE maintenance_tasks ADD COLUMN IF NOT EXISTS calendar_exports TEXT;

-- Add a comment for documentation
COMMENT ON COLUMN maintenance_tasks.calendar_exports IS 'JSON array tracking calendar exports: [{provider, eventIds, eventLinks, lastSyncedAt}]';
