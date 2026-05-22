import { MongoClient } from "mongodb";
import { getMongoDbNameForScript, getMongoUrlForScript } from "./envConfig";

type LegacyCounts = {
  templates: number;
  tasks: number;
  responses: number;
  total: number;
};

function formatFailureMessage(counts: LegacyCounts): string {
  return [
    "[guard:legacy-userid] FAILED",
    "Legacy records without user ownership were detected.",
    `templates: ${counts.templates}`,
    `tasks: ${counts.tasks}`,
    `questionnaire_responses: ${counts.responses}`,
    `total: ${counts.total}`,
    "",
    "Why this fails:",
    "Strict user scoping is enabled. Legacy records become invisible to users and can look like data loss after deploy.",
    "",
    "Required action before strict rollout:",
    "1) Run migration/recovery script(s) to assign userId ownership.",
    "2) Re-run this guard until total is 0.",
    "3) Only then deploy strict user-scoped reads.",
  ].join("\n");
}

async function main() {
  const mongoUrl = getMongoUrlForScript("script-check-legacy-userid-data");
  const dbName = getMongoDbNameForScript();

  const client = new MongoClient(mongoUrl);
  await client.connect();

  try {
    const db = client.db(dbName);

    const legacyQuery = { $or: [{ userId: null }, { userId: { $exists: false } }] };

    const [templates, tasks, responses] = await Promise.all([
      db.collection("property_templates").countDocuments(legacyQuery),
      db.collection("maintenance_tasks").countDocuments(legacyQuery),
      db.collection("questionnaire_responses").countDocuments(legacyQuery),
    ]);

    const counts: LegacyCounts = {
      templates,
      tasks,
      responses,
      total: templates + tasks + responses,
    };

    if (counts.total > 0) {
      console.error(formatFailureMessage(counts));
      process.exit(1);
    }

    console.log("[guard:legacy-userid] PASS - No legacy records without userId ownership.");
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("[guard:legacy-userid] ERROR", error?.message || error);
  process.exit(1);
});
