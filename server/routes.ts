import express, { type Express } from "express";
// Catalog item interface for type safety
export interface CatalogItem {
  id: string;
  name: string;
  brand?: string;
  model?: string;
  installationDate: string;
  lastMinorServiceDate?: string;
  lastMajorServiceDate?: string;
  location: string;
  notes?: string;
  maintenanceSchedule: {
    minor: string;
    major: string;
  };
  provider?: string;
}
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { 
  insertMaintenanceTaskSchema, 
  insertQuestionnaireResponseSchema,
  compareDateOnly,
  normalizeDateOnly,
  toDateOnlyFromLocalDate,
  validateInsertMaintenanceTask,
  validateInsertQuestionnaireResponse,
  registerSchema,
  loginSchema,
  type InsertMaintenanceTask,
  type InsertQuestionnaireResponse,
  type User
} from "@shared/schema";
import { AISuggestion } from "@shared/aiSuggestion";
import { generateMaintenanceTasks, generateQuickSuggestions } from "./services/openai";
import { generateGeminiContent } from "./services/gemini";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { log } from "console";
import { logWithLevel } from "./services/logWithLevel";
import {
  buildCalendarTaskDescription,
  createGoogleCalendarAuthorizationUrl,
  deleteGoogleCalendarEventsForTask,
  disconnectGoogleCalendar,
  getGoogleCalendarSyncScope,
  getGoogleCalendarSyncStatus,
  handleGoogleCalendarOAuthCallback,
  runGoogleCalendarTwoWaySync,
  setGoogleCalendarSyncScope,
} from "./services/googleCalendarSync";
import passport from "passport";
import { requireAuth, hashPassword } from "./auth";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { deflateRawSync, inflateRawSync } from "zlib";

type CalendarSelection = {
  taskId: string;
  includeMinor: boolean;
  includeMajor: boolean;
};

type ParsedCalendarPayload = {
  v: number;
  exp: number;
  tz?: string;
  items: Array<{ i: string; m: 0 | 1; M: 0 | 1 }>;
};

const shortCalendarFeedStore = new Map<string, ParsedCalendarPayload>();
const shortCalendarFeedFile = path.join(process.cwd(), "data", "calendar-feeds.json");

function persistShortFeedStore(): void {
  try {
    const out = Object.fromEntries(shortCalendarFeedStore.entries());
    fs.mkdirSync(path.dirname(shortCalendarFeedFile), { recursive: true });
    fs.writeFileSync(shortCalendarFeedFile, JSON.stringify(out, null, 2), "utf-8");
  } catch {
    // Best effort only; runtime map still works for current process.
  }
}

