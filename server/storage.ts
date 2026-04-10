import fs from "fs";
import path from "path";
import { MongoClient, Db, Collection, ObjectId } from "mongodb";
import { 
  type PropertyTemplate, 
  type InsertPropertyTemplate,
  type MaintenanceTask,
  type InsertMaintenanceTask,
  type QuestionnaireResponse,
  type InsertQuestionnaireResponse,
  type User,
  type InsertUser,
  parseMaintenanceSchedule,
  serializeMaintenanceSchedule,
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
  // Users
  createUser(user: InsertUser & { passwordHash: string }): Promise<User>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserById(id: string): Promise<User | undefined>;
  updateUserProfile(id: string, updates: { name?: string; timezone?: string | null }): Promise<User | undefined>;

  // Google Calendar Connections
  getGoogleCalendarConnection(userId: string): Promise<GoogleCalendarConnection | undefined>;
  upsertGoogleCalendarConnection(
    userId: string,
    updates: Partial<Omit<GoogleCalendarConnection, 'userId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<GoogleCalendarConnection>;
  deleteGoogleCalendarConnection(userId: string): Promise<boolean>;
  // Property Templates
  getPropertyTemplates(): Promise<PropertyTemplate[]>;
  getPropertyTemplate(id: string): Promise<PropertyTemplate | undefined>;
  createPropertyTemplate(template: InsertPropertyTemplate): Promise<PropertyTemplate>;

  // Maintenance Tasks
  getMaintenanceTasks(userId: string | null, filters?: {
    category?: string;
    priority?: string;
    status?: string;
    search?: string;
    templateId?: string;
  }): Promise<MaintenanceTask[]>;
  getMaintenanceTask(id: string, userId: string | null): Promise<MaintenanceTask | undefined>;
  createMaintenanceTask(task: InsertMaintenanceTask, userId: string | null): Promise<MaintenanceTask>;
  updateMaintenanceTask(id: string, updates: Partial<MaintenanceTask>, userId: string | null): Promise<MaintenanceTask | undefined>;
  deleteMaintenanceTask(id: string, userId: string | null): Promise<boolean>;

  // Questionnaire Responses
  saveQuestionnaireResponse(response: InsertQuestionnaireResponse, userId: string | null): Promise<QuestionnaireResponse>;
  getQuestionnaireResponse(sessionId: string, userId: string | null): Promise<QuestionnaireResponse | undefined>;
  
  // Initialization
  initialize(): Promise<void>;
}

// MongoDB document types (with _id for MongoDB internal use)
interface MongoPropertyTemplate extends Omit<PropertyTemplate, 'id'> {
  _id?: ObjectId;
  id: string;
}

interface MongoMaintenanceTask extends Omit<MaintenanceTask, 'id'> {
  _id?: ObjectId;
  id: string;
}

interface MongoQuestionnaireResponse extends Omit<QuestionnaireResponse, 'id'> {
  _id?: ObjectId;
  id: string;
}

interface MongoUser extends Omit<User, 'id'> {
  _id?: ObjectId;
  id: string;
}

export interface GoogleCalendarConnection {
  userId: string;
  email: string | null;
  calendarId: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  scope: string | null;
  tokenType: string | null;
  expiryDate: number | null;
  connectedAt: Date;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface MongoGoogleCalendarConnection extends Omit<GoogleCalendarConnection, 'userId'> {
  _id?: ObjectId;
  userId: string;
}

export class MongoDBStorage implements IStorage {
  private client: MongoClient;
  private db!: Db;
  private templatesCollection!: Collection<MongoPropertyTemplate>;
  private tasksCollection!: Collection<MongoMaintenanceTask>;
  private responsesCollection!: Collection<MongoQuestionnaireResponse>;
  private usersCollection!: Collection<MongoUser>;
  private googleCalendarConnectionsCollection!: Collection<MongoGoogleCalendarConnection>;
  private initialized = false;

  constructor() {
    const mongoUrl = process.env.MONGODB_URL || process.env.DATABASE_URL || "mongodb://localhost:27017";
    const dbName = process.env.MONGODB_DB_NAME || "simplehome";
    this.client = new MongoClient(mongoUrl);
    // Note: actual connection happens in initialize()
    this.db = this.client.db(dbName);
    this.templatesCollection = this.db.collection<MongoPropertyTemplate>("property_templates");
    this.tasksCollection = this.db.collection<MongoMaintenanceTask>("maintenance_tasks");
    this.responsesCollection = this.db.collection<MongoQuestionnaireResponse>("questionnaire_responses");
    this.usersCollection = this.db.collection<MongoUser>("users");
    this.googleCalendarConnectionsCollection = this.db.collection<MongoGoogleCalendarConnection>("google_calendar_connections");
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    try {
      await this.client.connect();
      console.log("Connected to MongoDB");
      
      // Create indexes for better query performance
      await this.tasksCollection.createIndex({ templateId: 1 });
      await this.tasksCollection.createIndex({ category: 1 });
      await this.tasksCollection.createIndex({ status: 1 });
      await this.tasksCollection.createIndex({ priority: 1 });
      await this.responsesCollection.createIndex({ sessionId: 1 }, { unique: true });
      await this.usersCollection.createIndex({ email: 1 }, { unique: true });
      await this.googleCalendarConnectionsCollection.createIndex({ userId: 1 }, { unique: true });
      
      // Check if we need to seed data
      const templateCount = await this.templatesCollection.countDocuments();
      if (templateCount === 0) {
        await this._seedDefaultData();
      }
      
      this.initialized = true;
    } catch (error) {
      console.error("Failed to connect to MongoDB:", error);
      throw error;
    }
  }

  private async _seedDefaultData(): Promise<void> {
    console.log("Seeding default data...");
    
    // Initialize default templates
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
    
    const templateIdMap = new Map<string, string>();
    for (const template of defaultTemplates) {
      const id = randomUUID();
      templateIdMap.set(template.type, id);
      await this.templatesCollection.insertOne({
        id,
        name: template.name,
        description: template.description,
        type: template.type,
        createdAt: new Date(),
        taskCount: template.taskCount ?? 0,
      });
    }

    // Initialize default tasks
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
      }
    ];

    for (const task of defaultTasks) {
      const id = randomUUID();
      await this.tasksCollection.insertOne({
        ...task,
        userId: null,
        calendarExports: null,
        id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }

  private toPropertyTemplate(doc: MongoPropertyTemplate): PropertyTemplate {
    return {
      id: doc.id,
      name: doc.name,
      type: doc.type,
      description: doc.description,
      taskCount: doc.taskCount ?? 0,
      createdAt: doc.createdAt ? new Date(doc.createdAt) : null,
    };
  }

  private toMaintenanceTask(doc: MongoMaintenanceTask): MaintenanceTask {
    return {
      id: doc.id,
      userId: doc.userId ?? null,
      title: doc.title,
      description: doc.description,
      category: doc.category,
      priority: doc.priority,
      status: doc.status,
      lastMaintenanceDate: doc.lastMaintenanceDate ?? null,
      nextMaintenanceDate: doc.nextMaintenanceDate ?? null,
      isTemplate: doc.isTemplate ?? false,
      isAiGenerated: doc.isAiGenerated ?? false,
      templateId: doc.templateId ?? null,
      notes: doc.notes ?? null,
      brand: doc.brand ?? null,
      model: doc.model ?? null,
      serialNumber: doc.serialNumber ?? null,
      location: doc.location ?? null,
      installationDate: doc.installationDate ? new Date(doc.installationDate) : null,
      warrantyPeriodMonths: doc.warrantyPeriodMonths ?? null,
      minorIntervalMonths: doc.minorIntervalMonths ?? null,
      majorIntervalMonths: doc.majorIntervalMonths ?? null,
      minorTasks: doc.minorTasks ?? null,
      majorTasks: doc.majorTasks ?? null,
      relatedItemIds: doc.relatedItemIds ?? null,
      calendarExports: doc.calendarExports ?? null,
      dueDate: doc.dueDate ? new Date(doc.dueDate) : null,
      createdAt: doc.createdAt ? new Date(doc.createdAt) : null,
      updatedAt: doc.updatedAt ? new Date(doc.updatedAt) : null,
    };
  }

  private toQuestionnaireResponse(doc: MongoQuestionnaireResponse): QuestionnaireResponse {
    return {
      id: doc.id,
      userId: doc.userId ?? null,
      sessionId: doc.sessionId,
      responses: doc.responses,
      propertyType: doc.propertyType,
      createdAt: doc.createdAt ? new Date(doc.createdAt) : null,
    };
  }

  async createUser(user: InsertUser & { passwordHash: string }): Promise<User> {
    const newUser: MongoUser = {
      id: randomUUID(),
      email: user.email,
      passwordHash: user.passwordHash,
      name: user.name,
      timezone: user.timezone ?? null,
      createdAt: new Date(),
    };

    await this.usersCollection.insertOne(newUser);
    return {
      id: newUser.id,
      email: newUser.email,
      passwordHash: newUser.passwordHash,
      name: newUser.name,
      timezone: newUser.timezone ?? null,
      createdAt: newUser.createdAt,
    };
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const doc = await this.usersCollection.findOne({ email });
    if (!doc) {
      return undefined;
    }

    return {
      id: doc.id,
      email: doc.email,
      passwordHash: doc.passwordHash,
      name: doc.name,
      timezone: doc.timezone ?? null,
      createdAt: new Date(doc.createdAt),
    };
  }

  async getUserById(id: string): Promise<User | undefined> {
    const doc = await this.usersCollection.findOne({ id });
    if (!doc) {
      return undefined;
    }

    return {
      id: doc.id,
      email: doc.email,
      passwordHash: doc.passwordHash,
      name: doc.name,
      timezone: doc.timezone ?? null,
      createdAt: new Date(doc.createdAt),
    };
  }

  async updateUserProfile(id: string, updates: { name?: string; timezone?: string | null }): Promise<User | undefined> {
    const result = await this.usersCollection.findOneAndUpdate(
      { id },
      { $set: { ...updates } },
      { returnDocument: 'after' },
    );
    if (!result) return undefined;
    return {
      id: result.id,
      email: result.email,
      passwordHash: result.passwordHash,
      name: result.name,
      timezone: result.timezone ?? null,
      createdAt: new Date(result.createdAt),
    };
  }

  async getPropertyTemplates(): Promise<PropertyTemplate[]> {
    const docs = await this.templatesCollection.find().toArray();
    return docs.map((doc: MongoPropertyTemplate) => this.toPropertyTemplate(doc));
  }

  async getPropertyTemplate(id: string): Promise<PropertyTemplate | undefined> {
    const doc = await this.templatesCollection.findOne({ id });
    return doc ? this.toPropertyTemplate(doc) : undefined;
  }

  async createPropertyTemplate(template: InsertPropertyTemplate): Promise<PropertyTemplate> {
    const id = randomUUID();
    const newTemplate: MongoPropertyTemplate = {
      ...template,
      id,
      createdAt: new Date(),
      taskCount: template.taskCount ?? 0,
    };
    await this.templatesCollection.insertOne(newTemplate);
    return this.toPropertyTemplate(newTemplate);
  }

  async getMaintenanceTasks(userId: string | null, filters?: {
    category?: string;
    priority?: string;
    status?: string;
    search?: string;
    templateId?: string;
  }): Promise<MaintenanceTask[]> {
    const query: any = {};
    
    // Scope to user: show tasks belonging to this user OR system-seeded tasks (userId: null)
    if (userId) {
      query.$or = [{ userId }, { userId: null }, { userId: { $exists: false } }];
    }

    if (filters) {
      if (filters.category) {
        console.log('Filtering by category:', filters.category);
        query.category = filters.category;
      }
      if (filters.priority) {
        console.log('Filtering by priority:', filters.priority);
        query.priority = filters.priority;
      }
      if (filters.status) {
        console.log('Filtering by status:', filters.status);
        query.status = filters.status;
      }
      if (filters.search) {
        const searchRegex = new RegExp(filters.search, 'i');
        query.$or = [
          { title: { $regex: searchRegex } },
          { description: { $regex: searchRegex } }
        ];
      }
      if (filters.templateId) {
        console.log('Filtering by templateId:', filters.templateId);
        query.templateId = filters.templateId;
      }
    }
    
    const docs = await this.tasksCollection.find(query).toArray();
    const tasks = docs.map((doc: MongoMaintenanceTask) => this.toMaintenanceTask(doc));
    
    // Sort: overdue tasks first
    return tasks.sort((a: MaintenanceTask, b: MaintenanceTask) => {
      if (a.status === 'overdue' && b.status !== 'overdue') return -1;
      if (a.status !== 'overdue' && b.status === 'overdue') return 1;
      return 0;
    });
  }


  async getGoogleCalendarConnection(userId: string): Promise<GoogleCalendarConnection | undefined> {
    const doc = await this.googleCalendarConnectionsCollection.findOne({ userId });
    if (!doc) {
      return undefined;
    }

    return {
      userId: doc.userId,
      email: doc.email ?? null,
      calendarId: doc.calendarId ?? null,
      accessToken: doc.accessToken ?? null,
      refreshToken: doc.refreshToken ?? null,
      scope: doc.scope ?? null,
      tokenType: doc.tokenType ?? null,
      expiryDate: doc.expiryDate ?? null,
      connectedAt: new Date(doc.connectedAt),
      lastSyncedAt: doc.lastSyncedAt ? new Date(doc.lastSyncedAt) : null,
      createdAt: new Date(doc.createdAt),
      updatedAt: new Date(doc.updatedAt),
    };
  }

  async upsertGoogleCalendarConnection(
    userId: string,
    updates: Partial<Omit<GoogleCalendarConnection, 'userId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<GoogleCalendarConnection> {
    const now = new Date();

    await this.googleCalendarConnectionsCollection.updateOne(
      { userId },
      {
        $set: {
          ...updates,
          updatedAt: now,
        },
        $setOnInsert: {
          userId,
          email: null,
          calendarId: null,
          accessToken: null,
          refreshToken: null,
          scope: null,
          tokenType: null,
          expiryDate: null,
          connectedAt: now,
          lastSyncedAt: null,
          createdAt: now,
        },
      },
      { upsert: true },
    );

    const record = await this.getGoogleCalendarConnection(userId);
    if (!record) {
      throw new Error('Failed to persist Google Calendar connection');
    }

    return record;
  }

  async deleteGoogleCalendarConnection(userId: string): Promise<boolean> {
    const result = await this.googleCalendarConnectionsCollection.deleteOne({ userId });
    return result.deletedCount > 0;
  }

  async getMaintenanceTask(id: string, userId: string | null): Promise<MaintenanceTask | undefined> {
    const query: any = { id };
    if (userId) {
      query.$or = [{ userId }, { userId: null }, { userId: { $exists: false } }];
    }
    const doc = await this.tasksCollection.findOne(query);
    return doc ? this.toMaintenanceTask(doc) : undefined;
  }

  async createMaintenanceTask(task: InsertMaintenanceTask, userId: string | null): Promise<MaintenanceTask> {
    const id = randomUUID();
    const normalizedLastMaintenanceDate = task.lastMaintenanceDate
      ? serializeMaintenanceSchedule(parseMaintenanceSchedule(task.lastMaintenanceDate))
      : null;
    const normalizedNextMaintenanceDate = task.nextMaintenanceDate
      ? serializeMaintenanceSchedule(parseMaintenanceSchedule(task.nextMaintenanceDate))
      : null;

    const newTask: MongoMaintenanceTask = {
      ...task,
      id,
      userId: userId ?? null,
      status: task.status ?? "pending",
      lastMaintenanceDate: normalizedLastMaintenanceDate,
      nextMaintenanceDate: normalizedNextMaintenanceDate,
      isTemplate: task.isTemplate ?? false,
      isAiGenerated: task.isAiGenerated ?? false,
      templateId: task.templateId ?? null,
      notes: task.notes ?? null,
      brand: task.brand ?? null,
      model: task.model ?? null,
      serialNumber: task.serialNumber ?? null,
      location: task.location ?? null,
      installationDate: task.installationDate ?? null,
      warrantyPeriodMonths: task.warrantyPeriodMonths ?? null,
      minorIntervalMonths: task.minorIntervalMonths ?? null,
      majorIntervalMonths: task.majorIntervalMonths ?? null,
      minorTasks: task.minorTasks ?? null,
      majorTasks: task.majorTasks ?? null,
      relatedItemIds: task.relatedItemIds ?? null,
      calendarExports: task.calendarExports ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    await this.tasksCollection.insertOne(newTask);
    
    // Update task count for template if present
    if (newTask.templateId) {
      await this.templatesCollection.updateOne(
        { id: newTask.templateId },
        { $inc: { taskCount: 1 } }
      );
    }
    
    return this.toMaintenanceTask(newTask);
  }

  async updateMaintenanceTask(id: string, updates: Partial<MaintenanceTask>, userId: string | null): Promise<MaintenanceTask | undefined> {
    const updateData = { ...updates, updatedAt: new Date() };
    if (typeof updateData.lastMaintenanceDate === "string") {
      updateData.lastMaintenanceDate = serializeMaintenanceSchedule(
        parseMaintenanceSchedule(updateData.lastMaintenanceDate),
      );
    }
    if (typeof updateData.nextMaintenanceDate === "string") {
      updateData.nextMaintenanceDate = serializeMaintenanceSchedule(
        parseMaintenanceSchedule(updateData.nextMaintenanceDate),
      );
    }
    delete (updateData as any).id; // Don't update id field
    delete (updateData as any)._id; // Don't update _id field
    
    const query: any = { id };
    if (userId) {
      query.$or = [{ userId }, { userId: null }, { userId: { $exists: false } }];
    }
    
    const result = await this.tasksCollection.findOneAndUpdate(
      query,
      { $set: updateData },
      { returnDocument: 'after' }
    );
    
    return result ? this.toMaintenanceTask(result) : undefined;
  }

  async deleteMaintenanceTask(id: string, userId: string | null): Promise<boolean> {
    // First get the task to check templateId
    const query: any = { id };
    if (userId) {
      query.$or = [{ userId }, { userId: null }, { userId: { $exists: false } }];
    }
    const task = await this.tasksCollection.findOne(query);
    
    const result = await this.tasksCollection.deleteOne(query);
    
    if (result.deletedCount > 0 && task?.templateId) {
      // Decrement task count for template
      await this.templatesCollection.updateOne(
        { id: task.templateId },
        { $inc: { taskCount: -1 } }
      );
    }
    
    return result.deletedCount > 0;
  }

  async saveQuestionnaireResponse(response: InsertQuestionnaireResponse, userId: string | null): Promise<QuestionnaireResponse> {
    const id = randomUUID();
    const newResponse: MongoQuestionnaireResponse = {
      ...response,
      id,
      userId: userId ?? null,
      createdAt: new Date(),
    };
    
    // Use upsert to replace existing response for this session
    await this.responsesCollection.updateOne(
      { sessionId: response.sessionId },
      { $set: newResponse },
      { upsert: true }
    );
    
    return this.toQuestionnaireResponse(newResponse);
  }

  async getQuestionnaireResponse(sessionId: string, userId: string | null): Promise<QuestionnaireResponse | undefined> {
    const query: any = { sessionId };
    if (userId) {
      query.$or = [{ userId }, { userId: null }, { userId: { $exists: false } }];
    }
    const doc = await this.responsesCollection.findOne(query);
    return doc ? this.toQuestionnaireResponse(doc) : undefined;
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

// Create and export singleton storage instance
let storage: IStorage;

// Use MongoDB storage
const mongoStorage = new MongoDBStorage();
storage = mongoStorage;

export { storage };

// Initialize function to be called at app startup
export async function initializeStorage(): Promise<void> {
  if (storage instanceof MongoDBStorage) {
    await storage.initialize();
  }
}
