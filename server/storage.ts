import fs from "fs";
import path from "path";
import { 
  type PropertyTemplate, 
  type InsertPropertyTemplate,
  type MaintenanceTask,
  type InsertMaintenanceTask,
  type QuestionnaireResponse,
  type InsertQuestionnaireResponse
} from "@shared/schema";
import { randomUUID, createHash } from "crypto";

// Generate deterministic UUID v5-like ID from a namespace and name
function deterministicUUID(namespace: string, name: string): string {
  const hash = createHash('sha1').update(`${namespace}:${name}`).digest();
  // Set version (5) and variant bits per UUID v5 spec
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
}

export interface IStorage {
  // Property Templates
  getPropertyTemplates(): Promise<PropertyTemplate[]>;
  getPropertyTemplate(id: string): Promise<PropertyTemplate | undefined>;
  createPropertyTemplate(template: InsertPropertyTemplate): Promise<PropertyTemplate>;

  // Maintenance Tasks
  getMaintenanceTasks(filters?: {
    category?: string;
    priority?: string;
    status?: string;
    search?: string;
    templateId?: string;
  }): Promise<MaintenanceTask[]>;
  getMaintenanceTask(id: string): Promise<MaintenanceTask | undefined>;
  createMaintenanceTask(task: InsertMaintenanceTask): Promise<MaintenanceTask>;
  updateMaintenanceTask(id: string, updates: Partial<MaintenanceTask>): Promise<MaintenanceTask | undefined>;
  deleteMaintenanceTask(id: string): Promise<boolean>;

  // Questionnaire Responses
  saveQuestionnaireResponse(response: InsertQuestionnaireResponse): Promise<QuestionnaireResponse>;
  getQuestionnaireResponse(sessionId: string): Promise<QuestionnaireResponse | undefined>;
}

export class MemStorage implements IStorage {
  private readonly dataDir = path.join(process.cwd(), "data");
  private readonly dataFile = path.join(this.dataDir, "storage.json");
  private _initializeDefaultTemplates() {
    const defaultTemplates = [
      {
        name: "Single-Family Home",
        type: "single_family",
        description: "Comprehensive maintenance for detached homes with yard, roof, HVAC systems, and exterior care.",
        taskCount: 150
      },
      {
        name: "Condo",
        type: "condo",
        description: "Essential maintenance for condo owners covering unit-specific systems, appliances, and shared building responsibilities.",
        taskCount: 80
      },
      {
        name: "Townhouse",
        type: "townhouse",
        description: "Balanced maintenance for attached homes with shared walls and individual system responsibilities.",
        taskCount: 120
      },
      {
        name: "Commercial Building",
        type: "commercial",
        description: "Professional maintenance schedules for office spaces, retail, and commercial properties.",
        taskCount: 200
      },
      {
        name: "Rental Property",
        type: "rental",
        description: "Landlord-focused maintenance with tenant safety priorities and investment protection.",
        taskCount: 110
      }
    ];
    defaultTemplates.forEach(template => {
      const id = randomUUID();
      const fullTemplate: PropertyTemplate = {
        id,
        name: template.name,
        description: template.description,
        type: template.type,
        createdAt: new Date(),
        taskCount: template.taskCount ?? 0,
      };
      this.templates.set(id, fullTemplate);
    });
  }

