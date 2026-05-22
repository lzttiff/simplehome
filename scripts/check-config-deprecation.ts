import fs from "fs";
import path from "path";

type Args = {
  logPath: string;
  maxCount: number;
  sinceIso: string | null;
};

function parseArgs(argv: string[]): Args {
  let logPath: string | null = null;
  let maxCount = 0;
  let sinceIso: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--log") {
      logPath = argv[i + 1] || null;
      i += 1;
      continue;
    }
    if (token === "--max-count") {
      const raw = argv[i + 1] || "0";
      maxCount = Number(raw);
      i += 1;
      continue;
    }
    if (token === "--since") {
      sinceIso = argv[i + 1] || null;
      i += 1;
      continue;
    }
  }

  if (!logPath) {
    throw new Error("Missing required flag: --log <path-to-log-file>");
  }
  if (!Number.isFinite(maxCount) || maxCount < 0) {
    throw new Error("--max-count must be a non-negative number");
  }

  return { logPath, maxCount, sinceIso };
}

function extractTimestamp(line: string): Date | null {
  const match = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/);
  if (!match) {
    return null;
  }
  const parsed = new Date(match[1]);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const absolute = path.resolve(process.cwd(), args.logPath);

  if (!fs.existsSync(absolute)) {
    throw new Error(`Log file not found: ${absolute}`);
  }

  const sinceDate = args.sinceIso ? new Date(args.sinceIso) : null;
  if (sinceDate && Number.isNaN(sinceDate.getTime())) {
    throw new Error(`Invalid --since value: ${args.sinceIso}`);
  }

  const lines = fs.readFileSync(absolute, "utf8").split("\n");
  const matches: string[] = [];

  for (const line of lines) {
    if (!line.includes("[CONFIG_DEPRECATION]")) {
      continue;
    }

    if (sinceDate) {
      const ts = extractTimestamp(line);
      if (ts && ts < sinceDate) {
        continue;
      }
    }

    matches.push(line);
  }

  const byLegacyEnv = new Map<string, number>();
  for (const line of matches) {
    const envMatch = line.match(/legacy env\s+([A-Z0-9_]+)/);
    const key = envMatch?.[1] || "unknown";
    byLegacyEnv.set(key, (byLegacyEnv.get(key) || 0) + 1);
  }

  console.log("[PHASE5][CONFIG_DEPRECATION] Analysis summary");
  console.log(`- log: ${absolute}`);
  console.log(`- since: ${sinceDate ? sinceDate.toISOString() : "(full file)"}`);
  console.log(`- maxAllowed: ${args.maxCount}`);
  console.log(`- observed: ${matches.length}`);

  if (byLegacyEnv.size > 0) {
    console.log("- breakdown:");
    for (const [envName, count] of byLegacyEnv.entries()) {
      console.log(`  - ${envName}: ${count}`);
    }
  }

  if (matches.length > args.maxCount) {
    console.error(
      `[PHASE5][CONFIG_DEPRECATION] FAIL: observed ${matches.length} warning(s), exceeds max ${args.maxCount}.`,
    );
    process.exit(1);
  }

  console.log("[PHASE5][CONFIG_DEPRECATION] PASS");
}

main();
