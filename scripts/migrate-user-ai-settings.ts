import { MongoClient } from "mongodb";
import { getMongoDbNameForScript, getMongoUrlForScript } from "./envConfig";

type Flags = {
  dryRun: boolean;
  apply: boolean;
  optInUserIds: Set<string>;
  optInEmails: Set<string>;
  policyVersion: string | null;
};

type UserDoc = {
  id?: unknown;
  email?: unknown;
  aiProvider?: unknown;
  aiAgentEnabled?: unknown;
  aiPolicyVersion?: unknown;
};

function parseListArg(argv: string[], flagName: string): Set<string> {
  const index = argv.indexOf(flagName);
  if (index === -1) {
    return new Set<string>();
  }

  const raw = argv[index + 1] || "";
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );
}

function parseValueArg(argv: string[], flagName: string): string | null {
  const index = argv.indexOf(flagName);
  if (index === -1) {
    return null;
  }
  const raw = (argv[index + 1] || "").trim();
  return raw.length > 0 ? raw : null;
}

function parseArgs(argv: string[]): Flags {
  return {
    dryRun: argv.includes("--dry-run") || !argv.includes("--apply"),
    apply: argv.includes("--apply"),
    optInUserIds: parseListArg(argv, "--opt-in-user-ids"),
    optInEmails: parseListArg(argv, "--opt-in-emails"),
    policyVersion: parseValueArg(argv, "--policy-version"),
  };
}

function normalizeAiProvider(value: unknown): "gemini" | "openai" | null {
  if (value === "gemini" || value === "openai") {
    return value;
  }
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (lowered === "gemini" || lowered === "openai") {
      return lowered;
    }
  }
  return null;
}

function normalizePolicyVersion(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function shouldOptInUser(flags: Flags, userId: string, email: string | null): boolean {
  if (flags.optInUserIds.has(userId)) {
    return true;
  }
  if (email && flags.optInEmails.has(email)) {
    return true;
  }
  return false;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const execute = flags.apply && !flags.dryRun;

  const mongoUrl = getMongoUrlForScript("script-migrate-user-ai-settings");
  const dbName = getMongoDbNameForScript();

  const client = new MongoClient(mongoUrl);
  await client.connect();

  try {
    const db = client.db(dbName);
    const users = db.collection("users");

    const docs = (await users
      .find(
        {},
        {
          projection: {
            id: 1,
            email: 1,
            aiProvider: 1,
            aiAgentEnabled: 1,
            aiPolicyVersion: 1,
          },
        },
      )
      .toArray()) as UserDoc[];

    if (docs.length === 0) {
      console.log("[migrate-user-ai-settings] No users found. Nothing to migrate.");
      return;
    }

    let scanned = 0;
    let updatedUsers = 0;
    let aiProviderSet = 0;
    let aiAgentEnabledSetFalse = 0;
    let aiAgentEnabledSetTrue = 0;
    let aiPolicyVersionSet = 0;
    let skippedInvalidUsers = 0;

    for (const doc of docs) {
      scanned += 1;

      if (typeof doc.id !== "string" || doc.id.trim().length === 0) {
        skippedInvalidUsers += 1;
        continue;
      }

      const userId = doc.id;
      const email = typeof doc.email === "string" ? doc.email : null;

      const updates: Record<string, unknown> = {};

      const normalizedProvider = normalizeAiProvider(doc.aiProvider);
      if (doc.aiProvider === undefined || doc.aiProvider !== normalizedProvider) {
        updates.aiProvider = normalizedProvider;
        aiProviderSet += 1;
      }

      if (typeof doc.aiAgentEnabled !== "boolean") {
        const optIn = shouldOptInUser(flags, userId, email);
        updates.aiAgentEnabled = optIn;
        if (optIn) {
          aiAgentEnabledSetTrue += 1;
        } else {
          aiAgentEnabledSetFalse += 1;
        }
      }

      const normalizedPolicyVersion = normalizePolicyVersion(doc.aiPolicyVersion);
      if (doc.aiPolicyVersion === undefined) {
        updates.aiPolicyVersion = flags.policyVersion;
        aiPolicyVersionSet += 1;
      } else if (doc.aiPolicyVersion !== normalizedPolicyVersion) {
        updates.aiPolicyVersion = normalizedPolicyVersion;
        aiPolicyVersionSet += 1;
      }

      if (Object.keys(updates).length === 0) {
        continue;
      }

      if (execute) {
        await users.updateOne({ id: userId }, { $set: updates });
      }

      updatedUsers += 1;
    }

    console.log(`[migrate-user-ai-settings] mode=${execute ? "apply" : "dry-run"}`);
    console.log(`[migrate-user-ai-settings] scanned=${scanned} skippedInvalidUsers=${skippedInvalidUsers}`);
    console.log(`[migrate-user-ai-settings] usersWithUpdates=${updatedUsers}`);
    console.log(
      `[migrate-user-ai-settings] fieldUpdates aiProvider=${aiProviderSet} aiAgentEnabledFalse=${aiAgentEnabledSetFalse} aiAgentEnabledTrue=${aiAgentEnabledSetTrue} aiPolicyVersion=${aiPolicyVersionSet}`,
    );

    if (!execute) {
      console.log("[migrate-user-ai-settings] Dry run complete. Re-run with --apply to execute updates.");
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("[migrate-user-ai-settings] Failed:", error?.message || error);
  process.exit(1);
});
