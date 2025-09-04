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
  private templates: Map<string, PropertyTemplate>;
  private tasks: Map<string, MaintenanceTask>;
  private responses: Map<string, QuestionnaireResponse>;

  constructor() {
    this.templates = new Map();
    this.tasks = new Map();
    this.responses = new Map();
    this.initializeDefaultTemplates();
    this.initializeDefaultTasks();
  }

  private initializeDefaultTemplates() {
    const defaultTemplates = [
      {
        name: "Single-Family Home",
        type: "single_family",
        description: "Comprehensive maintenance for detached homes with yard, roof, HVAC systems, and exterior care.",
        taskCount: 150,
      },
      {
        name: "Apartment/Condo",
        type: "apartment",
        description: "Essential maintenance for unit-specific systems, appliances, and shared responsibility areas.",
        taskCount: 80,
      },
      {
        name: "Townhouse",
        type: "townhouse",
        description: "Balanced maintenance for attached homes with shared walls and individual system responsibilities.",
        taskCount: 120,
      },
      {
        name: "Commercial Building",
        type: "commercial",
        description: "Professional maintenance schedules for office spaces, retail, and commercial properties.",
        taskCount: 200,
      },
      {
        name: "Rental Property",
        type: "rental",
        description: "Landlord-focused maintenance with tenant safety priorities and investment protection.",
        taskCount: 110,
      }
    ];

    defaultTemplates.forEach(template => {
      const id = randomUUID();
      const fullTemplate: PropertyTemplate = {
        id,
        ...template,
        createdAt: new Date(),
      };
      this.templates.set(id, fullTemplate);
    });
  }

  private initializeDefaultTasks() {
    const defaultTasks = [
      {
        title: "Replace HVAC Filter",
        description: "Check and replace air filter in main HVAC unit. Recommended every 1-3 months.",
        category: "HVAC",
        priority: "Urgent",
        status: "pending",
        dueDate: new Date("2024-10-15"),
        lastCompleted: new Date("2024-07-15"),
        isTemplate: true,
        isAiGenerated: false,
      },
      {
        title: "Test Water Pressure",
        description: "Check water pressure in all faucets and showers. Look for leaks or pressure issues.",
        category: "Plumbing",
        priority: "Medium",
        status: "pending",
        dueDate: new Date("2024-10-20"),
        lastCompleted: new Date("2024-04-20"),
        isTemplate: true,
        isAiGenerated: false,
      },
      {
        title: "Clean Gutters",
        description: "Remove debris from gutters and check for proper drainage.",
        category: "Exterior",
        priority: "Medium",
        status: "completed",
        completedAt: new Date("2024-10-10"),
        nextDue: new Date("2025-04-10"),
        isTemplate: true,
        isAiGenerated: false,
      },
      {
        title: "Test GFCI Outlets",
        description: "Test all GFCI outlets in bathrooms, kitchen, and outdoor areas for proper function.",
        category: "Electrical",
        priority: "Low",
        status: "pending",
        dueDate: new Date("2024-11-01"),
        isTemplate: false,
        isAiGenerated: true,
      }
    ];

    defaultTasks.forEach(task => {
      const id = randomUUID();
      const fullTask: MaintenanceTask = {
        id,
        ...task,
        templateId: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.tasks.set(id, fullTask);
    });
  }

  async getPropertyTemplates(): Promise<PropertyTemplate[]> {
    return Array.from(this.templates.values());
  }

  async getPropertyTemplate(id: string): Promise<PropertyTemplate | undefined> {
    return this.templates.get(id);
  }

  async createPropertyTemplate(insertTemplate: InsertPropertyTemplate): Promise<PropertyTemplate> {
    const id = randomUUID();
    const template: PropertyTemplate = {
      ...insertTemplate,
      id,
      createdAt: new Date(),
    };
    this.templates.set(id, template);
    return template;
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
      if (b.status === 'overdue' && a.status !== 'overdue') return 1;
      if (a.priority === 'Urgent' && b.priority !== 'Urgent') return -1;
      if (b.priority === 'Urgent' && a.priority !== 'Urgent') return 1;
      return new Date(a.dueDate || 0).getTime() - new Date(b.dueDate || 0).getTime();
    });
  }

  async getMaintenanceTask(id: string): Promise<MaintenanceTask | undefined> {
    return this.tasks.get(id);
  }

  async createMaintenanceTask(insertTask: InsertMaintenanceTask): Promise<MaintenanceTask> {
    const id = randomUUID();
    const task: MaintenanceTask = {
      ...insertTask,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.tasks.set(id, task);
    return task;
  }

  async updateMaintenanceTask(id: string, updates: Partial<MaintenanceTask>): Promise<MaintenanceTask | undefined> {
    const task = this.tasks.get(id);
    if (!task) return undefined;

    const updatedTask: MaintenanceTask = {
      ...task,
      ...updates,
      updatedAt: new Date(),
    };
    this.tasks.set(id, updatedTask);
    return updatedTask;
  }

  async deleteMaintenanceTask(id: string): Promise<boolean> {
    return this.tasks.delete(id);
  }

  async saveQuestionnaireResponse(insertResponse: InsertQuestionnaireResponse): Promise<QuestionnaireResponse> {
    const id = randomUUID();
    const response: QuestionnaireResponse = {
      ...insertResponse,
      id,
      createdAt: new Date(),
    };
    this.responses.set(insertResponse.sessionId, response);
    return response;
  }

  async getQuestionnaireResponse(sessionId: string): Promise<QuestionnaireResponse | undefined> {
    return this.responses.get(sessionId);
  }
}

export const storage = new MemStorage();
