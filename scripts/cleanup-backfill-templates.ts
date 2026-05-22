/**
 * One-time cleanup script for users who were affected by the erroneous Step 4 backfill.
 *
 * Background:
 *   The first deployment of the Step 4 backfill created user-scoped property templates (and
 *   their default tasks) for existing users who already had their own tasks but no user-scoped
 *   templates.  This script reverses that by:
 *     1. Identifying "old" users: those who have tasks with templateId = null (pre-existing data).
 *     2. For each such user, deleting user-scoped templates of the 4 default types + all tasks
 *        that were linked to those templates.
 *
 * Usage:
 *   npx tsx scripts/cleanup-backfill-templates.ts
 *
 * Set MONGODB_URL (preferred) / DATABASE_URL (legacy fallback) and MONGODB_DB_NAME env vars as needed (same as the app).
 * Run with --dry-run to preview what would be deleted without making changes.
 */

import { MongoClient } from "mongodb";
import { getMongoDbNameForScript, getMongoUrlForScript } from "./envConfig";

const BACKFILL_TYPES = ["single_family", "townhouse", "condo", "commercial"] as const;

const mongoUrl = getMongoUrlForScript("script-cleanup-backfill-templates");
const dbName = getMongoDbNameForScript();
const dryRun = process.argv.includes("--dry-run");

async function main() {
  if (dryRun) {
    console.log("[DRY RUN] No changes will be written.\n");
  }

  const client = new MongoClient(mongoUrl);
  await client.connect();
  const db = client.db(dbName);
  const users = db.collection("users");
  const templates = db.collection("property_templates");
  const tasks = db.collection("maintenance_tasks");

  try {
    const allUsers = await users.find({}, { projection: { id: 1, email: 1 } }).toArray();
    console.log(`Found ${allUsers.length} users.`);

    let totalTemplatesDeleted = 0;
    let totalTasksDeleted = 0;

    for (const user of allUsers) {
      const userId: string = user.id;
      if (!userId) continue;

      // Identify old users: those with tasks that pre-date the backfill (templateId is null)
      const preExistingTaskCount = await tasks.countDocuments({ userId, templateId: null });
      if (preExistingTaskCount === 0) {
        console.log(`  [${user.email ?? userId}] No pre-existing tasks – skipping.`);
        continue;
      }

      // Find the user-scoped templates that the backfill created
      const backfilledTemplates = await templates
        .find({ userId, type: { $in: [...BACKFILL_TYPES] } })
        .toArray();

      if (backfilledTemplates.length === 0) {
        console.log(`  [${user.email ?? userId}] No backfill templates found – nothing to do.`);
        continue;
      }

      const backfilledTemplateIds = backfilledTemplates.map((t) => t.id as string);

      // Count tasks that would be removed
      const linkedTaskCount = await tasks.countDocuments({
        userId,
        templateId: { $in: backfilledTemplateIds },
      });

      console.log(
        `  [${user.email ?? userId}] Removing ${backfilledTemplates.length} templates` +
          ` (${backfilledTemplateIds.join(", ")}) and ${linkedTaskCount} linked tasks.`,
      );

      if (!dryRun) {
        await tasks.deleteMany({ userId, templateId: { $in: backfilledTemplateIds } });
        await templates.deleteMany({ userId, type: { $in: [...BACKFILL_TYPES] } });
      }

      totalTemplatesDeleted += backfilledTemplates.length;
      totalTasksDeleted += linkedTaskCount;
    }

    console.log(
      `\nDone. ${dryRun ? "Would have deleted" : "Deleted"} ${totalTemplatesDeleted} templates` +
        ` and ${totalTasksDeleted} tasks.`,
    );
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
