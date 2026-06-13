import { loadDefaultTemplateSeeds, type DefaultTemplateType } from "./defaultTemplateLoader";
import type { PropertyTemplate } from "../../shared/schema";
import type { IStorage } from "../storage";

/**
 * Creates a single property of the given type for a user, seeding it with
 * the matching default maintenance tasks. Called when a user selects a
 * property type during onboarding or when adding an additional property.
 */
export async function initializeUserProperty(
  userId: string,
  type: DefaultTemplateType,
  customName: string | undefined,
  storage: IStorage,
): Promise<PropertyTemplate> {
  const seeds = loadDefaultTemplateSeeds();
  const seed = seeds.find(s => s.type === type);
  if (!seed) {
    throw new Error(`Unknown property type: ${type}`);
  }

  const template = await storage.createPropertyTemplate({
    userId,
    name: customName ?? seed.name,
    type: seed.type,
    description: seed.description,
    taskCount: seed.tasks.length,
  });

  for (const { task } of seed.tasks) {
    await storage.createMaintenanceTask(
      { ...task, templateId: template.id },
      userId,
    );
  }

  return template;
}
