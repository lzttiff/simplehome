import { isDeepStrictEqual } from "node:util";
import { MongoClient } from "mongodb";
import {
  userCalendarFeatureTogglesSchema,
  type UserCalendarFeatureToggles,
} from "../shared/schema";
import { getMongoDbNameForScript, getMongoUrlForScript } from "./envConfig";

type Flags = {
  dryRun: boolean;
  apply: boolean;
  sampleLimit: number;
};

type UserDoc = {
  id?: unknown;
  calendarFeatureToggles?: unknown;
};

function parseArgs(argv: string[]): Flags {
  const sampleLimitIndex = argv.indexOf("--sample-limit");
  const rawSampleLimit = sampleLimitIndex >= 0 ? argv[sampleLimitIndex + 1] : "10";
  const sampleLimit = Number.isFinite(Number(rawSampleLimit))
    ? Math.max(0, Math.floor(Number(rawSampleLimit)))
    : 10;

  return {
    dryRun: argv.includes("--dry-run") || !argv.includes("--apply"),
    apply: argv.includes("--apply"),
    sampleLimit,
  };
}

function normalizeCalendarFeatureToggles(raw: unknown): {
  normalized: UserCalendarFeatureToggles;
  source: "defaults" | "normalized" | "unchanged" | "invalid-reset";
} {
  const parsed = userCalendarFeatureTogglesSchema.safeParse(raw ?? {});

  if (!parsed.success) {
    return {
      normalized: userCalendarFeatureTogglesSchema.parse({}),
      source: "invalid-reset",
    };
  }

  const normalized = parsed.data;

  if (raw === undefined || raw === null) {
    return {
      normalized,
      source: "defaults",
    };
  }

  if (isDeepStrictEqual(raw, normalized)) {
    return {
      normalized,
      source: "unchanged",
    };
  }

  return {
    normalized,
    source: "normalized",
  };
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const execute = flags.apply && !flags.dryRun;

  const mongoUrl = getMongoUrlForScript("script-migrate-user-calendar-feature-toggles");
  const dbName = getMongoDbNameForScript();

  const client = new MongoClient(mongoUrl);
  await client.connect();

  try {
    const db = client.db(dbName);
    const users = db.collection("users");

    const docs = (await users
      .find({}, { projection: { id: 1, calendarFeatureToggles: 1 } })
      .toArray()) as UserDoc[];

    if (docs.length === 0) {
      console.log("[migrate-user-calendar-feature-toggles] No users found. Nothing to migrate.");
      return;
    }

    let scanned = 0;
    let updatedUsers = 0;
    let skippedInvalidUsers = 0;
    let defaultsInitialized = 0;
    let normalizedExisting = 0;
    let invalidReset = 0;

    const sampleUpdatedUserIds: string[] = [];

    for (const doc of docs) {
      scanned += 1;

      if (typeof doc.id !== "string" || doc.id.trim().length === 0) {
        skippedInvalidUsers += 1;
        continue;
      }

      const userId = doc.id;
      const { normalized, source } = normalizeCalendarFeatureToggles(doc.calendarFeatureToggles);

      if (source === "unchanged") {
        continue;
      }

      if (source === "defaults") {
        defaultsInitialized += 1;
      } else if (source === "normalized") {
        normalizedExisting += 1;
      } else if (source === "invalid-reset") {
        invalidReset += 1;
      }

      if (execute) {
        await users.updateOne({ id: userId }, { $set: { calendarFeatureToggles: normalized } });
      }

      updatedUsers += 1;
      if (sampleUpdatedUserIds.length < flags.sampleLimit) {
        sampleUpdatedUserIds.push(userId);
      }
    }

    console.log(`[migrate-user-calendar-feature-toggles] mode=${execute ? "apply" : "dry-run"}`);
    console.log(`[migrate-user-calendar-feature-toggles] scanned=${scanned} skippedInvalidUsers=${skippedInvalidUsers}`);
    console.log(`[migrate-user-calendar-feature-toggles] usersWithUpdates=${updatedUsers}`);
    console.log(
      `[migrate-user-calendar-feature-toggles] updateBreakdown defaultsInitialized=${defaultsInitialized} normalizedExisting=${normalizedExisting} invalidReset=${invalidReset}`,
    );

    if (sampleUpdatedUserIds.length > 0) {
      console.log(
        `[migrate-user-calendar-feature-toggles] sampleUpdatedUserIds=${sampleUpdatedUserIds.join(",")}`,
      );
    }

    if (!execute) {
      console.log("[migrate-user-calendar-feature-toggles] Dry run complete. Re-run with --apply to execute updates.");
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("[migrate-user-calendar-feature-toggles] Failed:", error?.message || error);
  process.exit(1);
});
