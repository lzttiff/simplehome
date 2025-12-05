/**
 * AI Suggestion Schema
 * Consistent structure for AI-generated maintenance task suggestions
 * Used by both frontend (React components) and backend (OpenAI/Gemini services)
 */

export interface AISuggestion {
  /** Clear, concise task name */
  title: string;
  
  /** Detailed instructions (2-3 sentences) */
  description: string;
  
  /** 
   * Maintenance category
   * Must be one of the predefined categories
   */
  category: 
    | "Appliances"
    | "HVAC & Mechanical"
    | "Plumbing & Water"
    | "Electrical & Lighting"
    | "Structural & Exterior"
    | "Interior & Finishes"
    | "Safety & Fire"
    | "Yard & Outdoor Equipment"
    | "IT & Communications"
    | "Furniture & Fixtures";
  
  /**
   * Task priority level
   */
  priority: "Low" | "Medium" | "High" | "Urgent";
  
  /**
   * How often this task should be performed
   * Examples: "Monthly", "Quarterly", "Semi-Annually", "Annually", "Every 2-3 Years"
   */
  frequency: string;
  
  /**
   * Explanation of why this task is important for the specific property
   */
  reasoning: string;
}

/**
 * Response format for AI suggestion endpoints
 */
export interface AISuggestionsResponse {
  suggestions: AISuggestion[];
}
