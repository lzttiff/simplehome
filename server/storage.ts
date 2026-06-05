import fs from "fs";
import path from "path";
import { MongoClient, Db, Collection, ObjectId } from "mongodb";
import {
  loadDefaultTemplateSeeds,
  type DefaultTemplateType,
} from "./services/defaultTemplateLoader";
import { 
  type AiProvider,
  type UserUiPreferences,
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
  userUiPreferencesSchema,
} from "@shared/schema";
import { randomUUID, createHash } from "crypto";
import { getMongoUrl } from "./services/runtimeConfig";
import {
  decryptAiUserCredential,
  encryptAiUserCredential,
} from "./services/aiUserCredentialsCrypto";

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
  updateUserAiPreferences(
    id: string,
    updates: { aiProvider?: AiProvider | null; aiAgentEnabled?: boolean; aiPolicyVersion?: string | null },
  ): Promise<User | undefined>;
  getUserUiPreferences(userId: string): Promise<UserUiPreferences>;
  updateUserUiPreferences(userId: string, updates: Partial<UserUiPreferences>): Promise<UserUiPreferences>;
  getUserAiCredentialStatus(userId: string): Promise<{
    hasGeminiApiKey: boolean;
    hasOpenAiApiKey: boolean;
    updatedAt: Date | null;
  }>;
  upsertUserAiCredentials(
    userId: string,
    updates: { geminiApiKey?: string | null; openaiApiKey?: string | null },
  ): Promise<{
    hasGeminiApiKey: boolean;
    hasOpenAiApiKey: boolean;
    updatedAt: Date | null;
  }>;
  getUserAiCredential(userId: string, provider: AiProvider): Promise<string | null>;
  updateUserPassword(id: string, passwordHash: string): Promise<boolean>;
  deleteUserAccountData(userId: string): Promise<{
    deletedQuestionnaireResponses: number;
    deletedTasks: number;
    deletedTemplates: number;
    deletedUsers: number;
  }>;

  // Google Calendar Connections
  getGoogleCalendarConnection(userId: string): Promise<GoogleCalendarConnection | undefined>;
  upsertGoogleCalendarConnection(
    userId: string,
    updates: Partial<Omit<GoogleCalendarConnection, 'userId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<GoogleCalendarConnection>;
  deleteGoogleCalendarConnection(userId: string): Promise<boolean>;
  getGoogleCalendarSyncScope(userId: string): Promise<GoogleCalendarSyncSelection[]>;
  setGoogleCalendarSyncScope(userId: string, selections: GoogleCalendarSyncSelection[]): Promise<GoogleCalendarConnection>;
  // Apple Calendar Connections
  getAppleCalendarConnection(userId: string): Promise<AppleCalendarConnection | undefined>;
  upsertAppleCalendarConnection(
    userId: string,
    updates: Partial<Omit<AppleCalendarConnection, 'userId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<AppleCalendarConnection>;
  deleteAppleCalendarConnection(userId: string): Promise<boolean>;
  getAppleCalendarSyncScope(userId: string): Promise<AppleCalendarSyncSelection[]>;
  setAppleCalendarSyncScope(userId: string, selections: AppleCalendarSyncSelection[]): Promise<AppleCalendarConnection>;
  // Property Templates
  getPropertyTemplates(userId?: string | null): Promise<PropertyTemplate[]>;
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

export interface GoogleCalendarSyncSelection {
  taskId: string;
  includeMinor: boolean;
  includeMajor: boolean;
}

export interface AppleCalendarSyncSelection {
  taskId: string;
  includeMinor: boolean;
  includeMajor: boolean;
}

// MongoDB document types (with _id for MongoDB internal use)
interface MongoPropertyTemplate extends Omit<PropertyTemplate, 'id'> {
  _id?: ObjectId;
  id: string;
  userId: string | null;
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
  uiPreferences?: unknown;
}

interface MongoUserAiCredentials {
  _id?: ObjectId;
  userId: string;
  geminiApiKeyEncrypted: string | null;
  openaiApiKeyEncrypted: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function normalizeAiProvider(value: unknown): AiProvider | null {
  return value === "openai" || value === "gemini" ? value : null;
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
  activeSyncSelections: GoogleCalendarSyncSelection[];
  syncScopeVersion: number;
  syncScopeUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface MongoGoogleCalendarConnection extends Omit<GoogleCalendarConnection, 'userId'> {
  _id?: ObjectId;
  userId: string;
}

export interface AppleCalendarConnection {
  userId: string;
  email: string | null;
  calendarId: string | null;
  resolvedCalendarDisplayName: string | null;
  resolvedCalendarUrl: string | null;
  appSpecificPasswordEncrypted: string | null;
  connectedAt: Date;
  lastSyncedAt: Date | null;
  activeSyncSelections: AppleCalendarSyncSelection[];
  syncScopeVersion: number;
  syncScopeUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface MongoAppleCalendarConnection extends Omit<AppleCalendarConnection, 'userId'> {
  _id?: ObjectId;
  userId: string;
}

function normalizeGoogleSyncSelections(raw: unknown): GoogleCalendarSyncSelection[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((entry) => {
      const selection = entry as Partial<GoogleCalendarSyncSelection>;
      const taskId = typeof selection.taskId === 'string' ? selection.taskId.trim() : '';
      const includeMinor = !!selection.includeMinor;
      const includeMajor = !!selection.includeMajor;
      if (!taskId || (!includeMinor && !includeMajor)) {
        return null;
      }

      return {
        taskId,
        includeMinor,
        includeMajor,
      } satisfies GoogleCalendarSyncSelection;
    })
    .filter((selection): selection is GoogleCalendarSyncSelection => !!selection);
}

function normalizeAppleSyncSelections(raw: unknown): AppleCalendarSyncSelection[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((entry) => {
      const selection = entry as Partial<AppleCalendarSyncSelection>;
      const taskId = typeof selection.taskId === 'string' ? selection.taskId.trim() : '';
      const includeMinor = !!selection.includeMinor;
      const includeMajor = !!selection.includeMajor;
      if (!taskId || (!includeMinor && !includeMajor)) {
        return null;
      }

      return {
        taskId,
        includeMinor,
        includeMajor,
      } satisfies AppleCalendarSyncSelection;
    })
    .filter((selection): selection is AppleCalendarSyncSelection => !!selection);
}

export class MongoDBStorage implements IStorage {
  private client: MongoClient;
  private db!: Db;
  private templatesCollection!: Collection<MongoPropertyTemplate>;
  private tasksCollection!: Collection<MongoMaintenanceTask>;
  private responsesCollection!: Collection<MongoQuestionnaireResponse>;
  private usersCollection!: Collection<MongoUser>;
  private userAiCredentialsCollection!: Collection<MongoUserAiCredentials>;
  private googleCalendarConnectionsCollection!: Collection<MongoGoogleCalendarConnection>;
  private appleCalendarConnectionsCollection!: Collection<MongoAppleCalendarConnection>;
  private initialized = false;

  constructor() {
    const mongoUrl = getMongoUrl() || "mongodb://localhost:27017";
    const dbName = process.env.MONGODB_DB_NAME || "simplehome";
    this.client = new MongoClient(mongoUrl);
    // Note: actual connection happens in initialize()
    this.db = this.client.db(dbName);
    this.templatesCollection = this.db.collection<MongoPropertyTemplate>("property_templates");
    this.tasksCollection = this.db.collection<MongoMaintenanceTask>("maintenance_tasks");
    this.responsesCollection = this.db.collection<MongoQuestionnaireResponse>("questionnaire_responses");
    this.usersCollection = this.db.collection<MongoUser>("users");
    this.userAiCredentialsCollection = this.db.collection<MongoUserAiCredentials>("user_ai_credentials");
    this.googleCalendarConnectionsCollection = this.db.collection<MongoGoogleCalendarConnection>("google_calendar_connections");
    this.appleCalendarConnectionsCollection = this.db.collection<MongoAppleCalendarConnection>("apple_calendar_connections");
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
      await this.userAiCredentialsCollection.createIndex({ userId: 1 }, { unique: true });
      await this.googleCalendarConnectionsCollection.createIndex({ userId: 1 }, { unique: true });
      await this.appleCalendarConnectionsCollection.createIndex({ userId: 1 }, { unique: true });
      
      // Check if we need to seed data
      const templateCount = await this.templatesCollection.countDocuments();
      if (templateCount === 0) {
        await this._seedDefaultData();
      }

      await this._backfillUserDefaultTemplates();
      
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
        userId: null,
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

  private async _ensureTemplateTasksForUserType(args: {
    userId: string;
    type: DefaultTemplateType;
    name: string;
    description: string;
    tasks: InsertMaintenanceTask[];
  }): Promise<void> {
    const { userId, type, name, description, tasks } = args;

    let template = await this.templatesCollection.findOne({ userId, type });
    if (!template) {
      const createdTemplate = await this.createPropertyTemplate({
        userId,
        type,
        name,
        description,
        taskCount: tasks.length,
      });
      template = await this.templatesCollection.findOne({ id: createdTemplate.id });
    }

    if (!template) {
      throw new Error(`Failed to resolve template for user ${userId} and type ${type}`);
    }

    const linkedTaskCount = await this.tasksCollection.countDocuments({
      userId,
      templateId: template.id,
    });

    if (linkedTaskCount > 0) {
      return;
    }

    for (const task of tasks) {
      await this.createMaintenanceTask({ ...task, templateId: template.id }, userId);
    }

    await this.templatesCollection.updateOne(
      { id: template.id },
      { $set: { taskCount: tasks.length } },
    );
  }

  private async _backfillUserDefaultTemplates(): Promise<void> {
    const users = await this.usersCollection
      .find({}, { projection: { id: 1 } })
      .toArray();

    if (users.length === 0) {
      return;
    }

    const seeds = loadDefaultTemplateSeeds();
    for (const user of users) {
      if (!user.id) {
        continue;
      }

      // Legacy users may have global templates + user-owned tasks but no user-scoped templates.
      // Use user-owned tasks as the canonical signal that an account is already initialized.
      const existingUserTaskCount = await this.tasksCollection.countDocuments({ userId: user.id });
      if (existingUserTaskCount > 0) {
        continue;
      }

      for (const seed of seeds) {
        await this._ensureTemplateTasksForUserType({
          userId: user.id,
          type: seed.type,
          name: seed.name,
          description: seed.description,
          tasks: seed.tasks.map(({ task }) => task),
        });
      }
    }
  }

  private toPropertyTemplate(doc: MongoPropertyTemplate): PropertyTemplate {
    return {
      id: doc.id,
      userId: doc.userId ?? null,
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
      overdueBacklog: doc.overdueBacklog ?? null,
      overdueSince: doc.overdueSince ?? null,
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

  private toUser(doc: MongoUser): User {
    return {
      id: doc.id,
      email: doc.email,
      passwordHash: doc.passwordHash,
      name: doc.name,
      timezone: doc.timezone ?? null,
      aiProvider: normalizeAiProvider(doc.aiProvider),
      aiAgentEnabled: doc.aiAgentEnabled === true,
      aiPolicyVersion: typeof doc.aiPolicyVersion === "string" ? doc.aiPolicyVersion : null,
      createdAt: new Date(doc.createdAt),
    };
  }

  async createUser(user: InsertUser & { passwordHash: string }): Promise<User> {
    const newUser: MongoUser = {
      id: randomUUID(),
      email: user.email,
      passwordHash: user.passwordHash,
      name: user.name,
      timezone: user.timezone ?? null,
      aiProvider: null,
      aiAgentEnabled: false,
      aiPolicyVersion: null,
      createdAt: new Date(),
    };

    await this.usersCollection.insertOne(newUser);
    return this.toUser(newUser);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const doc = await this.usersCollection.findOne({ email });
    if (!doc) {
      return undefined;
    }

    return this.toUser(doc);
  }

  async getUserById(id: string): Promise<User | undefined> {
    const doc = await this.usersCollection.findOne({ id });
    if (!doc) {
      return undefined;
    }

    return this.toUser(doc);
  }

  async updateUserProfile(id: string, updates: { name?: string; timezone?: string | null }): Promise<User | undefined> {
    const result = await this.usersCollection.findOneAndUpdate(
      { id },
      { $set: { ...updates } },
      { returnDocument: 'after' },
    );
    if (!result) return undefined;
    return this.toUser(result);
  }

  async updateUserAiPreferences(
    id: string,
    updates: { aiProvider?: AiProvider | null; aiAgentEnabled?: boolean; aiPolicyVersion?: string | null },
  ): Promise<User | undefined> {
    const setUpdates: Record<string, unknown> = {};

    if ("aiProvider" in updates) {
      setUpdates.aiProvider = normalizeAiProvider(updates.aiProvider);
    }
    if ("aiAgentEnabled" in updates) {
      setUpdates.aiAgentEnabled = updates.aiAgentEnabled === true;
    }
    if ("aiPolicyVersion" in updates) {
      setUpdates.aiPolicyVersion =
        typeof updates.aiPolicyVersion === "string" && updates.aiPolicyVersion.trim().length > 0
          ? updates.aiPolicyVersion.trim()
          : null;
    }

    if (Object.keys(setUpdates).length === 0) {
      return this.getUserById(id);
    }

    const result = await this.usersCollection.findOneAndUpdate(
      { id },
      { $set: setUpdates },
      { returnDocument: "after" },
    );

    if (!result) {
      return undefined;
    }

    return this.toUser(result);
  }

  async getUserUiPreferences(userId: string): Promise<UserUiPreferences> {
    const doc = await this.usersCollection.findOne({ id: userId }, { projection: { uiPreferences: 1 } });
    const parsed = userUiPreferencesSchema.safeParse(doc?.uiPreferences ?? {});
    if (parsed.success) {
      return parsed.data;
    }
    return userUiPreferencesSchema.parse({});
  }

  async updateUserUiPreferences(userId: string, updates: Partial<UserUiPreferences>): Promise<UserUiPreferences> {
    const existing = await this.getUserUiPreferences(userId);
    const merged = {
      ...existing,
      ...updates,
    };
    const normalized = userUiPreferencesSchema.parse(merged);
    await this.usersCollection.updateOne({ id: userId }, { $set: { uiPreferences: normalized } });
    return normalized;
  }

  async getUserAiCredentialStatus(userId: string): Promise<{
    hasGeminiApiKey: boolean;
    hasOpenAiApiKey: boolean;
    updatedAt: Date | null;
  }> {
    const doc = await this.userAiCredentialsCollection.findOne(
      { userId },
      { projection: { geminiApiKeyEncrypted: 1, openaiApiKeyEncrypted: 1, updatedAt: 1 } },
    );

    if (!doc) {
      return {
        hasGeminiApiKey: false,
        hasOpenAiApiKey: false,
        updatedAt: null,
      };
    }

    return {
      hasGeminiApiKey: !!doc.geminiApiKeyEncrypted,
      hasOpenAiApiKey: !!doc.openaiApiKeyEncrypted,
      updatedAt: doc.updatedAt ? new Date(doc.updatedAt) : null,
    };
  }

  async upsertUserAiCredentials(
    userId: string,
    updates: { geminiApiKey?: string | null; openaiApiKey?: string | null },
  ): Promise<{
    hasGeminiApiKey: boolean;
    hasOpenAiApiKey: boolean;
    updatedAt: Date | null;
  }> {
    const now = new Date();
    const setUpdates: Record<string, unknown> = {
      updatedAt: now,
    };
    const setOnInsert: Record<string, unknown> = {
      userId,
      createdAt: now,
      geminiApiKeyEncrypted: null,
      openaiApiKeyEncrypted: null,
    };

    if ("geminiApiKey" in updates) {
      const value = typeof updates.geminiApiKey === "string" ? updates.geminiApiKey.trim() : "";
      setUpdates.geminiApiKeyEncrypted = value.length > 0 ? encryptAiUserCredential(value) : null;
    }

    if ("openaiApiKey" in updates) {
      const value = typeof updates.openaiApiKey === "string" ? updates.openaiApiKey.trim() : "";
      setUpdates.openaiApiKeyEncrypted = value.length > 0 ? encryptAiUserCredential(value) : null;
    }

    // MongoDB rejects updates targeting the same path in both $set and $setOnInsert.
    // Keep insert defaults, but drop any keys that are being explicitly updated.
    for (const key of Object.keys(setUpdates)) {
      delete setOnInsert[key];
    }

    await this.userAiCredentialsCollection.updateOne(
      { userId },
      { $set: setUpdates, $setOnInsert: setOnInsert },
      { upsert: true },
    );

    return this.getUserAiCredentialStatus(userId);
  }

  async getUserAiCredential(userId: string, provider: AiProvider): Promise<string | null> {
    const doc = await this.userAiCredentialsCollection.findOne(
      { userId },
      { projection: { geminiApiKeyEncrypted: 1, openaiApiKeyEncrypted: 1 } },
    );

    if (!doc) {
      return null;
    }

    const encrypted = provider === "gemini" ? doc.geminiApiKeyEncrypted : doc.openaiApiKeyEncrypted;
    if (!encrypted) {
      return null;
    }

    return decryptAiUserCredential(encrypted);
  }

  async updateUserPassword(id: string, passwordHash: string): Promise<boolean> {
    const result = await this.usersCollection.updateOne({ id }, { $set: { passwordHash } });
    return result.modifiedCount === 1;
  }

  async deleteUserAccountData(userId: string): Promise<{
    deletedQuestionnaireResponses: number;
    deletedTasks: number;
    deletedTemplates: number;
    deletedUsers: number;
  }> {
    const [responsesResult, tasksResult, templatesResult, usersResult] = await Promise.all([
      this.responsesCollection.deleteMany({ userId }),
      this.tasksCollection.deleteMany({ userId }),
      this.templatesCollection.deleteMany({ userId }),
      this.usersCollection.deleteMany({ id: userId }),
    ]);

    return {
      deletedQuestionnaireResponses: responsesResult.deletedCount,
      deletedTasks: tasksResult.deletedCount,
      deletedTemplates: templatesResult.deletedCount,
      deletedUsers: usersResult.deletedCount,
    };
  }

  async getPropertyTemplates(userId?: string | null): Promise<PropertyTemplate[]> {
    const query: Record<string, unknown> = userId ? { userId } : {};
    const docs = await this.templatesCollection.find(query).toArray();
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
      userId: template.userId ?? null,
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
    const andConditions: any[] = [];

    if (userId) {
      andConditions.push({ userId });
    }

    if (filters) {
      if (filters.category) {
        console.log('Filtering by category:', filters.category);
        andConditions.push({ category: filters.category });
      }
      if (filters.priority) {
        console.log('Filtering by priority:', filters.priority);
        andConditions.push({ priority: filters.priority });
      }
      if (filters.status) {
        console.log('Filtering by status:', filters.status);
        andConditions.push({ status: filters.status });
      }
      if (filters.search) {
        const searchRegex = new RegExp(filters.search, 'i');
        andConditions.push({
          $or: [
            { title: { $regex: searchRegex } },
            { description: { $regex: searchRegex } },
          ],
        });
      }
      if (filters.templateId) {
        console.log('Filtering by templateId:', filters.templateId);
        andConditions.push({ templateId: filters.templateId });
      }
    }

    const query: any =
      andConditions.length === 0
        ? {}
        : andConditions.length === 1
          ? andConditions[0]
          : { $and: andConditions };
    
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
      activeSyncSelections: normalizeGoogleSyncSelections(doc.activeSyncSelections),
      syncScopeVersion: typeof doc.syncScopeVersion === 'number' ? doc.syncScopeVersion : 1,
      syncScopeUpdatedAt: doc.syncScopeUpdatedAt ? new Date(doc.syncScopeUpdatedAt) : null,
      createdAt: new Date(doc.createdAt),
      updatedAt: new Date(doc.updatedAt),
    };
  }

  async upsertGoogleCalendarConnection(
    userId: string,
    updates: Partial<Omit<GoogleCalendarConnection, 'userId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<GoogleCalendarConnection> {
    const now = new Date();

    const setFields: Record<string, unknown> = { updatedAt: now };
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        setFields[key] = value;
      }
    }

    const setOnInsertFields: Record<string, unknown> = {
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
      activeSyncSelections: [],
      syncScopeVersion: 1,
      syncScopeUpdatedAt: null,
      createdAt: now,
    };

    // MongoDB rejects update documents that target the same path in both
    // $set and $setOnInsert. Remove overlapping keys from $setOnInsert.
    for (const key of Object.keys(setFields)) {
      delete setOnInsertFields[key];
    }

    await this.googleCalendarConnectionsCollection.updateOne(
      { userId },
      {
        $set: setFields,
        $setOnInsert: setOnInsertFields,
      },
      { upsert: true },
    );

    const record = await this.getGoogleCalendarConnection(userId);
    if (!record) {
      throw new Error('Failed to persist Google Calendar connection');
    }

    return record;
  }

  async getGoogleCalendarSyncScope(userId: string): Promise<GoogleCalendarSyncSelection[]> {
    const connection = await this.getGoogleCalendarConnection(userId);
    return connection?.activeSyncSelections ?? [];
  }

  async setGoogleCalendarSyncScope(userId: string, selections: GoogleCalendarSyncSelection[]): Promise<GoogleCalendarConnection> {
    const normalized = normalizeGoogleSyncSelections(selections);
    const current = await this.getGoogleCalendarConnection(userId);
    return this.upsertGoogleCalendarConnection(userId, {
      activeSyncSelections: normalized,
      syncScopeVersion: (current?.syncScopeVersion ?? 1) + 1,
      syncScopeUpdatedAt: new Date(),
    });
  }

  async deleteGoogleCalendarConnection(userId: string): Promise<boolean> {
    const result = await this.googleCalendarConnectionsCollection.deleteOne({ userId });
    return result.deletedCount > 0;
  }

  async getAppleCalendarConnection(userId: string): Promise<AppleCalendarConnection | undefined> {
    const doc = await this.appleCalendarConnectionsCollection.findOne({ userId });
    if (!doc) {
      return undefined;
    }

    return {
      userId: doc.userId,
      email: doc.email ?? null,
      calendarId: doc.calendarId ?? null,
      resolvedCalendarDisplayName: doc.resolvedCalendarDisplayName ?? null,
      resolvedCalendarUrl: doc.resolvedCalendarUrl ?? null,
      appSpecificPasswordEncrypted: doc.appSpecificPasswordEncrypted ?? null,
      connectedAt: new Date(doc.connectedAt),
      lastSyncedAt: doc.lastSyncedAt ? new Date(doc.lastSyncedAt) : null,
      activeSyncSelections: normalizeAppleSyncSelections(doc.activeSyncSelections),
      syncScopeVersion: typeof doc.syncScopeVersion === 'number' ? doc.syncScopeVersion : 1,
      syncScopeUpdatedAt: doc.syncScopeUpdatedAt ? new Date(doc.syncScopeUpdatedAt) : null,
      createdAt: new Date(doc.createdAt),
      updatedAt: new Date(doc.updatedAt),
    };
  }

  async upsertAppleCalendarConnection(
    userId: string,
    updates: Partial<Omit<AppleCalendarConnection, 'userId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<AppleCalendarConnection> {
    const now = new Date();

    const setFields: Record<string, unknown> = { updatedAt: now };
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        setFields[key] = value;
      }
    }

    const setOnInsertFields: Record<string, unknown> = {
      userId,
      email: null,
      calendarId: null,
      resolvedCalendarDisplayName: null,
      resolvedCalendarUrl: null,
      appSpecificPasswordEncrypted: null,
      connectedAt: now,
      lastSyncedAt: null,
      activeSyncSelections: [],
      syncScopeVersion: 1,
      syncScopeUpdatedAt: null,
      createdAt: now,
    };

    for (const key of Object.keys(setFields)) {
      delete setOnInsertFields[key];
    }

    await this.appleCalendarConnectionsCollection.updateOne(
      { userId },
      {
        $set: setFields,
        $setOnInsert: setOnInsertFields,
      },
      { upsert: true },
    );

    const record = await this.getAppleCalendarConnection(userId);
    if (!record) {
      throw new Error('Failed to persist Apple Calendar connection');
    }

    return record;
  }

  async getAppleCalendarSyncScope(userId: string): Promise<AppleCalendarSyncSelection[]> {
    const connection = await this.getAppleCalendarConnection(userId);
    return connection?.activeSyncSelections ?? [];
  }

  async setAppleCalendarSyncScope(userId: string, selections: AppleCalendarSyncSelection[]): Promise<AppleCalendarConnection> {
    const normalized = normalizeAppleSyncSelections(selections);
    const current = await this.getAppleCalendarConnection(userId);
    return this.upsertAppleCalendarConnection(userId, {
      activeSyncSelections: normalized,
      syncScopeVersion: (current?.syncScopeVersion ?? 1) + 1,
      syncScopeUpdatedAt: new Date(),
    });
  }

  async deleteAppleCalendarConnection(userId: string): Promise<boolean> {
    const result = await this.appleCalendarConnectionsCollection.deleteOne({ userId });
    return result.deletedCount > 0;
  }

  async getMaintenanceTask(id: string, userId: string | null): Promise<MaintenanceTask | undefined> {
    const query: any = { id };
    if (userId) {
      query.userId = userId;
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
      overdueBacklog: task.overdueBacklog ?? null,
      overdueSince: task.overdueSince ?? null,
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
      query.userId = userId;
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
      query.userId = userId;
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
      { sessionId: response.sessionId, userId: userId ?? null },
      { $set: newResponse },
      { upsert: true }
    );
    
    return this.toQuestionnaireResponse(newResponse);
  }

  async getQuestionnaireResponse(sessionId: string, userId: string | null): Promise<QuestionnaireResponse | undefined> {
    const query: any = { sessionId };
    if (userId) {
      query.userId = userId;
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
