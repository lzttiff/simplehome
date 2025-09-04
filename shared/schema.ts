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
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(), // HVAC, Plumbing, Electrical, Exterior, Interior
  priority: text("priority").notNull(), // Low, Medium, High, Urgent
  status: text("status").notNull().default("pending"), // pending, completed, overdue
  dueDate: timestamp("due_date"),
  completedAt: timestamp("completed_at"),
  lastCompleted: timestamp("last_completed"),
  nextDue: timestamp("next_due"),
  isTemplate: boolean("is_template").default(false),
  isAiGenerated: boolean("is_ai_generated").default(false),
  templateId: varchar("template_id"),
  notes: text("notes"),
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
