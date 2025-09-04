import OpenAI from "openai";

// the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_ENV_VAR || "default_key"
});

export interface PropertyAssessment {
  homeAge: string;
  homeSize: string;
  homeType: string;
  climate: string;
  features: string[];
  lastMaintenance: string;
  budget: string;
  concerns: string[];
}

export interface AITaskSuggestion {
  title: string;
  description: string;
  category: string;
  priority: string;
  frequency: string;
  reasoning: string;
}

export async function generateMaintenanceTasks(
  propertyType: string, 
  assessment: PropertyAssessment
): Promise<AITaskSuggestion[]> {
  try {
    const prompt = `You are a home maintenance expert AI. Generate personalized maintenance tasks for a ${propertyType} property based on the following assessment:

Home Age: ${assessment.homeAge}
Home Size: ${assessment.homeSize}
Climate: ${assessment.climate}
Features: ${assessment.features.join(', ')}
Last Maintenance: ${assessment.lastMaintenance}
Budget: ${assessment.budget}
Concerns: ${assessment.concerns.join(', ')}

Generate 8-12 specific, actionable maintenance tasks. For each task, provide:
- title: Clear, concise task name
- description: Detailed instructions (2-3 sentences)
- category: One of [HVAC, Plumbing, Electrical, Exterior, Interior, Safety, Landscaping]
- priority: One of [Low, Medium, High, Urgent]
- frequency: How often this should be done
- reasoning: Why this task is important for this specific property

Focus on tasks that are most relevant to the property age, type, and climate. Prioritize safety and system efficiency.

Respond with valid JSON in this exact format:
{
  "tasks": [
    {
      "title": "string",
      "description": "string", 
      "category": "string",
      "priority": "string",
      "frequency": "string",
      "reasoning": "string"
    }
  ]
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are an expert home maintenance advisor. Provide specific, actionable maintenance recommendations based on property characteristics."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 2000
    });

    const result = JSON.parse(response.choices[0].message.content || '{"tasks": []}');
    return result.tasks || [];

  } catch (error) {
    console.error("Error generating maintenance tasks:", error);
    throw new Error("Failed to generate AI maintenance suggestions");
  }
}

export async function generateQuickSuggestions(
  existingTasks: any[],
  propertyInfo?: { type: string; age?: string; climate?: string }
): Promise<AITaskSuggestion[]> {
  try {
    const taskTitles = existingTasks.map(task => task.title).join(', ');
    
    const prompt = `Based on existing maintenance tasks: ${taskTitles}

Property info: ${propertyInfo ? `${propertyInfo.type}, ${propertyInfo.age || 'unknown age'}, ${propertyInfo.climate || 'unknown climate'}` : 'No specific property info'}

Suggest 2-3 additional important maintenance tasks that are missing from the current list. Consider seasonal needs and typical maintenance gaps.

Respond with valid JSON in this format:
{
  "suggestions": [
    {
      "title": "string",
      "description": "string",
      "category": "string", 
      "priority": "string",
      "frequency": "string",
      "reasoning": "string"
    }
  ]
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system", 
          content: "You are a maintenance expert providing quick, relevant suggestions for home maintenance gaps."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.6,
      max_tokens: 800
    });

    const result = JSON.parse(response.choices[0].message.content || '{"suggestions": []}');
    return result.suggestions || [];

  } catch (error) {
    console.error("Error generating quick suggestions:", error);
    throw new Error("Failed to generate AI suggestions");
  }
}