  private _initializeDefaultTasks() {
    const defaultTasks = [
      {
        title: "Replace HVAC Filter",
        description: "Check and replace air filter in main HVAC unit. Recommended every 1-3 months.",
        category: "HVAC & Mechanical",
        priority: "Urgent",
        status: "pending",
        lastMaintenanceDate: JSON.stringify({ minor: "2024-07-15", major: null }),
        nextMaintenanceDate: JSON.stringify({ minor: "2024-10-15", major: null }),
        isTemplate: true,
        isAiGenerated: false,
        templateId: null,
        notes: null,
        brand: null,
        model: null,
        serialNumber: null,
        location: null,
        installationDate: null,
        warrantyPeriodMonths: null,
        minorIntervalMonths: 3,
        majorIntervalMonths: 12,
        minorTasks: null,
        majorTasks: null,
        relatedItemIds: null,
        createdAt: null,
        updatedAt: null
      },
      {
        title: "Test Water Pressure",
        description: "Check water pressure in all faucets and showers. Look for leaks or pressure issues.",
        category: "Plumbing & Water",
        priority: "Medium",
        status: "pending",
        lastMaintenanceDate: JSON.stringify({ minor: "2024-04-20", major: null }),
        nextMaintenanceDate: JSON.stringify({ minor: "2024-10-20", major: null }),
        isTemplate: true,
        isAiGenerated: false,
        templateId: null,
        notes: null,
        brand: null,
        model: null,
        serialNumber: null,
        location: null,
        installationDate: null,
        warrantyPeriodMonths: null,
        minorIntervalMonths: 6,
        majorIntervalMonths: null,
        minorTasks: null,
        majorTasks: null,
        relatedItemIds: null,
        createdAt: null,
        updatedAt: null
      },
      {
        title: "Clean Gutters",
        description: "Remove debris from gutters and check for proper drainage.",
        category: "Structural & Exterior",
        priority: "Medium",
        status: "completed",
        lastMaintenanceDate: JSON.stringify({ minor: "2024-10-10", major: null }),
        nextMaintenanceDate: JSON.stringify({ minor: "2025-04-10", major: null }),
        isTemplate: true,
        isAiGenerated: false,
        templateId: null,
        notes: null,
        brand: null,
        model: null,
        serialNumber: null,
        location: null,
        installationDate: null,
        warrantyPeriodMonths: null,
        minorIntervalMonths: 6,
        majorIntervalMonths: 12,
        minorTasks: null,
        majorTasks: null,
        relatedItemIds: null,
        createdAt: null,
        updatedAt: null
      },
      {
        title: "Test GFCI Outlets",
        description: "Test all GFCI outlets in bathrooms, kitchen, and outdoor areas for proper function.",
        category: "Electrical & Lighting",
        priority: "Low",
        status: "pending",
        lastMaintenanceDate: null,
        nextMaintenanceDate: JSON.stringify({ minor: "2024-11-01", major: null }),
        isTemplate: false,
        isAiGenerated: true,
        templateId: null,
        notes: null,
        brand: null,
        model: null,
        serialNumber: null,
        location: null,
        installationDate: null,
        warrantyPeriodMonths: null,
        minorIntervalMonths: 12,
        majorIntervalMonths: null,
        minorTasks: null,
        majorTasks: null,
        relatedItemIds: null,
        createdAt: null,
        updatedAt: null
      }
    ];
    defaultTasks.forEach(task => {
      const id = randomUUID();
      const fullTask: MaintenanceTask = {
        ...task,
        id,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.tasks.set(id, fullTask);
    });
  }
  private templates: Map<string, PropertyTemplate>;
  private tasks: Map<string, MaintenanceTask>;
  private responses: Map<string, QuestionnaireResponse>;

  constructor() {
    this.templates = new Map();
    this.tasks = new Map();
    this.responses = new Map();
    // Try to load persisted state first. If present, restore it and skip seeding.
    if (!this._loadPersisted()) {
      this._initializeDefaultTemplates();
      this._initializeDefaultTasks();
      // Seed template-specific tasks from bundled JSON templates (if available)
    // This makes the full template item lists (single-family and commercial)
    // visible in the UI when a template is selected.
      try {
        const sf = path.join(process.cwd(), "maintenance-template-singleFamilyHome.json");
        this._normalizeTemplateFile(sf);
        this._seedTemplateTasksFromFile("single_family", sf);
      } catch (e) {
        // ignore failures during seeding
      }
    try {
        const cm = path.join(process.cwd(), "maintenance-template-commercial.json");
        this._normalizeTemplateFile(cm);
        this._seedTemplateTasksFromFile("commercial", cm);
    } catch (e) {
      // ignore failures during seeding
    }
      try {
        const ap = path.join(process.cwd(), "maintenance-template-condo.json");
        this._normalizeTemplateFile(ap);
        this._seedTemplateTasksFromFile("condo", ap);
      } catch (e) {
        // ignore failures during seeding
      }
      try {
        const th = path.join(process.cwd(), "maintenance-template-townhouse.json");
        this._normalizeTemplateFile(th);
        this._seedTemplateTasksFromFile("townhouse", th);
      } catch (e) {
        // ignore failures during seeding
      }
      try {
        const rt = path.join(process.cwd(), "maintenance-template-rental.json");
        this._normalizeTemplateFile(rt);
        this._seedTemplateTasksFromFile("rental", rt);
      } catch (e) {
        // ignore failures during seeding
      }

      // After seeding, update task counts and persist initial state
      this._recalculateTaskCounts();
      this._persist();
    }
    try {
      this._seedTemplateTasksFromFile("condo", path.join(process.cwd(), "maintenance-template-condo.json"));
    } catch (e) {
      // ignore failures during seeding
    }
    try {
      this._seedTemplateTasksFromFile("townhouse", path.join(process.cwd(), "maintenance-template-townhouse.json"));
    } catch (e) {
      // ignore failures during seeding
    }
    try {
      this._seedTemplateTasksFromFile("rental", path.join(process.cwd(), "maintenance-template-rental.json"));
    } catch (e) {
      // ignore failures during seeding
    }
  }

  private _seedTemplateTasksFromFile(templateType: string, filePath: string) {
    if (!fs.existsSync(filePath)) return;
    let raw = fs.readFileSync(filePath, "utf-8");
    let json: any;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      return;
    }
    const householdCatalog = json.householdCatalog || [];
    const template = Array.from(this.templates.values()).find(t => t.type === templateType);
    if (!template) return;

    householdCatalog.forEach((category: any) => {
      const catName = category.categoryName || category.category || "General";
      const items = Array.isArray(category.items) ? category.items : [];
      items.forEach((item: any) => {
        // Ensure the item id is a UUID. If the file provides a valid uuid, use it;
        // otherwise generate a new one. This keeps template files tolerant.
        const isUuid = (s: string) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
        const id = isUuid(item.id) ? item.id : randomUUID();
        
        // Parse dates
        const parseDate = (dateStr: any) => {
          if (!dateStr) return null;
          if (dateStr instanceof Date) return dateStr;
          if (typeof dateStr === 'string') return new Date(dateStr);
          return null;
        };
        
        const newTask: MaintenanceTask = {
          id,
          title: item.name || "Untitled",
          description: item.description || item.notes || "",
          category: catName,
          priority: item.priority || "Medium",
          status: "pending",
          lastMaintenanceDate: item.lastMaintenanceDate ? JSON.stringify(item.lastMaintenanceDate) : null,
          nextMaintenanceDate: item.nextMaintenanceDate ? JSON.stringify(item.nextMaintenanceDate) : null,
          isTemplate: true,
          isAiGenerated: false,
          templateId: template.id,
          notes: item.notes ?? null,
          // Additional schema fields
          brand: item.brand ?? null,
          model: item.model ?? null,
          serialNumber: item.serialNumber ?? null,
          location: item.location ?? null,
          installationDate: parseDate(item.installationDate),
          warrantyPeriodMonths: item.warrantyPeriodMonths ?? null,
          minorIntervalMonths: item.maintenanceSchedule?.minorIntervalMonths ?? null,
          majorIntervalMonths: item.maintenanceSchedule?.majorIntervalMonths ?? null,
          minorTasks: item.maintenanceSchedule?.minorTasks ? JSON.stringify(item.maintenanceSchedule.minorTasks) : null,
          majorTasks: item.maintenanceSchedule?.majorTasks ? JSON.stringify(item.maintenanceSchedule.majorTasks) : null,
          relatedItemIds: item.relatedItemIds ? JSON.stringify(item.relatedItemIds) : null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as MaintenanceTask;
        this.tasks.set(id, newTask);
      });
    });
    // update the template's taskCount to reflect seeded items
    const seededCount = Array.from(this.tasks.values()).filter(t => t.templateId === template.id).length;
    template.taskCount = seededCount;
  }

  private _normalizeTemplateFile(filePath: string) {
    try {
      if (!fs.existsSync(filePath)) return;
      const raw = fs.readFileSync(filePath, 'utf-8');
      const json = JSON.parse(raw);
      const householdCatalog = json.householdCatalog || [];
      let changed = false;
      const isUuid = (s: string) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
      householdCatalog.forEach((category: any) => {
        const items = Array.isArray(category.items) ? category.items : [];
        items.forEach((item: any) => {
          if (!isUuid(item.id)) {
            item.id = randomUUID();
            changed = true;
          }
        });
      });
      if (changed) {
        fs.writeFileSync(filePath, JSON.stringify(json, null, 2), 'utf-8');
      }
    } catch (e) {
      // ignore errors normalizing template files
    }
  }

  private _recalculateTaskCounts() {
    const counts: Record<string, number> = {};
    Array.from(this.tasks.values()).forEach((t) => {
      if (t.templateId) counts[t.templateId] = (counts[t.templateId] || 0) + 1;
    });
    Array.from(this.templates.values()).forEach((template) => {
      template.taskCount = counts[template.id] || 0;
    });
  }

  private _loadPersisted(): boolean {
    try {
      if (!fs.existsSync(this.dataFile)) return false;
      const raw = fs.readFileSync(this.dataFile, 'utf-8');
      const parsed = JSON.parse(raw);
      // restore templates (legacy persisted shape)
      if (Array.isArray(parsed.templates) && parsed.templates.length > 0) {
        parsed.templates.forEach((t: any) => {
          const tpl: PropertyTemplate = {
            id: t.id,
            name: t.name,
            description: t.description,
            type: t.type,
            createdAt: new Date(t.createdAt),
            taskCount: t.taskCount ?? 0,
          };
          this.templates.set(tpl.id, tpl);
        });
      } else if (Array.isArray(parsed.householdCatalog) && parsed.householdCatalog.length > 0) {
        // new schema shape: build templates from householdCatalog entries
        const nameToType: Record<string, string> = {
          'single-family home': 'single_family',
          'condo': 'condo',
          'townhouse': 'townhouse',
          'commercial building': 'commercial',
          'rental property': 'rental',
        };
        parsed.householdCatalog.forEach((entry: any) => {
          const name = entry.categoryName || entry.category || 'Property';
          const key = String(name).toLowerCase();
          const type = nameToType[key] ?? String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_');
          // Use deterministic ID based on type for consistency
          const id = deterministicUUID('simplehome-template', type);
          const tpl: PropertyTemplate = {
            id,
            name,
            description: entry.description ?? `Template generated from householdCatalog: ${name}`,
            type,
            createdAt: new Date(),
            taskCount: Array.isArray(entry.items) ? entry.items.length : 0,
          };
          this.templates.set(id, tpl);
        });
      }
      // restore tasks (legacy persisted shape)
      if (Array.isArray(parsed.tasks) && parsed.tasks.length > 0) {
        parsed.tasks.forEach((tk: any) => {
          const task: MaintenanceTask = {
            ...tk,
            createdAt: tk.createdAt ? new Date(tk.createdAt) : new Date(),
            updatedAt: tk.updatedAt ? new Date(tk.updatedAt) : new Date(),
          } as MaintenanceTask;
          this.tasks.set(task.id, task);
        });
      } else if (Array.isArray(parsed.householdCatalog) && parsed.householdCatalog.length > 0) {
        // create template tasks from householdCatalog if tasks are not present
        // try to match templates by name -> type mapping created above
        const templatesByName = new Map<string, PropertyTemplate>();
        Array.from(this.templates.values()).forEach(t => templatesByName.set(t.name, t));
        parsed.householdCatalog.forEach((category: any) => {
          const catName = category.categoryName || category.category || 'General';
          const items = Array.isArray(category.items) ? category.items : [];
          const template = templatesByName.get(catName);
          const templateId = template ? template.id : undefined;
          items.forEach((item: any) => {
            const isUuid = (s: string) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
            const id = isUuid(item.id) ? item.id : randomUUID();
            
            // Parse dates from schema format
            const parseDate = (dateStr: any) => {
              if (!dateStr) return null;
              if (dateStr instanceof Date) return dateStr;
              if (typeof dateStr === 'string') return new Date(dateStr);
              return null;
            };
            
            const newTask: MaintenanceTask = {
              id,
              title: item.name || 'Untitled',
              description: item.description || item.notes || '',
              category: catName,
              priority: item.priority || 'Medium',
              status: 'pending',
              lastMaintenanceDate: item.lastMaintenanceDate ? JSON.stringify(item.lastMaintenanceDate) : null,
              nextMaintenanceDate: item.nextMaintenanceDate ? JSON.stringify(item.nextMaintenanceDate) : null,
              isTemplate: true,
              isAiGenerated: false,
              templateId: templateId ?? null,
              notes: item.notes ?? null,
              // Additional schema fields
              brand: item.brand ?? null,
              model: item.model ?? null,
              serialNumber: item.serialNumber ?? null,
              location: item.location ?? null,
              installationDate: parseDate(item.installationDate),
              warrantyPeriodMonths: item.warrantyPeriodMonths ?? null,
              minorIntervalMonths: item.maintenanceSchedule?.minorIntervalMonths ?? null,
              majorIntervalMonths: item.maintenanceSchedule?.majorIntervalMonths ?? null,
              relatedItemIds: item.relatedItemIds ? JSON.stringify(item.relatedItemIds) : null,
              createdAt: new Date(),
              updatedAt: new Date(),
            } as MaintenanceTask;
            this.tasks.set(id, newTask);
          });
        });
      }
      // restore responses
      if (parsed.responses && typeof parsed.responses === 'object') {
        Object.values(parsed.responses).forEach((r: any) => {
          const resp: QuestionnaireResponse = {
            ...r,
            createdAt: r.createdAt ? new Date(r.createdAt) : new Date(),
          } as QuestionnaireResponse;
          this.responses.set(resp.sessionId, resp);
        });
      }
      // ensure task counts match
      this._recalculateTaskCounts();
      return true;
    } catch (e) {
      return false;
    }
  }

  private _persist() {
    try {
      if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
      const out = {
        templates: Array.from(this.templates.values()),
        tasks: Array.from(this.tasks.values()),
        responses: Object.fromEntries(Array.from(this.responses.entries()).map(([k, v]) => [k, v])),
      };
      fs.writeFileSync(this.dataFile, JSON.stringify(out, null, 2), 'utf-8');
    } catch (e) {
      // ignore persistence failures to avoid crashing the server
      console.error('Failed to persist storage:', e);
    }
  }
  async getPropertyTemplates(): Promise<PropertyTemplate[]> {
    return Array.from(this.templates.values());
  }

  async getPropertyTemplate(id: string): Promise<PropertyTemplate | undefined> {
    return this.templates.get(id);
  }

  async createPropertyTemplate(template: InsertPropertyTemplate): Promise<PropertyTemplate> {
    const id = randomUUID();
    const newTemplate: PropertyTemplate = {
      ...template,
      id,
      createdAt: new Date(),
      taskCount: template.taskCount ?? 0,
    };
    this.templates.set(id, newTemplate);
    this._persist();
    return newTemplate;
  }

  async getMaintenanceTasks(filters?: {
    category?: string;
    priority?: string;
    status?: string;
    search?: string;
    templateId?: string;
  }): Promise<MaintenanceTask[]> {
    let tasks = Array.from(this.tasks.values());
    if (filters) {
      if (filters.category) {
        console.log('Filtering by category:', filters.category);
        tasks = tasks.filter(task => task.category === filters.category);
      }
      if (filters.priority) {
        console.log('Filtering by priority:', filters.priority);
        tasks = tasks.filter(task => task.priority === filters.priority);
      }
      if (filters.status) {
        console.log('Filtering by status:', filters.status);
        tasks = tasks.filter(task => task.status === filters.status);
      }
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        tasks = tasks.filter(task =>
          task.title.toLowerCase().includes(searchLower) ||
          task.description.toLowerCase().includes(searchLower)
        );
      }
      if (filters.templateId) {
        console.log('Filtering by templateId:', filters.templateId);
        tasks = tasks.filter(task => task.templateId === filters.templateId);
      }
    }
    return tasks.sort((a, b) => {
      if (a.status === 'overdue' && b.status !== 'overdue') return -1;
      if (a.status !== 'overdue' && b.status === 'overdue') return 1;
      return 0;
    });
  }

