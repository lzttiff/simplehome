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
import { insertMaintenanceTaskSchema, insertQuestionnaireResponseSchema } from "@shared/schema";
import { AISuggestion } from "@shared/aiSuggestion";
import { generateMaintenanceTasks, generateQuickSuggestions } from "./services/openai";
import { generateGeminiContent } from "./services/gemini";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { log } from "console";
import { logWithLevel } from "./services/logWithLevel";
// ...existing imports...
//const __filename = fileURLToPath(import.meta.url);
//const __dirname = path.dirname(__filename);
export async function registerRoutes(app: Express): Promise<Server> {
  // Respond to favicon requests to avoid serving the SPA index for this path
  // which causes the client router to render a 404 page for "/favicon.ico" in the browser.
  app.get('/favicon.ico', (_req, res) => res.status(204).end());

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
      
      // Update stored tasks with AI results
      let updatedCount = 0;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const result = results[i];
        
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
              await storage.updateMaintenanceTask(item.id, updates);
              updatedCount++;
              logWithLevel("INFO", `Updated task ${item.id} (${item.name}) with AI schedule data`);
            }
          } catch (error) {
            logWithLevel("ERROR", `Failed to update task ${item.id}: ${error}`);
          }
        }
      }
      
      logWithLevel("INFO", `Updated ${updatedCount} tasks out of ${items.length} with AI schedule data`);
      res.json({ results, updatedCount });
    } catch (error) {
      console.error("AI schedule error:", error);
      res.status(500).json({ message: "Failed to generate maintenance schedules" });
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
  app.get("/api/tasks", async (req, res) => {
    try {
      const filters = {
        category: req.query.category as string,
        priority: req.query.priority as string,
        status: req.query.status as string,
        search: req.query.search as string,
        templateId: req.query.templateId as string,
      };

      const tasks = await storage.getMaintenanceTasks(filters);
      res.json(tasks);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch tasks" });
    }
  });

  app.get("/api/tasks/:id", async (req, res) => {
    try {
      const task = await storage.getMaintenanceTask(req.params.id);
      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }
      res.json(task);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch task" });
    }
  });

  app.delete("/api/tasks/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteMaintenanceTask(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Task not found" });
      }
      res.json({ message: "Task deleted successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete task" });
    }
  });

  // Create a new maintenance task
  app.post("/api/tasks", async (req, res) => {
    try {
      // Validate request body using the shared Zod schema
      const validated = insertMaintenanceTaskSchema.parse(req.body);
      const created = await storage.createMaintenanceTask(validated as any);
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
  app.patch("/api/tasks/:id", async (req, res) => {
    try {
      const updated = await storage.updateMaintenanceTask(req.params.id, req.body);
      if (!updated) {
        return res.status(404).json({ message: "Task not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Update task error:", error);
      res.status(500).json({ message: "Failed to update task" });
    }
  });

  // AI Task Generation
  app.post("/api/ai/generate-tasks", async (req, res) => {
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

  app.post("/api/ai/quick-suggestions", async (req, res) => {
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
  app.post("/api/questionnaire", async (req, res) => {
    try {
      const validatedData = insertQuestionnaireResponseSchema.parse(req.body);
      const response = await storage.saveQuestionnaireResponse(validatedData);
      res.status(201).json(response);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid questionnaire data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to save questionnaire response" });
    }
  });

  app.get("/api/questionnaire/:sessionId", async (req, res) => {
    try {
      const response = await storage.getQuestionnaireResponse(req.params.sessionId);
      if (!response) {
        return res.status(404).json({ message: "Questionnaire response not found" });
      }
      res.json(response);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch questionnaire response" });
    }
  });

  // Task Statistics
  app.get("/api/stats", async (req, res) => {
    try {
      const allTasks = await storage.getMaintenanceTasks();
      
      const stats = {
        total: allTasks.length,
        completed: allTasks.filter(t => t.status === 'completed').length,
        pending: allTasks.filter(t => t.status === 'pending').length,
        overdue: allTasks.filter(t => {
          if (!t.dueDate || t.status === 'completed') return false;
          return new Date(t.dueDate) < new Date();
        }).length,
        dueSoon: allTasks.filter(t => {
          if (!t.dueDate || t.status === 'completed') return false;
          const dueDate = new Date(t.dueDate);
          const now = new Date();
          const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
          return dueDate >= now && dueDate <= sevenDaysFromNow;
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
