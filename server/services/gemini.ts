import axios from "axios";

// Store Gemini API key locally for backend use
let localGeminiApiKey: string | undefined = process.env.GEMINI_API_KEY;

// Setter for local key (for testing via POST API)
export function setLocalGeminiApiKey(key: string) {
  localGeminiApiKey = key;
}

export async function generateGeminiContent(prompt: string, apiKey?: string): Promise<string> {
  const models = ["gemini-1.5-pro", "gemini-1.5-flash"];
  const keyToUse = apiKey || localGeminiApiKey;
  if (!keyToUse) throw new Error("Gemini API key is not set.");
  // Add explicit instructions for JSON output
  const jsonInstructions = `\nRespond with valid JSON in this format:\n{\n  \"suggestions\": [\n    {\n      \"title\": \"string\",\n      \"description\": \"string\",\n      \"category\": \"string\",\n      \"priority\": \"string\",\n      \"frequency\": \"string\",\n      \"reasoning\": \"string\"\n    }\n  ]\n}`;
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
  for (const model of models) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${keyToUse}`;
    try {
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
      // Try next model if available
    }
  }
  // If both models fail, throw last error
  throw new Error(lastError?.response?.data?.error?.message || lastError?.message || "Gemini API request failed");
}
