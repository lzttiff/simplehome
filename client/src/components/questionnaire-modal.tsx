import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { QuestionnaireQuestion, QuestionnaireState } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { X, ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface QuestionnaireModalProps {
  isOpen: boolean;
  onClose: () => void;
  templateId?: string;
}

const questionnaireQuestions: QuestionnaireQuestion[] = [
  {
    id: "home_age",
    question: "What's the age of your home?",
    description: "This helps us recommend appropriate maintenance intervals and identify age-specific maintenance needs.",
    type: "single",
    required: true,
    options: [
      { value: "0-5", label: "Less than 5 years", description: "New construction, minimal wear" },
      { value: "5-15", label: "5-15 years", description: "Some systems may need attention" },
      { value: "16-30", label: "16-30 years", description: "Regular maintenance critical" },
      { value: "30+", label: "Over 30 years", description: "Extensive maintenance needs" },
    ]
  },
  {
    id: "home_size",
    question: "What's the size of your property?",
    description: "Larger properties typically require more maintenance tasks and different scheduling.",
    type: "single",
    required: true,
    options: [
      { value: "small", label: "Small (< 1,500 sq ft)", description: "Compact maintenance schedule" },
      { value: "medium", label: "Medium (1,500-2,500 sq ft)", description: "Standard maintenance needs" },
      { value: "large", label: "Large (2,500-4,000 sq ft)", description: "Extended maintenance schedule" },
      { value: "very_large", label: "Very Large (4,000+ sq ft)", description: "Comprehensive maintenance plan" },
    ]
  },
  {
    id: "climate",
    question: "What's your climate zone?",
    description: "Climate affects maintenance frequency and seasonal priorities.",
    type: "single",
    required: true,
    options: [
      { value: "tropical", label: "Tropical/Humid", description: "High moisture, mold concerns" },
      { value: "temperate", label: "Temperate", description: "Four distinct seasons" },
      { value: "arid", label: "Arid/Desert", description: "Low moisture, heat stress" },
      { value: "cold", label: "Cold/Northern", description: "Harsh winters, freeze protection" },
    ]
  },
  {
    id: "features",
    question: "Which features does your property have?",
    description: "Select all that apply to customize your maintenance schedule.",
    type: "multiple",
    options: [
      { value: "pool", label: "Swimming Pool", description: "Regular chemical and equipment maintenance" },
      { value: "hvac", label: "Central HVAC", description: "Filter changes and system maintenance" },
      { value: "fireplace", label: "Fireplace/Chimney", description: "Annual cleaning and inspection" },
      { value: "deck_patio", label: "Deck/Patio", description: "Seasonal cleaning and repairs" },
      { value: "garden", label: "Garden/Landscaping", description: "Seasonal plant and soil care" },
      { value: "garage", label: "Garage/Workshop", description: "Tool and equipment maintenance" },
    ]
  },
  {
    id: "last_maintenance",
    question: "When was your last comprehensive maintenance check?",
    description: "This helps us prioritize urgent tasks.",
    type: "single",
    required: true,
    options: [
      { value: "recent", label: "Within 6 months", description: "Recent maintenance, focus on preventive" },
      { value: "moderate", label: "6 months - 1 year", description: "Some tasks may be due" },
      { value: "overdue", label: "1-2 years ago", description: "Several systems need attention" },
      { value: "long_overdue", label: "Over 2 years ago", description: "Comprehensive inspection needed" },
    ]
  },
  {
    id: "budget",
    question: "What's your maintenance budget range?",
    description: "We'll prioritize tasks based on your budget constraints.",
    type: "single",
    options: [
      { value: "low", label: "Budget-conscious", description: "Focus on essential safety tasks" },
      { value: "moderate", label: "Moderate budget", description: "Balance of preventive and repairs" },
      { value: "high", label: "Comprehensive", description: "Full preventive maintenance program" },
    ]
  },
  {
    id: "concerns",
    question: "Any specific concerns or problem areas?",
    description: "Select any issues you've noticed that need attention.",
    type: "multiple",
    options: [
      { value: "energy_efficiency", label: "High energy bills", description: "Focus on insulation and HVAC efficiency" },
      { value: "water_issues", label: "Plumbing problems", description: "Leaks, pressure, or drainage issues" },
      { value: "electrical", label: "Electrical concerns", description: "Flickering lights or outlet issues" },
      { value: "pest_control", label: "Pest problems", description: "Prevention and treatment strategies" },
      { value: "security", label: "Security upgrades", description: "Locks, lighting, and surveillance" },
      { value: "indoor_air", label: "Air quality", description: "Ventilation and filtration improvements" },
    ]
  },
];

export default function QuestionnaireModal({ isOpen, onClose, templateId }: QuestionnaireModalProps) {
  const [state, setState] = useState<QuestionnaireState>({
    currentStep: 0,
    totalSteps: questionnaireQuestions.length,
    responses: {},
    propertyType: templateId || "custom",
  });
  const [isGenerating, setIsGenerating] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const generateTasksMutation = useMutation({
    mutationFn: async (assessment: any) => {
      const response = await apiRequest("POST", "/api/ai/generate-tasks", {
        propertyType: state.propertyType,
        assessment,
      });
      return response.json();
    },
    onSuccess: (data) => {
      // Add generated tasks
      data.suggestions.forEach(async (suggestion: any) => {
        await apiRequest("POST", "/api/tasks", {
          title: suggestion.title,
          description: suggestion.description,
          category: suggestion.category,
          priority: suggestion.priority,
          status: "pending",
          isTemplate: false,
          isAiGenerated: true,
          dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          notes: `AI generated: ${suggestion.reasoning}`,
        });
      });

      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      
      toast({
        title: "AI Items / Tasks Generated",
        description: `${data.suggestions.length} personalized items / tasks have been added.`,
      });
      
      onClose();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to generate AI tasks",
        variant: "destructive",
      });
      setIsGenerating(false);
    },
  });

  const currentQuestion = questionnaireQuestions[state.currentStep];
  const progress = ((state.currentStep + 1) / state.totalSteps) * 100;

  const handleAnswer = (questionId: string, value: string | string[]) => {
    setState(prev => ({
      ...prev,
      responses: {
        ...prev.responses,
        [questionId]: value,
      },
    }));
  };

  const handleNext = () => {
    if (state.currentStep < state.totalSteps - 1) {
      setState(prev => ({ ...prev, currentStep: prev.currentStep + 1 }));
    } else {
      // Generate AI tasks
      handleGenerateTasks();
    }
  };

  const handlePrevious = () => {
    if (state.currentStep > 0) {
      setState(prev => ({ ...prev, currentStep: prev.currentStep - 1 }));
    }
  };

  const handleGenerateTasks = async () => {
    setIsGenerating(true);
    
    const assessment = {
      homeAge: state.responses.home_age || "unknown",
      homeSize: state.responses.home_size || "unknown",
      homeType: state.propertyType,
      climate: state.responses.climate || "temperate",
      features: Array.isArray(state.responses.features) ? state.responses.features : [],
      lastMaintenance: state.responses.last_maintenance || "unknown",
      budget: state.responses.budget || "moderate",
      concerns: Array.isArray(state.responses.concerns) ? state.responses.concerns : [],
    };

    generateTasksMutation.mutate(assessment);
  };

  const canProceed = () => {
    const response = state.responses[currentQuestion.id];
    if (currentQuestion.required && !response) return false;
    if (currentQuestion.type === "multiple" && Array.isArray(response) && response.length === 0) return false;
    return true;
  };

  const isLastStep = state.currentStep === state.totalSteps - 1;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-hidden">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center">
              <Sparkles className="w-5 h-5 mr-2 text-primary" />
              Property Assessment
            </DialogTitle>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="w-5 h-5" />
            </Button>
          </div>
        </DialogHeader>

        {isGenerating ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <h3 className="text-lg font-semibold mb-2">Generating Your Personalized Tasks</h3>
            <p className="text-gray-600">Our AI is analyzing your responses to create custom maintenance recommendations...</p>
          </div>
        ) : (
          <>
            {/* Progress */}
            <div className="mb-6">
              <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
                <span>Step {state.currentStep + 1} of {state.totalSteps}</span>
                <span>{Math.round(progress)}% Complete</span>
              </div>
              <Progress value={progress} className="w-full" />
            </div>

            {/* Question */}
            <div className="mb-6">
              <h3 className="text-xl font-semibold text-gray-900 mb-3">{currentQuestion.question}</h3>
              {currentQuestion.description && (
                <p className="text-gray-600 mb-6">{currentQuestion.description}</p>
              )}

              <div className="space-y-3">
                {currentQuestion.options?.map((option) => {
                  const isSelected = currentQuestion.type === "single" 
                    ? state.responses[currentQuestion.id] === option.value
                    : Array.isArray(state.responses[currentQuestion.id]) && 
                      state.responses[currentQuestion.id]?.includes(option.value);

                  return (
                    <Card
                      key={option.value}
                      className={cn(
                        "cursor-pointer transition-all hover:shadow-md",
                        isSelected ? "border-primary bg-blue-50" : "border-gray-200 hover:border-gray-300"
                      )}
                      onClick={() => {
                        if (currentQuestion.type === "single") {
                          handleAnswer(currentQuestion.id, option.value);
                        } else {
                          const current = Array.isArray(state.responses[currentQuestion.id]) 
                            ? state.responses[currentQuestion.id] as string[]
                            : [];
                          const updated = current.includes(option.value)
                            ? current.filter(v => v !== option.value)
                            : [...current, option.value];
                          handleAnswer(currentQuestion.id, updated);
                        }
                      }}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="font-medium text-gray-900">{option.label}</div>
                            {option.description && (
                              <div className="text-sm text-gray-600 mt-1">{option.description}</div>
                            )}
                          </div>
                          {currentQuestion.type === "multiple" && (
                            <div className={cn(
                              "w-4 h-4 border-2 rounded flex items-center justify-center ml-3",
                              isSelected ? "border-primary bg-primary" : "border-gray-300"
                            )}>
                              {isSelected && <div className="w-2 h-2 bg-white rounded-full" />}
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>

            {/* Navigation */}
            <div className="flex justify-between pt-4 border-t">
              <Button
                variant="outline"
                onClick={handlePrevious}
                disabled={state.currentStep === 0}
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Previous
              </Button>
              <Button
                onClick={handleNext}
                disabled={!canProceed()}
                className="bg-primary text-white hover:bg-blue-700"
              >
                {isLastStep ? (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Generate Tasks
                  </>
                ) : (
                  <>
                    Next Question
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
