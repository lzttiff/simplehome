import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MaintenanceTask } from "@shared/schema";
import { AISuggestion, AISuggestionsResponse } from "@shared/aiSuggestion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, Check, ThumbsUp, ThumbsDown, Sparkles } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface AISuggestionsPanelProps {
  onClose: () => void;
  existingTasks: MaintenanceTask[];
}

export default function AISuggestionsPanel({ onClose, existingTasks }: AISuggestionsPanelProps) {
  const [acceptedSuggestions, setAcceptedSuggestions] = useState<Set<string>>(new Set());
  const [rejectedSuggestions, setRejectedSuggestions] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: suggestionsData, isLoading, error } = useQuery({
    queryKey: ["/api/ai/quick-suggestions", existingTasks.length],
    queryFn: async () => {
      const response = await apiRequest("POST", "/api/ai/quick-suggestions", {
        existingTasks: existingTasks.map(t => ({ title: t.title, category: t.category })),
        propertyInfo: { type: "single_family", age: "5-15 years", climate: "temperate" }
        // Provider will be read from .env (DEFAULT_AI_PROVIDER)
      });
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: false, // Don't retry failed AI requests
  });

  const addTaskMutation = useMutation({
    mutationFn: async (suggestion: AISuggestion) => {
      const taskData = {
        title: suggestion.title,
        description: suggestion.description,
        category: suggestion.category,
        priority: suggestion.priority,
        status: "pending",
        isTemplate: false,
        isAiGenerated: true,
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Due in 1 week
        notes: `AI suggested: ${suggestion.reasoning}`,
      };

      const response = await apiRequest("POST", "/api/tasks", taskData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({
        title: "Item / Task added",
        description: "AI suggestion has been added to your Items / Tasks.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add item / task",
        variant: "destructive",
      });
    },
  });

  const handleAcceptSuggestion = (suggestion: AISuggestion) => {
    const suggestionId = `${suggestion.title}-${suggestion.category}`;
    setAcceptedSuggestions(prev => new Set([...prev, suggestionId]));
    addTaskMutation.mutate(suggestion);
  };

  const handleRejectSuggestion = (suggestion: AISuggestion) => {
    const suggestionId = `${suggestion.title}-${suggestion.category}`;
    setRejectedSuggestions(prev => new Set([...prev, suggestionId]));
    toast({
      title: "Suggestion rejected",
      description: "This suggestion won't be shown again.",
    });
  };

  let suggestions: AISuggestion[] = suggestionsData?.suggestions || [];
  // If suggestions is a nested array, flatten it
  if (Array.isArray(suggestions) && Array.isArray(suggestions[0])) {
    suggestions = suggestions.flat();
  }

  // Filter out accepted or rejected suggestions
  const visibleSuggestions = suggestions.filter(suggestion => {
    const suggestionId = `${suggestion.title}-${suggestion.category}`;
    return !acceptedSuggestions.has(suggestionId) && !rejectedSuggestions.has(suggestionId);
  });

  return (
    <div className="fixed bottom-6 right-6 z-40">
      <Card className="w-80 max-h-96 shadow-lg border border-gray-200">
        <CardHeader className="bg-accent text-white p-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center">
              <Sparkles className="w-5 h-5 mr-2" />
              AI Suggestions
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={onClose} className="text-white hover:text-gray-200 p-1">
              <X className="w-5 h-5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-4 max-h-64 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent"></div>
              <span className="ml-2 text-sm text-gray-600">Generating suggestions...</span>
            </div>
          ) : error ? (
            <div className="text-center py-4 text-gray-500">
              <Sparkles className="w-8 h-8 mx-auto mb-2 text-gray-300" />
              <p className="text-sm">Unable to load AI suggestions</p>
              <p className="text-xs text-gray-400 mt-1">Please check your API configuration.</p>
            </div>
          ) : visibleSuggestions.length > 0 ? (
            <div className="space-y-3">
              {visibleSuggestions.map((suggestion, index) => {
                const suggestionId = `${suggestion.title}-${suggestion.category}`;
                const isAccepted = acceptedSuggestions.has(suggestionId);
                const isRejected = rejectedSuggestions.has(suggestionId);
                
                return (
                  <div 
                    key={index} 
                    className={cn(
                      "border border-gray-200 rounded-lg p-3 transition-all",
                      isAccepted && "bg-green-50 border-green-200",
                      isRejected && "bg-red-50 border-red-200 opacity-50"
                    )}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="flex items-center space-x-2 mb-1">
                          <span className="text-sm font-medium text-gray-900">{suggestion.title}</span>
                          <Badge variant="secondary" className="text-xs">
                            {suggestion.category}
                          </Badge>
                        </div>
                        <p className="text-xs text-gray-600 mb-2">{suggestion.description}</p>
                        <p className="text-xs text-gray-500 italic">{suggestion.reasoning}</p>
                      </div>
                      {!isAccepted && !isRejected && (
                        <div className="flex space-x-1 ml-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleAcceptSuggestion(suggestion)}
                            disabled={addTaskMutation.isPending}
                            className="text-green-600 hover:text-green-700 p-1"
                          >
                            <ThumbsUp className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRejectSuggestion(suggestion)}
                            className="text-red-600 hover:text-red-700 p-1"
                          >
                            <ThumbsDown className="w-4 h-4" />
                          </Button>
                        </div>
                      )}
                      {isAccepted && (
                        <Check className="w-4 h-4 text-green-600 ml-2" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-4 text-gray-500">
              <Sparkles className="w-8 h-8 mx-auto mb-2 text-gray-300" />
              <p className="text-sm">No new suggestions at this time.</p>
              <p className="text-xs text-gray-400 mt-1">Check back later for more AI recommendations.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
