import { 
  type PropertyTemplate, 
  type InsertPropertyTemplate,
  type MaintenanceTask,
  type InsertMaintenanceTask,
  type QuestionnaireResponse,
  type InsertQuestionnaireResponse
} from "@shared/schema";
import { randomUUID } from "crypto";

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
  private _initializeDefaultTemplates() {
    const defaultTemplates = [
      {
        name: "Single-Family Home",
        type: "single_family",
        description: "Comprehensive maintenance for detached homes with yard, roof, HVAC systems, and exterior care.",
        taskCount: 150
      },
      {
        name: "Apartment/Condo",
        type: "apartment",
        description: "Essential maintenance for unit-specific systems, appliances, and shared responsibility areas.",
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
        category: "HVAC",
        priority: "Urgent",
        status: "pending",
        dueDate: new Date("2024-10-15"),
        lastCompleted: new Date("2024-07-15"),
        completedAt: null,
        nextDue: null,
        isTemplate: true,
        isAiGenerated: false,
        templateId: null,
        notes: null,
        createdAt: null,
        updatedAt: null
      },
      {
        title: "Test Water Pressure",
        description: "Check water pressure in all faucets and showers. Look for leaks or pressure issues.",
        category: "Plumbing",
        priority: "Medium",
        status: "pending",
        dueDate: new Date("2024-10-20"),
        lastCompleted: new Date("2024-04-20"),
        completedAt: null,
        nextDue: null,
        isTemplate: true,
        isAiGenerated: false,
        templateId: null,
        notes: null,
        createdAt: null,
        updatedAt: null
      },
      {
        title: "Clean Gutters",
        description: "Remove debris from gutters and check for proper drainage.",
        category: "Exterior",
        priority: "Medium",
        status: "completed",
        dueDate: null,
        lastCompleted: null,
        completedAt: new Date("2024-10-10"),
        nextDue: new Date("2025-04-10"),
        isTemplate: true,
        isAiGenerated: false,
        templateId: null,
        notes: null,
        createdAt: null,
        updatedAt: null
      },
      {
        title: "Test GFCI Outlets",
        description: "Test all GFCI outlets in bathrooms, kitchen, and outdoor areas for proper function.",
        category: "Electrical",
        priority: "Low",
        status: "pending",
        dueDate: new Date("2024-11-01"),
        lastCompleted: null,
        completedAt: null,
        nextDue: null,
        isTemplate: false,
        isAiGenerated: true,
        templateId: null,
        notes: null,
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
    this._initializeDefaultTemplates();
    this._initializeDefaultTasks();
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
        tasks = tasks.filter(task => task.category === filters.category);
      }
      if (filters.priority) {
        tasks = tasks.filter(task => task.priority === filters.priority);
      }
      if (filters.status) {
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
      dueDate: task.dueDate ?? null,
      completedAt: task.completedAt ?? null,
      lastCompleted: task.lastCompleted ?? null,
      nextDue: task.nextDue ?? null,
      isTemplate: task.isTemplate ?? false,
      isAiGenerated: task.isAiGenerated ?? false,
      templateId: task.templateId ?? null,
      notes: task.notes ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.tasks.set(id, newTask);
    return newTask;
  }

  async updateMaintenanceTask(id: string, updates: Partial<MaintenanceTask>): Promise<MaintenanceTask | undefined> {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    const updatedTask = { ...task, ...updates, updatedAt: new Date() };
    this.tasks.set(id, updatedTask);
    return updatedTask;
  }

  async deleteMaintenanceTask(id: string): Promise<boolean> {
    return this.tasks.delete(id);
  }

  async saveQuestionnaireResponse(response: InsertQuestionnaireResponse): Promise<QuestionnaireResponse> {
    const id = randomUUID();
    const newResponse: QuestionnaireResponse = {
      ...response,
      id,
      createdAt: new Date(),
    };
    this.responses.set(response.sessionId, newResponse);
    return newResponse;
  }

  async getQuestionnaireResponse(sessionId: string): Promise<QuestionnaireResponse | undefined> {
    return this.responses.get(sessionId);
  }
}

export const storage = new MemStorage();
