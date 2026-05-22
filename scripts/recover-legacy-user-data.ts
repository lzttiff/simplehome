import { randomUUID } from "crypto";
import { MongoClient } from "mongodb";
import { getMongoDbNameForScript, getMongoUrlForScript } from "./envConfig";

type Flags = {
  email: string;
  dryRun: boolean;
  force: boolean;
};

function parseArgs(argv: string[]): Flags {
  const getValue = (name: string): string | null => {
    const prefix = `${name}=`;
    const match = argv.find((arg) => arg.startsWith(prefix));
    return match ? match.slice(prefix.length) : null;
  };

  const email = getValue("--email");
  if (!email) {
    throw new Error("Missing required flag: --email=<user-email>");
  }

  return {
    email,
    dryRun: argv.includes("--dry-run"),
    force: argv.includes("--force"),
  };
}

async function main() {
  const { email, dryRun, force } = parseArgs(process.argv.slice(2));

  const mongoUrl = getMongoUrlForScript("script-recover-legacy-user-data");
  const dbName = getMongoDbNameForScript();

  const client = new MongoClient(mongoUrl);
  await client.connect();

  try {
    const db = client.db(dbName);
    const users = db.collection("users");
    const templates = db.collection("property_templates");
    const tasks = db.collection("maintenance_tasks");

    const user = await users.findOne({ email });
    if (!user || typeof user.id !== "string") {
      throw new Error(`User not found for email: ${email}`);
    }
    const userId = user.id as string;

    const existingTemplateCount = await templates.countDocuments({ userId });
    const existingTaskCount = await tasks.countDocuments({ userId });

    if (!force && existingTemplateCount > 0) {
      throw new Error(
        `Target user already has templates=${existingTemplateCount}. ` +
          "Use --force only if you intentionally want to copy legacy data anyway."
      );
    }

    const legacyTemplateQuery = {
      $or: [{ userId: null }, { userId: { $exists: false } }],
    };
    const legacyTemplates = await templates.find(legacyTemplateQuery).toArray();

    const legacyTemplateIds = legacyTemplates
      .map((doc) => (typeof doc.id === "string" ? doc.id : null))
      .filter((id): id is string => !!id);

    const legacyTaskQuery = {
      $and: [
        { $or: [{ userId: null }, { userId: { $exists: false } }] },
        {
          $or: [
            { templateId: { $in: legacyTemplateIds } },
            { templateId: null },
            { templateId: { $exists: false } },
          ],
        },
      ],
    };
    const legacyTasks = await tasks.find(legacyTaskQuery).toArray();

    console.log(`[recover-legacy-user-data] user=${email} userId=${userId}`);
    console.log(`[recover-legacy-user-data] Found legacy templates=${legacyTemplates.length}, tasks=${legacyTasks.length}`);

    if (legacyTemplates.length === 0 && legacyTasks.length === 0) {
      console.log("[recover-legacy-user-data] No legacy data found. Nothing to recover.");
      return;
    }

    const existingUserTemplates = await templates
      .find({ userId }, { projection: { id: 1, type: 1 } })
      .toArray();
    const existingTemplateByType = new Map<string, string>();
    for (const tpl of existingUserTemplates) {
      if (typeof tpl.type === "string" && typeof tpl.id === "string") {
        existingTemplateByType.set(tpl.type, tpl.id);
      }
    }

    const templateIdMap = new Map<string, string>();
    const templateInserts: Record<string, unknown>[] = [];
    let skippedTemplateCount = 0;

    for (const src of legacyTemplates) {
      const { _id: _templateId, ...rest } = src;
      const oldTemplateId = typeof src.id === "string" ? src.id : null;
      const type = typeof src.type === "string" ? src.type : null;

      if (oldTemplateId && type && existingTemplateByType.has(type)) {
        templateIdMap.set(oldTemplateId, existingTemplateByType.get(type)!);
        skippedTemplateCount += 1;
        continue;
      }

      const newTemplateId = randomUUID();
      if (oldTemplateId) templateIdMap.set(oldTemplateId, newTemplateId);
      if (type) existingTemplateByType.set(type, newTemplateId);

      templateInserts.push({
        ...rest,
        id: newTemplateId,
        userId,
        createdAt: src.createdAt ?? new Date(),
      });
    }

    const existingUserTasks = await tasks
      .find({ userId }, { projection: { title: 1, category: 1, templateId: 1 } })
      .toArray();
    const existingTaskSignatures = new Set(
      existingUserTasks.map((t) => `${String(t.templateId ?? "null")}::${String(t.title ?? "")}::${String(t.category ?? "")}`)
    );

    const taskInserts: Record<string, unknown>[] = [];
    let skippedTaskCount = 0;

    for (const src of legacyTasks) {
      const { _id: _taskId, ...rest } = src;
      const oldTemplateId = typeof src.templateId === "string" ? src.templateId : null;
      const mappedTemplateId = oldTemplateId && templateIdMap.has(oldTemplateId)
        ? templateIdMap.get(oldTemplateId)
        : (src.templateId ?? null);
      const signature = `${String(mappedTemplateId ?? "null")}::${String(src.title ?? "")}::${String(src.category ?? "")}`;

      if (existingTaskSignatures.has(signature)) {
        skippedTaskCount += 1;
        continue;
      }

      existingTaskSignatures.add(signature);
      taskInserts.push({
        ...rest,
        id: randomUUID(),
        userId,
        templateId: mappedTemplateId,
        createdAt: src.createdAt ?? new Date(),
        updatedAt: new Date(),
      });
    }

    console.log(
      `[recover-legacy-user-data] ${dryRun ? "Would insert" : "Inserting"} templates=${templateInserts.length}, tasks=${taskInserts.length}`
    );
    console.log(`[recover-legacy-user-data] Skipped existing templates=${skippedTemplateCount}, tasks=${skippedTaskCount}`);

    if (!dryRun) {
      if (templateInserts.length > 0) {
        await templates.insertMany(templateInserts);
      }
      if (taskInserts.length > 0) {
        await tasks.insertMany(taskInserts);
      }
      console.log("[recover-legacy-user-data] Recovery complete.");
    } else {
      console.log("[recover-legacy-user-data] Dry run complete. No changes applied.");
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("[recover-legacy-user-data] Failed:", error?.message || error);
  process.exit(1);
});
