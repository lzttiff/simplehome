import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const propertyTemplates = pgTable("property_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  type: text("type").notNull(),
  description: text("description").notNull(),
  taskCount: integer("task_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const maintenanceTasks = pgTable("maintenance_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(), // Maps to "name" in schema
  description: text("description").notNull(),
  category: text("category").notNull(), // Maps to "categoryName" in schema
  priority: text("priority").notNull(), // Low, Medium, High, Urgent
  status: text("status").notNull().default("pending"), // pending, completed, overdue
  // Schema-aligned date fields (JSON objects with minor/major)
  lastMaintenanceDate: text("last_maintenance_date"), // JSON: {minor: date|null, major: date|null}
  nextMaintenanceDate: text("next_maintenance_date"), // JSON: {minor: date|null, major: date|null}
  isTemplate: boolean("is_template").default(false),
  isAiGenerated: boolean("is_ai_generated").default(false),
  templateId: varchar("template_id"),
  notes: text("notes"),
  // Additional fields from maintenance-list-schema-1.0.0.json
  brand: text("brand"),
  model: text("model"),
  serialNumber: text("serial_number"),
  location: text("location"),
  installationDate: timestamp("installation_date"),
  warrantyPeriodMonths: integer("warranty_period_months"),
  minorIntervalMonths: integer("minor_interval_months"),
  majorIntervalMonths: integer("major_interval_months"),
  minorTasks: text("minor_tasks"), // JSON array stored as text
  majorTasks: text("major_tasks"), // JSON array stored as text
  relatedItemIds: text("related_item_ids"), // JSON array stored as text
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const questionnaireResponses = pgTable("questionnaire_responses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull(),
  responses: text("responses").notNull(), // JSON string
  propertyType: text("property_type").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPropertyTemplateSchema = createInsertSchema(propertyTemplates).omit({
  id: true,
  createdAt: true,
});

export const insertMaintenanceTaskSchema = createInsertSchema(maintenanceTasks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertQuestionnaireResponseSchema = createInsertSchema(questionnaireResponses).omit({
  id: true,
  createdAt: true,
});

export type InsertPropertyTemplate = z.infer<typeof insertPropertyTemplateSchema>;
export type PropertyTemplate = typeof propertyTemplates.$inferSelect;

export type InsertMaintenanceTask = z.infer<typeof insertMaintenanceTaskSchema>;
export type MaintenanceTask = typeof maintenanceTasks.$inferSelect;

export type InsertQuestionnaireResponse = z.infer<typeof insertQuestionnaireResponseSchema>;
export type QuestionnaireResponse = typeof questionnaireResponses.$inferSelect;