function loadShortFeedStore(): void {
  try {
    if (!fs.existsSync(shortCalendarFeedFile)) return;
    const raw = fs.readFileSync(shortCalendarFeedFile, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, ParsedCalendarPayload>;
    const nowEpoch = Math.floor(Date.now() / 1000);

    Object.entries(parsed).forEach(([key, value]) => {
      if (value && value.exp && value.exp > nowEpoch) {
        shortCalendarFeedStore.set(key, value);
      }
    });
  } catch {
    // Ignore load failures; new feeds will still be created.
  }
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function compressedBase64UrlEncode(input: string): string {
  return deflateRawSync(Buffer.from(input, "utf8")).toString("base64url");
}

function compressedBase64UrlDecode(input: string): string {
  return inflateRawSync(Buffer.from(input, "base64url")).toString("utf8");
}

function getCalendarFeedSecret(): string {
  return process.env.CALENDAR_FEED_SECRET || process.env.ADMIN_TOKEN || "dev-calendar-feed-secret";
}

function signFeedPayload(payload: string): string {
  return createHmac("sha256", getCalendarFeedSecret()).update(payload).digest("base64url");
}

function formatICSDate(date: Date, dateOnly: boolean = false): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  if (dateOnly) {
    return `${year}${month}${day}`;
  }

  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

function formatICSDateOnly(dateOnly: string): string {
  return dateOnly.replace(/-/g, "");
}

function getTodayDateOnlyInTimezone(timezone: string): string {
  try {
    const formatted = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    return normalizeDateOnly(formatted) ?? toDateOnlyFromLocalDate(new Date());
  } catch {
    return toDateOnlyFromLocalDate(new Date());
  }
}

function isLikelyPrivateHost(host: string): boolean {
  const normalized = host.toLowerCase();
  if (normalized.includes("localhost") || normalized.includes("127.0.0.1")) return true;
  if (normalized.includes(".local")) return true;
  if (normalized.startsWith("10.")) return true;
  if (normalized.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)) return true;
  return false;
}

function decodeCalendarPayload(encodedPayload: string): ParsedCalendarPayload {
  // Prefer compressed decode for new tokens; fall back to legacy plain base64url tokens.
  try {
    return JSON.parse(compressedBase64UrlDecode(encodedPayload)) as ParsedCalendarPayload;
  } catch {
    return JSON.parse(base64UrlDecode(encodedPayload)) as ParsedCalendarPayload;
  }
}
// ...existing imports...
//const __filename = fileURLToPath(import.meta.url);
//const __dirname = path.dirname(__filename);
export async function registerRoutes(app: Express): Promise<Server> {
  loadShortFeedStore();

  // Respond to favicon requests to avoid serving the SPA index for this path
  // which causes the client router to render a 404 page for "/favicon.ico" in the browser.
  app.get('/favicon.ico', (_req, res) => res.status(204).end());

  // --- Auth routes ---
  app.post("/api/auth/register", async (req, res, next) => {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid input", errors: parsed.error.errors });
      }
      const { email, password, name } = parsed.data;

      const existing = await storage.getUserByEmail(email);
      if (existing) {
        return res.status(409).json({ message: "Email already registered" });
      }

      const passwordHash = await hashPassword(password);
      const user = await storage.createUser({ email, password, name, passwordHash });

      // Log in immediately after registration
      req.login(user, (err) => {
        if (err) return next(err);
        const { passwordHash: _pw, ...safeUser } = user;
        return res.status(201).json(safeUser);
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ message: "Registration failed" });
    }
  });

  app.post("/api/auth/login", (req, res, next) => {
    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) return next(err);
      if (!user) {
        return res.status(401).json({ message: info?.message || "Invalid email or password" });
      }
      req.login(user, (err) => {
        if (err) return next(err);
        const { passwordHash: _pw, ...safeUser } = user;
        return res.json(safeUser);
      });
    })(req, res, next);
  });

  app.post("/api/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        return res.status(500).json({ message: "Logout failed" });
      }
      res.json({ message: "Logged out" });
    });
  });

  app.get("/api/auth/me", (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const user = req.user as User;
    const { passwordHash: _pw, ...safeUser } = user;
    res.json(safeUser);
  });

  app.patch("/api/user/profile", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as User).id;
      const { name, timezone } = req.body ?? {};

      const allowed: { name?: string; timezone?: string | null } = {};
      if (typeof name === "string" && name.trim()) allowed.name = name.trim();
      if (timezone !== undefined) {
        // Accept either a valid IANA string or null to clear
        if (timezone === null || typeof timezone === "string") {
          allowed.timezone = timezone || null;
        }
      }

      if (Object.keys(allowed).length === 0) {
        return res.status(400).json({ message: "No valid fields to update" });
      }

      const updated = await storage.updateUserProfile(userId, allowed);
      if (!updated) return res.status(404).json({ message: "User not found" });

      // Refresh the session user so req.user reflects the new timezone going forward
      const { passwordHash: _pw, ...safeUser } = updated;
      req.login(updated, (err) => {
        if (err) return res.status(500).json({ message: "Session refresh failed" });
        res.json(safeUser);
      });
    } catch (error) {
      console.error("Update profile error:", error);
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  const getUserId = (req: express.Request): string | null => {
    return req.isAuthenticated() ? (req.user as User).id : null;
  };

  // AI Maintenance Schedule for a single item
  app.post("/api/item-schedule", async (req, res) => {
    try {
      const body = req.body || {};
      // Accept multiple payload shapes:
      // - { item: { ... } }
      // - direct CatalogItem in the body
      // - { householdCatalog: [ { items: [ { ... } ] } ] }
      let item: CatalogItem | undefined = undefined;
      if (body.item) {
        item = body.item;
      } else if (body.householdCatalog && Array.isArray(body.householdCatalog) && body.householdCatalog.length > 0) {
        const cat = body.householdCatalog[0];
        if (cat && Array.isArray(cat.items) && cat.items.length > 0) {
          item = cat.items[0];
        }
      } else if (body.id && body.name) {
        // heuristically treat the whole body as a CatalogItem
        item = body as CatalogItem;
      }

  // Resolve provider: request body -> item field -> env default -> fallback to gemini
  let provider = body.provider || item?.provider || process.env.DEFAULT_AI_PROVIDER || 'gemini';
      logWithLevel("INFO", `Item schedule request received for item: ${item?.name || 'undefined'}, provider: ${provider || 'undefined'}`);
      if (!item) {
        return res.status(400).json({ message: "No item provided" });
      }
      // Attach provider if present. Cast to CatalogItem to satisfy TypeScript in tests
      // provider may come from request body (string) so we cast defensively to the expected union type
      const itemWithProvider = provider
        ? ({ ...item, provider: provider as 'openai' | 'gemini' } as unknown as CatalogItem)
        : ({ ...item } as CatalogItem);
      // Import AI service (use dynamic ESM import to work in ESM runtime)
      const { generateMaintenanceSchedule } = await import("./services/maintenanceAi");
      const result = await generateMaintenanceSchedule(itemWithProvider as any);
      // If the service returned an error-like object, return HTTP 500 with diagnostics
      if (result && typeof result === 'object' && (result.error || result.validationErrors)) {
        logWithLevel('ERROR', `AI service returned error for item ${itemWithProvider.name}: ${JSON.stringify(result)}`);
        return res.status(500).json({ message: 'AI service validation failed', details: result });
      }
      res.json({ result });
    } catch (error) {
      console.error("AI item schedule error:", error);
      res.status(500).json({ message: "Failed to generate maintenance schedule" });
    }
  });
  // AI suggested maintenance Schedule 
  app.post("/api/category-schedule", async (req, res) => {
    try {
      // Try to get category from provided JSON
      const provided = req.body;
  // Resolve provider: request body/category -> catalog default -> env default -> gemini
  let provider = provided.provider || process.env.DEFAULT_AI_PROVIDER || 'gemini';
      let category;
      if (provided.householdCatalog && Array.isArray(provided.householdCatalog) && provided.householdCatalog.length > 0) {
        // Use first category from provided JSON
        category = provided.householdCatalog[0];
        provider = provider || category.provider;
      }
      // If not found, fallback to default from maintenance-template-singleFamilyHome.json
      if (!category || !category.items) {
        const catalogPath = path.join(__dirname, "../maintenance-template-singleFamilyHome.json");
        const catalogData = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
  provider = provider || catalogData.provider || process.env.DEFAULT_AI_PROVIDER || 'gemini';
        category = catalogData.householdCatalog && Array.isArray(catalogData.householdCatalog) && catalogData.householdCatalog.length > 0
          ? catalogData.householdCatalog[0]
          : null;
        if (!category || !category.items) {
          return res.status(404).json({ message: "No valid category found in provided or default catalog" });
        }
      }
      // Use log level INFO for category check
      const { logWithLevel } = await import("./services/logWithLevel");
      logWithLevel("INFO", `Category checked: ${category.categoryName}, provider: ${provider}`);
      logWithLevel("DEBUG", `Category items: ${JSON.stringify(category.items, null, 2)}`);
    
  const items = category.items.map((item: CatalogItem) => provider ? { ...item, provider } : { ...item });
      // Import AI service (dynamic ESM import)
      const { generateCategoryMaintenanceSchedules } = await import("./services/maintenanceAi");
      const results = await generateCategoryMaintenanceSchedules(items as any);

      const itemStatuses: Array<{
        itemId: string;
        itemName: string;
        status: "updated" | "failed" | "skipped";
        providerUsed: string | null;
        fallbackUsed: boolean;
        repaired: boolean;
        error: string | null;
      }> = [];
      
      // Update stored tasks with AI results
      let updatedCount = 0;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const result = results[i];
        const meta = (result && typeof result === "object") ? (result as any)._meta : undefined;

        if (!result) {
          itemStatuses.push({
            itemId: item.id,
            itemName: item.name,
            status: "skipped",
            providerUsed: null,
            fallbackUsed: false,
            repaired: false,
            error: "No result returned",
          });
          continue;
        }
        
        if (result && !result.error && item.id) {
          try {
            // Build the update object with AI-generated data
            const updates: any = {};
            
            // Update nextMaintenanceDate with AI results
            if (result.nextMaintenanceDates) {
              updates.nextMaintenanceDate = JSON.stringify({
                minor: result.nextMaintenanceDates.minor || null,
                major: result.nextMaintenanceDates.major || null
              });
            }
            
            // Update maintenance intervals and task lists
            if (result.maintenanceSchedule) {
              if (result.maintenanceSchedule.minorIntervalMonths) {
                updates.minorIntervalMonths = parseInt(result.maintenanceSchedule.minorIntervalMonths) || null;
              }
              if (result.maintenanceSchedule.majorIntervalMonths) {
                updates.majorIntervalMonths = parseInt(result.maintenanceSchedule.majorIntervalMonths) || null;
              }
              if (result.maintenanceSchedule.minorTasks && Array.isArray(result.maintenanceSchedule.minorTasks)) {
                updates.minorTasks = JSON.stringify(result.maintenanceSchedule.minorTasks);
              }
              if (result.maintenanceSchedule.majorTasks && Array.isArray(result.maintenanceSchedule.majorTasks)) {
                updates.majorTasks = JSON.stringify(result.maintenanceSchedule.majorTasks);
              }
            }
            
            // Update reasoning/notes
            if (result.reasoning) {
              updates.notes = result.reasoning;
            }
            
            // Only update if we have something to update
            if (Object.keys(updates).length > 0) {
              logWithLevel("DEBUG", `Updating task ${item.id} with: ${JSON.stringify(updates)}`);
              await storage.updateMaintenanceTask(item.id, updates, null);
              updatedCount++;
              logWithLevel("INFO", `Updated task ${item.id} (${item.name}) with AI schedule data`);
              itemStatuses.push({
                itemId: item.id,
                itemName: item.name,
                status: "updated",
                providerUsed: meta?.providerUsed ?? provider ?? null,
                fallbackUsed: !!meta?.fallbackUsed,
                repaired: !!meta?.repaired,
                error: null,
              });
            } else {
              itemStatuses.push({
                itemId: item.id,
                itemName: item.name,
                status: "skipped",
                providerUsed: meta?.providerUsed ?? provider ?? null,
                fallbackUsed: !!meta?.fallbackUsed,
                repaired: !!meta?.repaired,
                error: "No update payload generated",
              });
            }
          } catch (error) {
            logWithLevel("ERROR", `Failed to update task ${item.id}: ${error}`);
            itemStatuses.push({
              itemId: item.id,
              itemName: item.name,
              status: "failed",
              providerUsed: meta?.providerUsed ?? provider ?? null,
              fallbackUsed: !!meta?.fallbackUsed,
              repaired: !!meta?.repaired,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        } else {
          itemStatuses.push({
            itemId: item.id,
            itemName: item.name,
            status: "failed",
            providerUsed: meta?.providerUsed ?? provider ?? null,
            fallbackUsed: !!meta?.fallbackUsed,
            repaired: !!meta?.repaired,
            error: result?.error || "Unknown AI generation error",
          });
        }
      }
      
      logWithLevel("INFO", `Updated ${updatedCount} tasks out of ${items.length} with AI schedule data`);
      const failedCount = itemStatuses.filter((s) => s.status === "failed").length;
      const fallbackUsedCount = itemStatuses.filter((s) => s.fallbackUsed).length;
      const repairedCount = itemStatuses.filter((s) => s.repaired).length;

      res.json({
        results,
        updatedCount,
        itemStatuses,
        summary: {
          total: items.length,
          updated: updatedCount,
          failed: failedCount,
          fallbackUsed: fallbackUsedCount,
          repaired: repairedCount,
        },
      });
    } catch (error) {
      console.error("AI schedule error:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to generate maintenance schedules";
      res.status(500).json({ 
        message: "Failed to generate maintenance schedules",
        error: errorMessage,
        details: error instanceof Error ? error.stack : String(error)
      });
    }
  });
  // Property Templates
  app.get("/api/templates", async (_req, res) => {
    try {
      const templates = await storage.getPropertyTemplates();
      res.json(templates);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch templates" });
    }
  });

  app.get("/api/templates/:id", async (req, res) => {
    try {
      const template = await storage.getPropertyTemplate(req.params.id);
      if (!template) {
        return res.status(404).json({ message: "Template not found" });
      }
      res.json(template);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch template" });
    }
  });

  // Maintenance Tasks
  app.get("/api/tasks", requireAuth, async (req, res) => {
    try {
      const userId = getUserId(req);
      const filters = {
        category: req.query.category as string,
        priority: req.query.priority as string,
        status: req.query.status as string,
        search: req.query.search as string,
        templateId: req.query.templateId as string,
      };

      const tasks = await storage.getMaintenanceTasks(userId, filters);
      res.json(tasks);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch tasks" });
    }
  });

  app.get("/api/tasks/:id", requireAuth, async (req, res) => {
    try {
      const userId = getUserId(req);
      const task = await storage.getMaintenanceTask(req.params.id, userId);
      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }
      res.json(task);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch task" });
    }
  });

  app.delete("/api/tasks/:id", requireAuth, async (req, res) => {
    try {
      const userId = getUserId(req);
      // Fetch the task first so we can clean up Google Calendar events before deletion.
      const task = await storage.getMaintenanceTask(req.params.id, userId);
      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }
      // Best-effort removal of associated Google Calendar events.
      try {
        await deleteGoogleCalendarEventsForTask(req, task);
      } catch {
        // Don't let GCal cleanup failure prevent task deletion.
      }
      const deleted = await storage.deleteMaintenanceTask(req.params.id, userId);
      if (!deleted) {
        return res.status(404).json({ message: "Task not found" });
      }
      res.json({ message: "Task deleted successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete task" });
    }
  });

  // Create a new maintenance task
  app.post("/api/tasks", requireAuth, async (req, res) => {
    try {
      const userId = getUserId(req);
      // Validate request body using the shared Zod schema
      const validated = insertMaintenanceTaskSchema.parse(req.body);
      const created = await storage.createMaintenanceTask(validated as any, userId);
      res.status(201).json(created);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid task payload", errors: error.errors });
      }
      console.error("Create task error:", error);
      res.status(500).json({ message: "Failed to create task" });
    }
  });

  // Update an existing maintenance task
  app.patch("/api/tasks/:id", requireAuth, async (req, res) => {
    try {
      const userId = getUserId(req);
      const updated = await storage.updateMaintenanceTask(req.params.id, req.body, userId);
      if (!updated) {
        return res.status(404).json({ message: "Task not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Update task error:", error);
      res.status(500).json({ message: "Failed to update task" });
    }
  });

  app.get("/api/calendar/google/sync/status", requireAuth, async (req, res) => {
    try {
      const status = await getGoogleCalendarSyncStatus(req);
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ message: error?.message || "Failed to load Google Calendar sync status" });
    }
  });

  app.post("/api/calendar/google/sync/start", requireAuth, async (req, res) => {
    try {
      const bodySchema = z.object({
        returnPath: z.string().optional(),
      });
      const { returnPath } = bodySchema.parse(req.body ?? {});
      const userId = (req.user as User | undefined)?.id || "unknown";
      console.log(
        `[GOOGLE_OAUTH_START] userId=${userId} returnPath=${returnPath || "/"} hasSession=${!!req.session} sessionId=${(req.session as any)?.id || "n/a"}`,
      );
      const authorizationUrl = createGoogleCalendarAuthorizationUrl(req, returnPath);
      res.json({ authorizationUrl });
    } catch (error: any) {
      res.status(500).json({ message: error?.message || "Failed to start Google Calendar authorization" });
    }
  });

  app.get("/api/calendar/google/oauth/callback", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as User | undefined)?.id || "unknown";
      const hasCode = typeof req.query.code === "string";
      const hasState = typeof req.query.state === "string";
      const sessionOAuth = (req.session as any)?.googleCalendarOAuth;
      console.log(
        `[GOOGLE_OAUTH_CALLBACK] userId=${userId} hasCode=${hasCode} hasState=${hasState} hasSessionOAuth=${!!sessionOAuth} stateMatch=${hasState && !!sessionOAuth?.state ? req.query.state === sessionOAuth.state : false}`,
      );
      const returnPath = await handleGoogleCalendarOAuthCallback(req);
      const separator = returnPath.includes("?") ? "&" : "?";
      console.log(`[GOOGLE_OAUTH_CALLBACK_OK] userId=${userId} returnPath=${returnPath}`);
      res.redirect(`${returnPath}${separator}googleCalendar=connected`);
    } catch (error: any) {
      const userId = (req.user as User | undefined)?.id || "unknown";
      console.error(`[GOOGLE_OAUTH_CALLBACK_FAIL] userId=${userId} message=${error?.message || "unknown error"}`);
      const message = encodeURIComponent(error?.message || "Google Calendar connection failed");
      res.redirect(`/?googleCalendarError=${message}`);
    }
  });

  app.get("/api/calendar/google/debug", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as User | undefined)?.id;
      if (!userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const connection = await storage.getGoogleCalendarConnection(userId);
      const sessionOAuth = (req.session as any)?.googleCalendarOAuth;

      res.json({
        userId,
        callbackQuery: {
          hasCode: typeof req.query.code === "string",
          hasState: typeof req.query.state === "string",
        },
        session: {
          hasSession: !!req.session,
          hasOAuthState: !!sessionOAuth?.state,
          returnPath: sessionOAuth?.returnPath || null,
        },
        connection: {
          exists: !!connection,
          accountEmail: connection?.email || null,
          calendarId: connection?.calendarId || null,
          hasAccessToken: !!connection?.accessToken,
          hasRefreshToken: !!connection?.refreshToken,
          lastSyncedAt: connection?.lastSyncedAt ? connection.lastSyncedAt.toISOString() : null,
          updatedAt: connection?.updatedAt ? connection.updatedAt.toISOString() : null,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error?.message || "Failed to load Google debug state" });
    }
  });

  app.post("/api/calendar/google/sync", requireAuth, async (req, res) => {
    try {
      const bodySchema = z.object({
        selections: z
          .array(
            z.object({
              taskId: z.string().min(1),
              includeMinor: z.boolean().default(true),
              includeMajor: z.boolean().default(true),
            }),
          )
          .min(1),
      });

      const { selections } = bodySchema.parse(req.body);
      const outcome = await runGoogleCalendarTwoWaySync(
        req,
        selections
          .map((selection) => ({
            taskId: selection.taskId,
            includeMinor: !!selection.includeMinor,
            includeMajor: !!selection.includeMajor,
          }))
          .filter((selection) => selection.includeMinor || selection.includeMajor),
      );
      res.json(outcome);
    } catch (error: any) {
      const status = error?.message?.includes("not connected") ? 409 : 500;
      res.status(status).json({ message: error?.message || "Google Calendar sync failed" });
    }
  });

  app.get("/api/calendar/google/sync/scope", requireAuth, async (req, res) => {
    try {
      const scope = await getGoogleCalendarSyncScope(req);
      res.json(scope);
    } catch (error: any) {
      res.status(500).json({ message: error?.message || "Failed to load Google Calendar sync scope" });
    }
  });

  app.put("/api/calendar/google/sync/scope", requireAuth, async (req, res) => {
    try {
      const bodySchema = z.object({
        selections: z
          .array(
            z.object({
              taskId: z.string().min(1),
              includeMinor: z.boolean().default(true),
              includeMajor: z.boolean().default(true),
            }),
          )
          .min(1),
      });

      const { selections } = bodySchema.parse(req.body ?? {});
      const outcome = await setGoogleCalendarSyncScope(
        req,
        selections
          .map((selection) => ({
            taskId: selection.taskId,
            includeMinor: !!selection.includeMinor,
            includeMajor: !!selection.includeMajor,
          }))
          .filter((selection) => selection.includeMinor || selection.includeMajor),
      );
      res.json(outcome);
    } catch (error: any) {
      res.status(500).json({ message: error?.message || "Failed to update Google Calendar sync scope" });
    }
  });

  app.post("/api/calendar/google/disconnect", requireAuth, async (req, res) => {
    try {
      await disconnectGoogleCalendar(req);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ message: error?.message || "Failed to disconnect Google Calendar" });
    }
  });

  // Google calendar subscription feed: issue signed token for selected tasks.
  app.post("/api/calendar/google/feed-token", async (req, res) => {
    try {
      const bodySchema = z.object({
        selections: z
          .array(
            z.object({
              taskId: z.string().min(1),
              includeMinor: z.boolean().default(true),
              includeMajor: z.boolean().default(true),
            }),
          )
          .min(1),
      });

      const { selections } = bodySchema.parse(req.body);
      const normalized: CalendarSelection[] = selections
        .map((s) => ({
          taskId: s.taskId,
          includeMinor: !!s.includeMinor,
          includeMajor: !!s.includeMajor,
        }))
        .filter((s) => s.includeMinor || s.includeMajor);

      if (normalized.length === 0) {
        return res.status(400).json({ message: "No valid selections provided" });
      }

      const payload: ParsedCalendarPayload = {
        v: 1,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 180, // 180 days
        tz: req.isAuthenticated() ? ((req.user as User).timezone ?? "UTC") : "UTC",
        items: normalized.map((s) => ({
          i: s.taskId,
          m: (s.includeMinor ? 1 : 0) as 0 | 1,
          M: (s.includeMajor ? 1 : 0) as 0 | 1,
        })),
      };

      // Use compressed payloads to keep feed URLs shorter for Google "add by URL".
      const encodedPayload = compressedBase64UrlEncode(JSON.stringify(payload));
      const signature = signFeedPayload(encodedPayload);
      const token = `${encodedPayload}.${signature}`;
      const shortFeedId = randomBytes(9).toString("base64url");
      shortCalendarFeedStore.set(shortFeedId, payload);
      persistShortFeedStore();

      // Estimate event count at generation time to catch empty feeds early.
      const selectedTasks = await Promise.all(normalized.map((s) => storage.getMaintenanceTask(s.taskId, null)));
      let estimatedEventCount = 0;
      let missingTaskCount = 0;
      for (let idx = 0; idx < normalized.length; idx++) {
        const selection = normalized[idx];
        const task = selectedTasks[idx];
        if (!task || !task.nextMaintenanceDate) {
          missingTaskCount++;
          continue;
        }
        try {
          const next = JSON.parse(task.nextMaintenanceDate) as { minor?: string | null; major?: string | null };
          if (selection.includeMinor && next?.minor) estimatedEventCount++;
          if (selection.includeMajor && next?.major) estimatedEventCount++;
        } catch {
          // Ignore malformed date blobs in estimate; feed endpoint handles them safely too.
        }
      }

      const protocol = req.headers["x-forwarded-proto"]?.toString().split(",")[0] || req.protocol;
      const host = req.get("host") || "localhost:5000";
      const inferredBase = `${protocol}://${host}`;
      const configuredBase = process.env.PUBLIC_BASE_URL?.trim();
      const baseUrl = configuredBase && configuredBase.length > 0 ? configuredBase.replace(/\/$/, "") : inferredBase;
      const feedUrlToken = `${baseUrl}/api/calendar/google/feed/${token}`;
      const feedUrlTokenIcs = `${baseUrl}/api/calendar/google/feed/${token}/simplehome.ics`;
      // Use short-id URLs as primary links for better Google compatibility.
      const feedUrl = `${baseUrl}/api/calendar/google/subscriptions/${shortFeedId}`;
      const feedUrlIcs = `${baseUrl}/api/calendar/google/subscriptions/${shortFeedId}.ics`;
      const feedUrlShort = `${baseUrl}/api/calendar/google/feed/s/${shortFeedId}`;
      const feedUrlShortIcs = `${baseUrl}/api/calendar/google/feed/s/${shortFeedId}/simplehome.ics`;
      // Use .ics URL for Google prefill. Some Google flows validate extension-based feeds more reliably.
      const googleSubscribeUrl = `https://calendar.google.com/calendar/u/0/r/settings/addbyurl?cid=${encodeURIComponent(feedUrlIcs)}`;
      const googleSubscribeUrlFallback = "https://calendar.google.com/calendar/u/0/r/settings/addbyurl";
      const isLikelyPrivateUrl = isLikelyPrivateHost(new URL(feedUrl).hostname);

      logWithLevel(
        "INFO",
        `Google feed token created: selections=${normalized.length}, estimatedEvents=${estimatedEventCount}, missingTasks=${missingTaskCount}, shortId=${shortFeedId}, baseUrl=${baseUrl}, feedUrl=${feedUrlIcs}`,
      );

      res.json({
        token,
        shortFeedId,
        feedUrl,
        feedUrlIcs,
        feedUrlShort,
        feedUrlShortIcs,
        feedUrlToken,
        feedUrlTokenIcs,
        baseUrl,
        googleSubscribeUrl,
        googleSubscribeUrlFallback,
        itemCount: normalized.length,
        estimatedEventCount,
        missingTaskCount,
        isLikelyPrivateUrl,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid payload", errors: error.errors });
      }
      console.error("Create Google feed token error:", error);
      res.status(500).json({ message: "Failed to create Google feed token" });
    }
  });

  const writeCalendarFeed = async (
    req: express.Request,
    res: express.Response,
    parsed: ParsedCalendarPayload,
  ) => {
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.items)) {
      return res.status(400).send("Invalid payload");
    }
    if (!parsed.exp || Math.floor(Date.now() / 1000) > parsed.exp) {
      return res.status(401).send("Token expired");
    }

    const tasks = await Promise.all(parsed.items.map((item) => storage.getMaintenanceTask(item.i, null)));
    const now = new Date();
    const feedTimezone = parsed.tz || "UTC";
    const todayDateOnly = getTodayDateOnlyInTimezone(feedTimezone);
    let eventCount = 0;

    const ics: string[] = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//SimpleHome//Google Subscription Feed//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:SimpleHome Maintenance Schedule",
      `X-WR-TIMEZONE:${parsed.tz || "UTC"}`,
    ];

    for (let idx = 0; idx < parsed.items.length; idx++) {
      const item = parsed.items[idx];
      const task = tasks[idx];
      if (!task || !task.nextMaintenanceDate) continue;

      let next: { minor?: string | null; major?: string | null } = {};
      try {
        next = JSON.parse(task.nextMaintenanceDate);
      } catch {
        continue;
      }

      if (item.m && next.minor) {
        const dateOnly = normalizeDateOnly(next.minor);
        if (!dateOnly) {
          continue;
        }
        const eventDateOnly = compareDateOnly(dateOnly, todayDateOnly) < 0 ? todayDateOnly : dateOnly;
        const description = buildCalendarTaskDescription(task, "minor");
        const uid = `${task.id}-minor@simplehome.app`;
        ics.push(
          "BEGIN:VEVENT",
          `UID:${uid}`,
          `DTSTAMP:${formatICSDate(new Date())}`,
          `DTSTART;VALUE=DATE:${formatICSDateOnly(eventDateOnly)}`,
          `SUMMARY:Minor Maintenance: ${task.title}`,
          `DESCRIPTION:${description.replace(/\n/g, "\\n")}`,
          `CATEGORIES:${task.category}`,
          "STATUS:CONFIRMED",
          "END:VEVENT",
        );
        eventCount++;
      }

      if (item.M && next.major) {
        const dateOnly = normalizeDateOnly(next.major);
        if (!dateOnly) {
          continue;
        }
        const eventDateOnly = compareDateOnly(dateOnly, todayDateOnly) < 0 ? todayDateOnly : dateOnly;
        const description = buildCalendarTaskDescription(task, "major");
        const uid = `${task.id}-major@simplehome.app`;
        ics.push(
          "BEGIN:VEVENT",
          `UID:${uid}`,
          `DTSTAMP:${formatICSDate(new Date())}`,
          `DTSTART;VALUE=DATE:${formatICSDateOnly(eventDateOnly)}`,
          `SUMMARY:Major Maintenance: ${task.title}`,
          `DESCRIPTION:${description.replace(/\n/g, "\\n")}`,
          `CATEGORIES:${task.category}`,
          "STATUS:CONFIRMED",
          "END:VEVENT",
        );
        eventCount++;
      }
    }

    ics.push("END:VCALENDAR");
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("X-SimpleHome-Event-Count", String(eventCount));
    res.setHeader("X-SimpleHome-Token-Items", String(parsed.items.length));
    res.setHeader("Cache-Control", "no-store");
    logWithLevel(
      "INFO",
      `Google feed served: events=${eventCount}, selectedItems=${parsed.items.length}, ua=${req.get("user-agent") || "unknown"}`,
    );
    return res.send(ics.join("\r\n"));
  };

  const handleGoogleCalendarFeed = async (req: express.Request, res: express.Response) => {
    try {
      const token = req.params.token;
      const [encodedPayload, providedSig] = token.split(".");
      if (!encodedPayload || !providedSig) {
        return res.status(400).send("Invalid token");
      }

      const expectedSig = signFeedPayload(encodedPayload);
      const providedSigBuffer = Buffer.from(providedSig, "base64url");
      const expectedSigBuffer = Buffer.from(expectedSig, "base64url");
      if (
        providedSigBuffer.length !== expectedSigBuffer.length ||
        !timingSafeEqual(providedSigBuffer, expectedSigBuffer)
      ) {
        return res.status(401).send("Invalid signature");
      }

      const parsed = decodeCalendarPayload(encodedPayload);
      return await writeCalendarFeed(req, res, parsed);
    } catch (error) {
      console.error("Google feed render error:", error);
      res.status(500).send("Failed to render feed");
    }
  };

  const handleGoogleCalendarShortFeed = async (req: express.Request, res: express.Response) => {
    try {
      const feedId = (req.params.feedId ?? "").replace(/\.ics$/i, "");
      let parsed = shortCalendarFeedStore.get(feedId);
      if (!parsed) {
        // The process may have restarted; reload persisted feed ids and retry once.
        loadShortFeedStore();
        parsed = shortCalendarFeedStore.get(feedId);
      }
      if (!parsed) {
        logWithLevel("WARN", `Google short feed not found: feedId=${feedId}`);
        return res.status(404).send("Feed not found");
      }

      if (!parsed.exp || Math.floor(Date.now() / 1000) > parsed.exp) {
        shortCalendarFeedStore.delete(feedId);
        persistShortFeedStore();
        return res.status(401).send("Token expired");
      }

      return await writeCalendarFeed(req, res, parsed);
    } catch (error) {
      console.error("Google short feed render error:", error);
      res.status(500).send("Failed to render feed");
    }
  };

  // Google calendar subscription feed endpoint (ICS).
  app.get("/api/calendar/google/feed/:token", handleGoogleCalendarFeed);
  // Optional .ics-styled variant for providers that prefer a file-like URL.
  app.get("/api/calendar/google/feed/:token/:fileName", handleGoogleCalendarFeed);
  // Compact short-id feed endpoints for better provider URL compatibility.
  app.get("/api/calendar/google/feed/s/:feedId", handleGoogleCalendarShortFeed);
  app.get("/api/calendar/google/feed/s/:feedId/:fileName", handleGoogleCalendarShortFeed);
  // Simple alias paths for providers that prefer plain .ics subscription URLs.
  app.get("/api/calendar/google/subscriptions/:feedId", handleGoogleCalendarShortFeed);
  app.get("/api/calendar/google/subscriptions/:feedId.ics", handleGoogleCalendarShortFeed);

  // Diagnostic endpoint: minimal static ICS feed to validate Google reachability.
  app.get("/api/calendar/google/diagnostic.ics", (_req, res) => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(now.getUTCDate() + 1);

    const ics: string[] = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//SimpleHome//Google Diagnostic Feed//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:SimpleHome Diagnostic Calendar",
      "X-WR-TIMEZONE:UTC",
      "BEGIN:VEVENT",
      "UID:simplehome-diagnostic@simplehome.app",
      `DTSTAMP:${formatICSDate(now)}`,
      `DTSTART;VALUE=DATE:${formatICSDate(tomorrow, true)}`,
      "SUMMARY:SimpleHome Diagnostic Event",
      "DESCRIPTION:If this appears in Google Calendar, host reachability is working.",
      "STATUS:CONFIRMED",
      "END:VEVENT",
      "END:VCALENDAR",
    ];

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    logWithLevel("INFO", "Google diagnostic feed served");
    res.send(ics.join("\r\n"));
  });

  // Apple calendar subscription feed: issue signed token for selected tasks.
  app.post("/api/calendar/apple/feed-token", async (req, res) => {
    try {
      const bodySchema = z.object({
        selections: z
          .array(
            z.object({
              taskId: z.string().min(1),
              includeMinor: z.boolean().default(true),
              includeMajor: z.boolean().default(true),
            }),
          )
          .min(1),
      });

      const { selections } = bodySchema.parse(req.body);
      const normalized: CalendarSelection[] = selections
        .map((s) => ({
          taskId: s.taskId,
          includeMinor: !!s.includeMinor,
          includeMajor: !!s.includeMajor,
        }))
        .filter((s) => s.includeMinor || s.includeMajor);

      if (normalized.length === 0) {
        return res.status(400).json({ message: "No valid selections provided" });
      }

      const payload: ParsedCalendarPayload = {
        v: 1,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 180, // 180 days
        tz: req.isAuthenticated() ? ((req.user as User).timezone ?? "UTC") : "UTC",
        items: normalized.map((s) => ({
          i: s.taskId,
          m: (s.includeMinor ? 1 : 0) as 0 | 1,
          M: (s.includeMajor ? 1 : 0) as 0 | 1,
        })),
      };

      // Use compressed payloads to keep feed URLs shorter.
      const encodedPayload = compressedBase64UrlEncode(JSON.stringify(payload));
      const signature = signFeedPayload(encodedPayload);
      const token = `${encodedPayload}.${signature}`;
      const shortFeedId = randomBytes(9).toString("base64url");
      shortCalendarFeedStore.set(shortFeedId, payload);
      persistShortFeedStore();

      // Estimate event count at generation time to catch empty feeds early.
      const selectedTasks = await Promise.all(normalized.map((s) => storage.getMaintenanceTask(s.taskId, null)));
      let estimatedEventCount = 0;
      let missingTaskCount = 0;
      for (let idx = 0; idx < normalized.length; idx++) {
        const selection = normalized[idx];
        const task = selectedTasks[idx];
        if (!task || !task.nextMaintenanceDate) {
          missingTaskCount++;
          continue;
        }
        try {
          const next = JSON.parse(task.nextMaintenanceDate) as { minor?: string | null; major?: string | null };
          if (selection.includeMinor && next?.minor) estimatedEventCount++;
          if (selection.includeMajor && next?.major) estimatedEventCount++;
        } catch {
          // Ignore malformed date blobs in estimate; feed endpoint handles them safely too.
        }
      }

      const protocol = req.headers["x-forwarded-proto"]?.toString().split(",")[0] || req.protocol;
      const host = req.get("host") || "localhost:5000";
      const inferredBase = `${protocol}://${host}`;
      const configuredBase = process.env.PUBLIC_BASE_URL?.trim();
      const baseUrl = configuredBase && configuredBase.length > 0 ? configuredBase.replace(/\/$/, "") : inferredBase;
      const feedUrlToken = `${baseUrl}/api/calendar/apple/feed/${token}`;
      const feedUrlTokenIcs = `${baseUrl}/api/calendar/apple/feed/${token}/simplehome.ics`;
      const feedUrl = `${baseUrl}/api/calendar/apple/subscriptions/${shortFeedId}`;
      const feedUrlIcs = `${baseUrl}/api/calendar/apple/subscriptions/${shortFeedId}.ics`;
      const feedUrlShort = `${baseUrl}/api/calendar/apple/feed/s/${shortFeedId}`;
      const feedUrlShortIcs = `${baseUrl}/api/calendar/apple/feed/s/${shortFeedId}/simplehome.ics`;
      const isLikelyPrivateUrl = isLikelyPrivateHost(new URL(feedUrl).hostname);

      logWithLevel(
        "INFO",
        `Apple feed token created: selections=${normalized.length}, estimatedEvents=${estimatedEventCount}, missingTasks=${missingTaskCount}, shortId=${shortFeedId}, baseUrl=${baseUrl}, feedUrl=${feedUrlIcs}`,
      );

      res.json({
        token,
        shortFeedId,
        feedUrl,
        feedUrlIcs,
        feedUrlShort,
        feedUrlShortIcs,
        feedUrlToken,
        feedUrlTokenIcs,
        baseUrl,
        itemCount: normalized.length,
        estimatedEventCount,
        missingTaskCount,
        isLikelyPrivateUrl,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid payload", errors: error.errors });
      }
      console.error("Create Apple feed token error:", error);
      res.status(500).json({ message: "Failed to create Apple feed token" });
    }
  });

  const handleAppleCalendarFeed = async (req: express.Request, res: express.Response) => {
    try {
      const token = req.params.token;
      const [encodedPayload, providedSig] = token.split(".");
      if (!encodedPayload || !providedSig) {
        return res.status(400).send("Invalid token");
      }

      const expectedSig = signFeedPayload(encodedPayload);
      const providedSigBuffer = Buffer.from(providedSig, "base64url");
      const expectedSigBuffer = Buffer.from(expectedSig, "base64url");
      if (
        providedSigBuffer.length !== expectedSigBuffer.length ||
        !timingSafeEqual(providedSigBuffer, expectedSigBuffer)
      ) {
        return res.status(401).send("Invalid signature");
      }

      const parsed = decodeCalendarPayload(encodedPayload);
      return await writeCalendarFeed(req, res, parsed);
    } catch (error) {
      console.error("Apple feed render error:", error);
      res.status(500).send("Failed to render feed");
    }
  };

  const handleAppleCalendarShortFeed = async (req: express.Request, res: express.Response) => {
    try {
      const feedId = (req.params.feedId ?? "").replace(/\.ics$/i, "");
      let parsed = shortCalendarFeedStore.get(feedId);
      if (!parsed) {
        // The process may have restarted; reload persisted feed ids and retry once.
        loadShortFeedStore();
        parsed = shortCalendarFeedStore.get(feedId);
      }
      if (!parsed) {
        logWithLevel("WARN", `Apple short feed not found: feedId=${feedId}`);
        return res.status(404).send("Feed not found");
      }

      if (!parsed.exp || Math.floor(Date.now() / 1000) > parsed.exp) {
        shortCalendarFeedStore.delete(feedId);
        persistShortFeedStore();
        return res.status(401).send("Token expired");
      }

      return await writeCalendarFeed(req, res, parsed);
    } catch (error) {
      console.error("Apple short feed render error:", error);
      res.status(500).send("Failed to render feed");
    }
  };

  // Apple calendar subscription feed endpoint (ICS).
  app.get("/api/calendar/apple/feed/:token", handleAppleCalendarFeed);
  // Optional .ics-styled variant for providers that prefer a file-like URL.
  app.get("/api/calendar/apple/feed/:token/:fileName", handleAppleCalendarFeed);
  // Compact short-id feed endpoints for better provider URL compatibility.
  app.get("/api/calendar/apple/feed/s/:feedId", handleAppleCalendarShortFeed);
  app.get("/api/calendar/apple/feed/s/:feedId/:fileName", handleAppleCalendarShortFeed);
  // Simple alias paths for providers that prefer plain .ics subscription URLs.
  app.get("/api/calendar/apple/subscriptions/:feedId", handleAppleCalendarShortFeed);
  app.get("/api/calendar/apple/subscriptions/:feedId.ics", handleAppleCalendarShortFeed);

  // Apple calendar diagnostic endpoint: minimal static ICS feed to validate Apple reachability.
  app.get("/api/calendar/apple/diagnostic.ics", (_req, res) => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(now.getUTCDate() + 1);

    const ics: string[] = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//SimpleHome//Apple Diagnostic Feed//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:SimpleHome Diagnostic Calendar",
      "X-WR-TIMEZONE:UTC",
      "BEGIN:VEVENT",
      "UID:simplehome-diagnostic-apple@simplehome.app",
      `DTSTAMP:${formatICSDate(now)}`,
      `DTSTART;VALUE=DATE:${formatICSDate(tomorrow, true)}`,
      "SUMMARY:SimpleHome Diagnostic Event",
      "DESCRIPTION:If this appears in Apple Calendar, host reachability is working.",
      "STATUS:CONFIRMED",
      "END:VEVENT",
      "END:VCALENDAR",
    ];

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    logWithLevel("INFO", "Apple diagnostic feed served");
    res.send(ics.join("\r\n"));
  });

  // AI Task Generation
  app.post("/api/ai/generate-tasks", requireAuth, async (req, res) => {
    try {
  const { propertyType, assessment, provider: reqProvider, geminiApiKey } = req.body;
  const provider = reqProvider || process.env.DEFAULT_AI_PROVIDER || 'gemini';
      if (!propertyType || !assessment) {
        return res.status(400).json({ message: "Property type and assessment are required" });
      }
      let suggestions;
      if (provider === "gemini") {
        // Support passing the Gemini API key in the request body, via environment variable,
        // or via a local file named `gemini.key` at the project root.
        let keyToUse = geminiApiKey || process.env.GEMINI_API_KEY;
        if (!keyToUse) {
          try {
            const candidate = path.resolve(process.cwd(), "gemini.key");
            if (fs.existsSync(candidate)) {
              keyToUse = fs.readFileSync(candidate, "utf-8").trim();
            }
          } catch (e) {
            // ignore file read errors and fall through to validation
          }
        }
        if (!keyToUse) {
          return res.status(400).json({ message: "Gemini API key required (provide geminiApiKey in request body, set GEMINI_API_KEY, or place key in project root file 'gemini.key')" });
        }
        const prompt = `Generate maintenance items / tasks for property type: ${propertyType}, assessment: ${typeof assessment === 'string' ? assessment : JSON.stringify(assessment)}`;
        const geminiResponse = await generateGeminiContent(prompt, keyToUse);
        suggestions = [geminiResponse];
      } else {
        suggestions = await generateMaintenanceTasks(propertyType, assessment);
      }
      res.json({ suggestions });
    } catch (error) {
      console.error("AI task generation error:", error);
      const errMsg = (error instanceof Error) ? error.message : "Failed to generate AI items / tasks";
      res.status(500).json({ message: errMsg });
    }
  });

  app.post("/api/ai/quick-suggestions", requireAuth, async (req, res) => {
    try {
  const { existingTasks, propertyInfo, provider: reqProvider, geminiApiKey } = req.body;
    const provider = reqProvider || process.env.DEFAULT_AI_PROVIDER || 'gemini';
    let suggestions: any;
    if (provider === "gemini") {
        const keyToUse = geminiApiKey || process.env.GEMINI_API_KEY;
        if (!keyToUse) {
          return res.status(400).json({ message: "Gemini API key required" });
        }
        const prompt = `Suggest quick maintenance tasks for property info: ${JSON.stringify(propertyInfo)}, existing tasks: ${JSON.stringify(existingTasks)}`;
        const geminiResponse = await generateGeminiContent(prompt, keyToUse);
        suggestions = [geminiResponse];
        logWithLevel("INFO", `Generated quick suggestions using ${provider}`);
        logWithLevel("DEBUG", `Provider (${provider}) response: ${JSON.stringify(geminiResponse)}`);
      } else {
        suggestions = await generateQuickSuggestions(existingTasks || [], propertyInfo);
      }
      if (Array.isArray(suggestions)) {
        suggestions = suggestions.flat(Infinity);
        logWithLevel("INFO", `Generated quick suggestions using ${provider}`);
        logWithLevel("DEBUG", `Quick suggestions (${provider}): ${JSON.stringify(suggestions)}`);
      }
      
      // Validate and normalize to AISuggestion schema for both providers
      // Ensures consistent structure: title, description, category, priority, frequency, reasoning
      const normalizedSuggestions: AISuggestion[] = Array.isArray(suggestions) 
        ? suggestions.map((s: any) => ({
            title: s.title || s.Name || "Maintenance Task",
            description: s.description || s["Maintenance Schedule"]?.Minor || "Regular maintenance",
            category: s.category || "HVAC & Mechanical",
            priority: s.priority || "Medium",
            frequency: s.frequency || s["Maintenance Schedule"]?.Major || "Annual",
            reasoning: s.reasoning || s["Maintenance Schedule"]?.reasoning || "Recommended maintenance"
          } as AISuggestion))
        : [];
      
      res.json({ suggestions: normalizedSuggestions });
    } catch (error) {
      console.error("AI quick suggestions error:", error);
      const errMsg = (error instanceof Error) ? error.message : "Failed to generate AI suggestions";
      res.status(500).json({ message: errMsg });
    }
  });

  // Questionnaire Responses
  app.post("/api/questionnaire", requireAuth, async (req, res) => {
    try {
      const userId = getUserId(req);
      const validatedData = insertQuestionnaireResponseSchema.parse(req.body);
      const response = await storage.saveQuestionnaireResponse(validatedData, userId);
      res.status(201).json(response);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid questionnaire data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to save questionnaire response" });
    }
  });

  app.get("/api/questionnaire/:sessionId", requireAuth, async (req, res) => {
    try {
      const userId = getUserId(req);
      const response = await storage.getQuestionnaireResponse(req.params.sessionId, userId);
      if (!response) {
        return res.status(404).json({ message: "Questionnaire response not found" });
      }
      res.json(response);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch questionnaire response" });
    }
  });

  // Task Statistics
  app.get("/api/stats", requireAuth, async (req, res) => {
    try {
      const userId = getUserId(req);
      const userTimezone = ((req.user as User | undefined)?.timezone || "UTC");
      const filters = {
        templateId: req.query.templateId as string,
      };
      const allTasks = await storage.getMaintenanceTasks(userId, filters);
      const todayDateOnly = getTodayDateOnlyInTimezone(userTimezone);
      
      const stats = {
        total: allTasks.length,
        completed: allTasks.filter(t => t.status === 'completed').length,
        pending: allTasks.filter(t => t.status === 'pending').length,
        pastDue: allTasks.filter(t => {
          if (t.status === 'completed') return false;
          if (!t.nextMaintenanceDate) return false;
          
          try {
            const nextMaintenance = typeof t.nextMaintenanceDate === 'string' 
              ? JSON.parse(t.nextMaintenanceDate) 
              : t.nextMaintenanceDate;
            
            const minorDate = normalizeDateOnly(nextMaintenance.minor ?? null);
            const majorDate = normalizeDateOnly(nextMaintenance.major ?? null);
            
            return (
              (minorDate && compareDateOnly(minorDate, todayDateOnly) < 0) ||
              (majorDate && compareDateOnly(majorDate, todayDateOnly) < 0)
            );
          } catch {
            return false;
          }
        }).length,
      };

      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch statistics" });
    }
  });

  // Admin-only AI diagnostics endpoint
  app.get('/api/admin/ai-diagnostics', async (req, res) => {
    try {
      const auth = req.headers.authorization || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
      const adminToken = process.env.ADMIN_TOKEN;
      if (!adminToken || token !== adminToken) {
        return res.status(401).json({ message: 'Unauthorized' });
      }
  const { getDiagnostics } = await import('./services/maintenanceAi');
  const data = getDiagnostics();
      res.json({ diagnostics: data });
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch diagnostics' });
    }
  });

  app.post('/api/admin/ai-diagnostics/clear', async (req, res) => {
    try {
      const auth = req.headers.authorization || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
      const adminToken = process.env.ADMIN_TOKEN;
      if (!adminToken || token !== adminToken) {
        return res.status(401).json({ message: 'Unauthorized' });
      }
      const { clearDiagnostics } = await import('./services/maintenanceAi');
      clearDiagnostics();
      res.json({ cleared: true });
    } catch (error) {
      res.status(500).json({ message: 'Failed to clear diagnostics' });
    }
  });

  // Dev-only: receive client-side debug reports (enabled when DEBUG_CLIENT_REQUESTS=true)
  // Accept any content-type (sendBeacon often sends non-JSON content-type), parse if possible.
  app.post('/__debug/client-log', express.text({ type: '*/*' }), async (req, res) => {
    try {
      let payload: any = {};
      try {
        if (req.body && typeof req.body === 'object') {
          payload = req.body;
        } else if (typeof req.body === 'string' && req.body.trim()) {
          try {
            payload = JSON.parse(req.body);
          } catch (e) {
            payload = { raw: req.body };
          }
        }

        // write to server console and optionally to a file for later review
        logWithLevel('INFO', `[CLIENT-REMOTE] ${JSON.stringify(payload)}`);
        const dbgPath = path.resolve(process.cwd(), 'data', 'debug-client.log');
        try {
          fs.mkdirSync(path.dirname(dbgPath), { recursive: true });
          fs.appendFileSync(dbgPath, `${new Date().toISOString()} ${JSON.stringify(payload)}\n`);
        } catch (e) {
          // ignore file write errors
        }
      } catch (e) {
        // guard logging
      }
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ ok: false });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
