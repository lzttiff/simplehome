import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertMaintenanceTaskSchema, insertQuestionnaireResponseSchema } from "@shared/schema";
import { generateMaintenanceTasks, generateQuickSuggestions } from "./services/openai";
import { z } from "zod";

export async function registerRoutes(app: Express): Promise<Server> {
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

  app.post("/api/tasks", async (req, res) => {
    try {
      const validatedData = insertMaintenanceTaskSchema.parse(req.body);
      const task = await storage.createMaintenanceTask(validatedData);
      res.status(201).json(task);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid task data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create task" });
    }
  });

  app.patch("/api/tasks/:id", async (req, res) => {
    try {
      const updates = req.body;
      const task = await storage.updateMaintenanceTask(req.params.id, updates);
      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }
      res.json(task);
    } catch (error) {
      res.status(500).json({ message: "Failed to update task" });
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

  // AI Task Generation
  app.post("/api/ai/generate-tasks", async (req, res) => {
    try {
      const { propertyType, assessment } = req.body;
      
      if (!propertyType || !assessment) {
        return res.status(400).json({ message: "Property type and assessment are required" });
      }

      const suggestions = await generateMaintenanceTasks(propertyType, assessment);
      res.json({ suggestions });
    } catch (error) {
      console.error("AI task generation error:", error);
      res.status(500).json({ message: "Failed to generate AI maintenance tasks" });
    }
  });

  app.post("/api/ai/quick-suggestions", async (req, res) => {
    try {
      const { existingTasks, propertyInfo } = req.body;
      
      const suggestions = await generateQuickSuggestions(existingTasks || [], propertyInfo);
      res.json({ suggestions });
    } catch (error) {
      console.error("AI quick suggestions error:", error);
      res.status(500).json({ message: "Failed to generate AI suggestions" });
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

  const httpServer = createServer(app);
  return httpServer;
}
