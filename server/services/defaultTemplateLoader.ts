import fs from "fs";
import path from "path";
import {
  normalizeDateOnly,
  type InsertMaintenanceTask,
} from "../../shared/schema";

export type DefaultTemplateType = "single_family" | "condo";

export interface DefaultTemplateTaskSeed {
  sourceItemId: string;
  task: InsertMaintenanceTask;
}

export interface DefaultTemplateSeed {
  type: DefaultTemplateType;
  name: string;
  description: string;
  sourceFile: string;
  tasks: DefaultTemplateTaskSeed[];
}

type RawTemplateItem = {
  id?: string;
  name?: string;
  brand?: string | null;
  model?: string | null;
  installationDate?: string | null;
  lastMaintenanceDate?: {
    minor?: string | null;
    major?: string | null;
  } | null;
  nextMaintenanceDate?: {
    minor?: string | null;
    major?: string | null;
  } | null;
  location?: string | null;
  notes?: string | null;
  relatedItemIds?: string[] | null;
};

type RawTemplateCategory = {
  categoryName?: string;
  category?: string;
  items?: RawTemplateItem[];
};

type RawTemplateFile = {
  householdCatalog?: RawTemplateCategory[];
};

type TemplateFileConfig = {
  type: DefaultTemplateType;
  name: string;
  description: string;
  fileName: string;
};

const DEFAULT_PRIORITY = "Medium";
const DEFAULT_STATUS = "pending";

const DEFAULT_TEMPLATE_FILES: TemplateFileConfig[] = [
  {
    type: "single_family",
    name: "Single-Family Home",
    description: "Comprehensive maintenance for detached homes with yard, roof, HVAC systems, and exterior care.",
    fileName: "maintenance-template-singleFamilyHome.json",
  },
  {
    type: "condo",
    name: "Condo",
    description: "Essential maintenance for condo owners covering unit-specific systems, appliances, and shared building responsibilities.",
    fileName: "maintenance-template-condo.json",
  },
];

function toDateOrNull(value: string | null | undefined): Date | null {
  const normalized = normalizeDateOnly(value);
  if (!normalized) {
    return null;
  }

  return new Date(`${normalized}T00:00:00.000Z`);
}

function toTaskSeed(item: RawTemplateItem, category: string): DefaultTemplateTaskSeed | null {
  const sourceItemId = (item.id || "").trim();
  const title = (item.name || "").trim();

  if (!sourceItemId || !title) {
    return null;
  }

  const task: InsertMaintenanceTask = {
    title,
    description: (item.notes || `Maintenance task for ${title}`).trim(),
    category,
    priority: DEFAULT_PRIORITY,
    status: DEFAULT_STATUS,
    // Keep maintenance history empty for new users so they can enter real data.
    lastMaintenanceDate: null,
    nextMaintenanceDate: null,
    isTemplate: true,
    isAiGenerated: false,
    notes: item.notes?.trim() || null,
    brand: item.brand?.trim() || null,
    model: item.model?.trim() || null,
    location: item.location?.trim() || null,
    installationDate: toDateOrNull(item.installationDate),
    minorIntervalMonths: null,
    majorIntervalMonths: null,
    minorTasks: null,
    majorTasks: null,
    relatedItemIds: item.relatedItemIds?.length ? JSON.stringify(item.relatedItemIds) : null,
    overdueBacklog: null,
    overdueSince: null,
    warrantyPeriodMonths: null,
    serialNumber: null,
    templateId: null,
    calendarExports: null,
    dueDate: null,
  };

  return { sourceItemId, task };
}

function loadTemplateFile(filePath: string): RawTemplateFile {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Default template file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw) as RawTemplateFile;
  if (!Array.isArray(parsed.householdCatalog)) {
    throw new Error(`Invalid default template format in ${filePath}: householdCatalog must be an array`);
  }

  return parsed;
}

export function loadDefaultTemplateSeeds(baseDir: string = process.cwd()): DefaultTemplateSeed[] {
  return DEFAULT_TEMPLATE_FILES.map((templateConfig) => {
    const absolutePath = path.join(baseDir, templateConfig.fileName);
    const templateFile = loadTemplateFile(absolutePath);

    const tasks: DefaultTemplateTaskSeed[] = [];
    for (const category of templateFile.householdCatalog || []) {
      const categoryName = (category.categoryName || category.category || "Uncategorized").trim();
      for (const item of category.items || []) {
        const mapped = toTaskSeed(item, categoryName || "Uncategorized");
        if (mapped) {
          tasks.push(mapped);
        }
      }
    }

    return {
      type: templateConfig.type,
      name: templateConfig.name,
      description: templateConfig.description,
      sourceFile: templateConfig.fileName,
      tasks,
    };
  });
}

export function summarizeDefaultTemplateSeeds(seeds: DefaultTemplateSeed[]): Record<DefaultTemplateType, number> {
  const summary = {
    single_family: 0,
    condo: 0,
  } as Record<DefaultTemplateType, number>;

  for (const seed of seeds) {
    summary[seed.type] = seed.tasks.length;
  }

  return summary;
}
