import { randomUUID } from "crypto";
import { MongoClient } from "mongodb";
import { getMongoDbNameForScript, getMongoUrlForScript } from "./envConfig";

type Flags = {
  dryRun: boolean;
  apply: boolean;
  deleteLegacy: boolean;
};

function parseArgs(argv: string[]): Flags {
  return {
    dryRun: argv.includes("--dry-run"),
    apply: argv.includes("--apply"),
    deleteLegacy: argv.includes("--delete-legacy"),
  };
}

function taskSignature(templateId: string | null, title: unknown, category: unknown): string {
  return `${templateId ?? "null"}::${String(title ?? "")}::${String(category ?? "")}`;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const execute = flags.apply && !flags.dryRun;

  const mongoUrl = getMongoUrlForScript("script-migrate-legacy-user-data-all");
  const dbName = getMongoDbNameForScript();

  const client = new MongoClient(mongoUrl);
  await client.connect();

  try {
    const db = client.db(dbName);
    const users = db.collection("users");
    const templates = db.collection("property_templates");
    const tasks = db.collection("maintenance_tasks");

    const legacyQuery = { $or: [{ userId: null }, { userId: { $exists: false } }] };

    const [userDocs, legacyTemplates, legacyTasks] = await Promise.all([
      users.find({}, { projection: { id: 1, email: 1 } }).toArray(),
      templates.find(legacyQuery).toArray(),
      tasks.find(legacyQuery).toArray(),
    ]);

    if (userDocs.length === 0) {
      console.log("[migrate-legacy-all] No users found. Nothing to do.");
      return;
    }

    const legacyTemplateByType = new Map<string, any>();
    for (const tpl of legacyTemplates) {
      if (typeof tpl.type === "string" && !legacyTemplateByType.has(tpl.type)) {
        legacyTemplateByType.set(tpl.type, tpl);
      }
    }

    const legacyTemplateIds = new Set(
      legacyTemplates
        .map((t) => (typeof t.id === "string" ? t.id : null))
        .filter((id): id is string => !!id),
    );

    const legacyTasksByTemplateId = new Map<string, any[]>();
    for (const task of legacyTasks) {
      const templateId = typeof task.templateId === "string" ? task.templateId : null;
      if (!templateId) continue;
      if (!legacyTasksByTemplateId.has(templateId)) {
        legacyTasksByTemplateId.set(templateId, []);
      }
      legacyTasksByTemplateId.get(templateId)!.push(task);
    }

    let templatesInserted = 0;
    let tasksInserted = 0;

    for (const user of userDocs) {
      if (typeof user.id !== "string") continue;
      const userId = user.id;
      const userLabel = typeof user.email === "string" ? user.email : userId;

      const existingTemplates = await templates
        .find({ userId }, { projection: { id: 1, type: 1 } })
        .toArray();

      const existingTemplateByType = new Map<string, string>();
      for (const tpl of existingTemplates) {
        if (typeof tpl.type === "string" && typeof tpl.id === "string") {
          existingTemplateByType.set(tpl.type, tpl.id);
        }
      }

      const existingTasks = await tasks
        .find({ userId }, { projection: { templateId: 1, title: 1, category: 1 } })
        .toArray();
      const existingSignatures = new Set(
        existingTasks.map((t) => taskSignature(typeof t.templateId === "string" ? t.templateId : null, t.title, t.category)),
      );

      for (const [type, legacyTemplate] of legacyTemplateByType.entries()) {
        const legacyTemplateId = typeof legacyTemplate.id === "string" ? legacyTemplate.id : null;
        if (!legacyTemplateId) continue;

        let targetTemplateId = existingTemplateByType.get(type) || null;

        if (!targetTemplateId) {
          targetTemplateId = randomUUID();
          if (execute) {
            const { _id: _ignoredTemplateId, ...templateRest } = legacyTemplate;
            await templates.insertOne({
              ...templateRest,
              id: targetTemplateId,
              userId,
              createdAt: legacyTemplate.createdAt ?? new Date(),
            });
          }
          existingTemplateByType.set(type, targetTemplateId);
          templatesInserted += 1;
        }

        const sourceTasks = legacyTasksByTemplateId.get(legacyTemplateId) || [];
        for (const sourceTask of sourceTasks) {
          const sig = taskSignature(targetTemplateId, sourceTask.title, sourceTask.category);
          if (existingSignatures.has(sig)) {
            continue;
          }

          if (execute) {
            const { _id: _ignoredTaskId, ...taskRest } = sourceTask;
            await tasks.insertOne({
              ...taskRest,
              id: randomUUID(),
              userId,
              templateId: targetTemplateId,
              createdAt: sourceTask.createdAt ?? new Date(),
              updatedAt: new Date(),
            });
          }

          existingSignatures.add(sig);
          tasksInserted += 1;
        }
      }

      console.log(`[migrate-legacy-all] user=${userLabel} templatesNow=${existingTemplateByType.size}`);
    }

    let legacyTemplatesDeleted = 0;
    let legacyTasksDeleted = 0;

    if (execute && flags.deleteLegacy) {
      const deleteLegacyTasksResult = await tasks.deleteMany(legacyQuery);
      const deleteLegacyTemplatesResult = await templates.deleteMany(legacyQuery);
      legacyTasksDeleted = deleteLegacyTasksResult.deletedCount;
      legacyTemplatesDeleted = deleteLegacyTemplatesResult.deletedCount;
    }

    console.log(`[migrate-legacy-all] mode=${execute ? "apply" : "dry-run"}`);
    console.log(`[migrate-legacy-all] templatesInserted=${templatesInserted} tasksInserted=${tasksInserted}`);
    if (flags.deleteLegacy) {
      console.log(
        `[migrate-legacy-all] legacyDeleted templates=${legacyTemplatesDeleted} tasks=${legacyTasksDeleted}`,
      );
    }

    if (!execute) {
      console.log("[migrate-legacy-all] Dry run complete. Use --apply to execute changes.");
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("[migrate-legacy-all] Failed:", error?.message || error);
  process.exit(1);
});