  async getMaintenanceTask(id: string): Promise<MaintenanceTask | undefined> {
    return this.tasks.get(id);
  }

  async createMaintenanceTask(task: InsertMaintenanceTask): Promise<MaintenanceTask> {
    const id = randomUUID();
    const newTask: MaintenanceTask = {
      ...task,
      id,
      status: task.status ?? "pending",
      lastMaintenanceDate: task.lastMaintenanceDate ?? null,
      nextMaintenanceDate: task.nextMaintenanceDate ?? null,
      isTemplate: task.isTemplate ?? false,
      isAiGenerated: task.isAiGenerated ?? false,
      templateId: task.templateId ?? null,
      notes: task.notes ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.tasks.set(id, newTask);
    // update task count for template if present
    if (newTask.templateId) {
      const tpl = this.templates.get(newTask.templateId);
      if (tpl) tpl.taskCount = (tpl.taskCount || 0) + 1;
    }
    this._persist();
    return newTask;
  }

  async updateMaintenanceTask(id: string, updates: Partial<MaintenanceTask>): Promise<MaintenanceTask | undefined> {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    const updatedTask = { ...task, ...updates, updatedAt: new Date() };
    this.tasks.set(id, updatedTask);
    this._persist();
    return updatedTask;
  }

  async deleteMaintenanceTask(id: string): Promise<boolean> {
    const existed = this.tasks.delete(id);
    if (existed) this._persist();
    return existed;
  }

  async saveQuestionnaireResponse(response: InsertQuestionnaireResponse): Promise<QuestionnaireResponse> {
    const id = randomUUID();
    const newResponse: QuestionnaireResponse = {
      ...response,
      id,
      createdAt: new Date(),
    };
    this.responses.set(response.sessionId, newResponse);
    this._persist();
    return newResponse;
  }

  async getQuestionnaireResponse(sessionId: string): Promise<QuestionnaireResponse | undefined> {
    return this.responses.get(sessionId);
  }
}

export const storage = new MemStorage();
