export interface QuestionnaireQuestion {
  id: string;
  question: string;
  description?: string;
  type: 'single' | 'multiple' | 'text';
  options?: QuestionOption[];
  required?: boolean;
}

export interface QuestionOption {
  value: string;
  label: string;
  description?: string;
}

export interface QuestionnaireState {
  currentStep: number;
  totalSteps: number;
  responses: Record<string, any>;
  propertyType: string;
}

export interface TaskStats {
  total: number;
  completed: number;
  pending: number;
  overdue: number;
  dueSoon: number;
}

export interface CategoryFilter {
  category: string;
  color: string;
  count: number;
  checked: boolean;
}
