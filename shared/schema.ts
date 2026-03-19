import { z } from "zod";

// Pure TypeScript types - MongoDB handles validation via JSON Schema
// See shared/schemas/*.schema.json for MongoDB validation schemas

// User Types
export interface User {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  createdAt: Date;
}

export interface InsertUser {
  email: string;
  password: string;
  name: string;
}

// Property Template Types
export interface PropertyTemplate {
  id: string;
  name: string;
  type: string;
  description: string;
  taskCount: number | null;
  createdAt: Date | null;
}

export interface InsertPropertyTemplate {
  name: string;
  type: string;
  description: string;
  taskCount?: number | null;
}

// Maintenance Task Types
export interface MaintenanceTask {
  id: string;
  userId: string | null;
  title: string;
  description: string;
  category: string;
  priority: string; // Low, Medium, High, Urgent
  status: string; // pending, completed, overdue
  lastMaintenanceDate: string | null; // JSON: {minor: date|null, major: date|null}
  nextMaintenanceDate: string | null; // JSON: {minor: date|null, major: date|null}
  isTemplate: boolean | null;
  isAiGenerated: boolean | null;
  templateId: string | null;
  notes: string | null;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  location: string | null;
  installationDate: Date | null;
  warrantyPeriodMonths: number | null;
  minorIntervalMonths: number | null;
  majorIntervalMonths: number | null;
  minorTasks: string | null; // JSON array stored as text
  majorTasks: string | null; // JSON array stored as text
  relatedItemIds: string | null; // JSON array stored as text
  dueDate?: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface InsertMaintenanceTask {
  userId?: string | null;
  title: string;
  description: string;
  category: string;
  priority: string;
  status?: string;
  lastMaintenanceDate?: string | null;
  nextMaintenanceDate?: string | null;
  isTemplate?: boolean | null;
  isAiGenerated?: boolean | null;
  templateId?: string | null;
  notes?: string | null;
  brand?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  location?: string | null;
  installationDate?: Date | null;
  warrantyPeriodMonths?: number | null;
  minorIntervalMonths?: number | null;
  majorIntervalMonths?: number | null;
  minorTasks?: string | null;
  majorTasks?: string | null;
  relatedItemIds?: string | null;
  dueDate?: Date | null;
}

// Questionnaire Response Types
export interface QuestionnaireResponse {
  id: string;
  userId: string | null;
  sessionId: string;
  responses: string; // JSON string
  propertyType: string;
  createdAt: Date | null;
}

export interface InsertQuestionnaireResponse {
  userId?: string | null;
  sessionId: string;
  responses: string;
  propertyType: string;
}

// Zod schemas for client-side form validation (kept for react-hook-form compatibility)
export const insertMaintenanceTaskSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string(),
  category: z.string().min(1, "Category is required"),
  priority: z.string().min(1, "Priority is required"),
  status: z.string().optional(),
  lastMaintenanceDate: z.string().nullable().optional(),
  nextMaintenanceDate: z.string().nullable().optional(),
  isTemplate: z.boolean().nullable().optional(),
  isAiGenerated: z.boolean().nullable().optional(),
  templateId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  serialNumber: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  installationDate: z.date().nullable().optional(),
  warrantyPeriodMonths: z.number().nullable().optional(),
  minorIntervalMonths: z.number().nullable().optional(),
  majorIntervalMonths: z.number().nullable().optional(),
  minorTasks: z.string().nullable().optional(),
  majorTasks: z.string().nullable().optional(),
  relatedItemIds: z.string().nullable().optional(),
  dueDate: z.date().nullable().optional(),
});

export const insertQuestionnaireResponseSchema = z.object({
  sessionId: z.string().min(1, "Session ID is required"),
  responses: z.string().min(1, "Responses are required"),
  propertyType: z.string().min(1, "Property type is required"),
});

// Auth Zod schemas for client-side form validation
export const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1, "Name is required"),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

// Validation helper for API routes
export function validateInsertMaintenanceTask(data: unknown): { valid: boolean; errors?: string[] } {
  const result = insertMaintenanceTaskSchema.safeParse(data);
  if (result.success) {
    return { valid: true };
  }
  return { 
    valid: false, 
    errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
  };
}

export function validateInsertQuestionnaireResponse(data: unknown): { valid: boolean; errors?: string[] } {
  const result = insertQuestionnaireResponseSchema.safeParse(data);
  if (result.success) {
    return { valid: true };
  }
  return { 
    valid: false, 
    errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
  };
}
