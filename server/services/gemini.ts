import { logWithLevel } from "./logWithLevel";
import axios from "axios";

// Store Gemini API key locally for backend use
let localGeminiApiKey: string | undefined = process.env.GEMINI_API_KEY;

// Setter for local key (for testing via POST API)
export function setLocalGeminiApiKey(key: string) {
  localGeminiApiKey = key;
}

export async function generateGeminiContent(prompt: string, apiKey?: string): Promise<string> {
  // gemini 1.5 is deprecated
  const models = ["gemini-2.5-pro", "gemini-2.5-flash"];
  const keyToUse = apiKey || localGeminiApiKey;
  if (!keyToUse) throw new Error("Gemini API key is not set.");

  // Add explicit instructions for JSON output matching the frontend schema
  const jsonInstructions = `\nRespond with valid JSON in this exact format:\n{\n  \"suggestions\": [\n    {\n      \"title\": \"string (task name)\",\n      \"description\": \"string (detailed task instructions)\",\n      \"category\": \"string (one of: Appliances, HVAC & Mechanical, Plumbing & Water, Electrical & Lighting, Structural & Exterior, Interior & Finishes, Safety & Fire, Yard & Outdoor Equipment, IT & Communications, Furniture & Fixtures)\",\n      \"priority\": \"string (one of: Low, Medium, High, Urgent)\",\n      \"frequency\": \"string (how often to perform, e.g., Monthly, Quarterly, Semi-Annually, Annually)\",\n      \"reasoning\": \"string (why this task is important)\"\n    }\n  ]\n}`;
  const requestBody = {
    contents: [
      {
        parts: [
          { text: prompt + jsonInstructions }
        ]
      }
    ]
  };
  let lastError: any = null;
  // Try first model
  try {
    logWithLevel("INFO", `[Gemini] Trying model: ${models[0]}`);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${models[0]}:generateContent?key=${keyToUse}`;
    const response = await axios.post(endpoint, requestBody);
    const candidates = response.data?.candidates;
    if (candidates && candidates.length > 0) {
      let text = candidates[0]?.content?.parts?.[0]?.text || "";
      let cleaned = text.trim();
      if (cleaned.startsWith("```json")) {
        cleaned = cleaned.replace(/^```json/, "").replace(/```$/, "").trim();
      } else if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```/, "").replace(/```$/, "").trim();
      }
      try {
        const parsed = JSON.parse(cleaned);
        if (parsed.suggestions) return parsed.suggestions;
        return parsed;
      } catch {
        // If not valid JSON, return raw text
        return cleaned;
      }
    }
    return JSON.stringify(response.data);
  } catch (error: any) {
    lastError = error;
    logWithLevel("ERROR", `[Gemini] Model ${models[0]} failed:`, error?.message || error);
    // Try second model if first fails
    try {
      logWithLevel("INFO", `[Gemini] Trying model: ${models[1]}`);
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${models[1]}:generateContent?key=${keyToUse}`;
      const response = await axios.post(endpoint, requestBody);
      const candidates = response.data?.candidates;
      if (candidates && candidates.length > 0) {
        let text = candidates[0]?.content?.parts?.[0]?.text || "";
        let cleaned = text.trim();
        if (cleaned.startsWith("```json")) {
          cleaned = cleaned.replace(/^```json/, "").replace(/```$/, "").trim();
        } else if (cleaned.startsWith("```")) {
          cleaned = cleaned.replace(/^```/, "").replace(/```$/, "").trim();
        }
        try {
          const parsed = JSON.parse(cleaned);
          if (parsed.suggestions) return parsed.suggestions;
          return parsed;
        } catch {
          // If not valid JSON, return raw text
          return cleaned;
        }
      }
      return JSON.stringify(response.data);
    } catch (error2: any) {
      lastError = error2;
      logWithLevel("ERROR", `[Gemini] Model ${models[1]} failed:`, error2?.message || error2);
    }
  }
  // If both models fail, throw last error
  throw new Error(lastError?.response?.data?.error?.message || lastError?.message || "Gemini API request failed");
}
