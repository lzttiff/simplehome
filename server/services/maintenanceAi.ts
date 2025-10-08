import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "default_key"
});

export interface CatalogItem {
  id: string;
  name: string;
  brand?: string;
  model?: string; // Some items may use as Type
  installationDate: string;
  lastMinorServiceDate: string;
  lastMajorServiceDate: string;
  location: string;
  notes?: string;
  maintenanceSchedule: {
    minor: string;
    major: string;
  };
}

export interface MaintenanceAiResult {
  nextMinorServiceDate: string;
  nextMajorServiceDate: string;
  reasoning: string;
}

export async function generateMaintenanceSchedule(item: CatalogItem): Promise<MaintenanceAiResult> {
  // Use installationDate as fallback for missing service dates
  const minorDate = item.lastMinorServiceDate || item.installationDate;
  const majorDate = item.lastMajorServiceDate || item.installationDate;

  // For Foundation, treat model as Type
  const typeOrModel = item.name === "Foundation" ? item.model : item.model;

  const prompt = `You are a home maintenance expert. Given the following household items, and provided attributes, generate Maintenance schedule, together with the next minor and major service dates.\n\nItem details:\n- Name: ${item.name}\n- Model: ${item.model || "N/A"}\n- Brand: ${item.brand || "N/A"}\n- Installation Date: ${item.installationDate}\n- Location: ${item.location}\n- Last Minor Service Date: ${minorDate}\n- Last Major Service Date: ${majorDate}\n\nPlease return your answer as a JSON object with:\n- Name \n- nextMinorServiceDate (ISO format)\n- nextMajorServiceDate (ISO format)\n- Maintenance Schedule:\n\t-- Minor\n\t-- Major\n- reasoning\nRespond only in valid JSON format.`;

  // Support provider selection: "openai" (default) or "gemini"
  const provider = (item as any).provider || "openai";
  console.log(`[AI] Using provider: ${provider} on item: ${item.name}`);
  if (provider === "gemini") {
    const { generateGeminiContent } = await import("./gemini");
    const geminiResult = await generateGeminiContent(prompt);
    // Try to parse Gemini result as JSON
    if (typeof geminiResult === "string") {
      try {
        return JSON.parse(geminiResult);
      } catch {
        return { error: "Gemini response not valid JSON", raw: geminiResult } as any;
      }
    }
    return geminiResult;
  } else {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are a home maintenance expert." },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.5,
      max_tokens: 400
    });
    const result = JSON.parse(response.choices[0].message.content || "{}") as MaintenanceAiResult;
    return result;
  }
}

export async function generateCategoryMaintenanceSchedules(items: CatalogItem[]): Promise<MaintenanceAiResult[]> {
  const results: MaintenanceAiResult[] = [];
  for (const item of items) {
    const result = await generateMaintenanceSchedule(item);
    results.push(result);
  }
  return results;
}
