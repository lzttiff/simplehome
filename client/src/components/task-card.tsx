import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MaintenanceTask } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Edit2, Trash2, Check } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface TaskCardProps {
  task: MaintenanceTask;
}

const categoryColors = {
  HVAC: "bg-red-500 text-white",
  Plumbing: "bg-blue-500 text-white", 
  Electrical: "bg-yellow-500 text-white",
  Exterior: "bg-green-500 text-white",
  Interior: "bg-purple-500 text-white",
  Safety: "bg-orange-500 text-white",
  Landscaping: "bg-emerald-500 text-white",
};

const priorityColors = {
  Urgent: "bg-red-100 text-red-800",
  High: "bg-orange-100 text-orange-800",
  Medium: "bg-yellow-100 text-yellow-800",
  Low: "bg-blue-100 text-blue-800",
};

const statusColors = {
  pending: "bg-gray-100 text-gray-800",
  completed: "bg-green-100 text-green-800",
  overdue: "bg-red-100 text-red-800",
};

export default function TaskCard({ task }: TaskCardProps) {
  const [isCompleting, setIsCompleting] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const updateTaskMutation = useMutation({
    mutationFn: async (updates: Partial<MaintenanceTask>) => {
      const response = await apiRequest("PATCH", `/api/tasks/${task.id}`, updates);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({
        title: "Task updated",
        description: "Task has been updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update task",
        variant: "destructive",
      });
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/tasks/${task.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({
        title: "Task deleted",
        description: "Task has been deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete task",
        variant: "destructive",
      });
    },
  });

  const handleToggleComplete = async (checked: boolean) => {
    setIsCompleting(true);
    
    const updates: Partial<MaintenanceTask> = {
      status: checked ? "completed" : "pending",
      completedAt: checked ? new Date() : null,
    };

    updateTaskMutation.mutate(updates);
    setIsCompleting(false);
  };

  const handleDelete = () => {
    if (window.confirm("Are you sure you want to delete this task?")) {
      deleteTaskMutation.mutate();
    }
  };

  const formatDate = (date: Date | string | null) => {
    if (!date) return "Not set";
    return new Date(date).toLocaleDateString();
  };

  const isOverdue = task.dueDate && task.status !== "completed" && new Date(task.dueDate) < new Date();
  const currentStatus = isOverdue ? "overdue" : task.status;

  return (
    <Card className={cn(
      "p-4 hover:shadow-md transition-shadow",
      task.status === "completed" && "opacity-75"
    )}>
      <div className="flex items-start justify-between">
        <div className="flex items-start space-x-3 flex-1">
          <Checkbox
            checked={task.status === "completed"}
            onCheckedChange={handleToggleComplete}
            disabled={isCompleting || updateTaskMutation.isPending}
            className="mt-1"
          />
          <div className="flex-1">
            <div className="flex items-center space-x-2 mb-2">
              <Badge 
                variant="secondary" 
                className={cn("text-xs", categoryColors[task.category as keyof typeof categoryColors] || "bg-gray-500 text-white")}
              >
                {task.category}
              </Badge>
              <Badge 
                variant="secondary" 
                className={cn("text-xs", priorityColors[task.priority as keyof typeof priorityColors])}
              >
                {task.priority}
              </Badge>
              {task.isAiGenerated && (
                <Badge variant="secondary" className="text-xs bg-accent text-white">
                  🤖 AI
                </Badge>
              )}
              <Badge 
                variant="secondary" 
                className={cn("text-xs", statusColors[currentStatus as keyof typeof statusColors])}
              >
                {currentStatus === "overdue" ? "Overdue" : task.status === "completed" ? "Completed" : "Pending"}
              </Badge>
            </div>
            <h4 className={cn(
              "font-medium text-gray-900",
              task.status === "completed" && "line-through text-gray-500"
            )}>
              {task.title}
            </h4>
            <p className={cn(
              "text-sm mt-1",
              task.status === "completed" ? "text-gray-400" : "text-gray-600"
            )}>
              {task.description}
            </p>
            <div className="flex items-center space-x-4 mt-2 text-sm text-gray-500">
              {task.dueDate && (
                <span className={cn(isOverdue && "text-red-600 font-medium")}>
                  Due: {formatDate(task.dueDate)}
                </span>
              )}
              {task.lastCompleted && (
                <span>Last: {formatDate(task.lastCompleted)}</span>
              )}
              {task.completedAt && (
                <span className="text-green-600">
                  Completed: {formatDate(task.completedAt)}
                </span>
              )}
            </div>
            {task.notes && (
              <p className="text-sm text-gray-500 mt-1 italic">{task.notes}</p>
            )}
          </div>
        </div>
        <div className="flex items-center space-x-2 ml-4">
          {task.status === "completed" ? (
            <Check className="w-5 h-5 text-green-500" />
          ) : (
            <>
              <Button variant="ghost" size="sm">
                <Edit2 className="w-4 h-4" />
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={handleDelete}
                disabled={deleteTaskMutation.isPending}
                className="text-gray-400 hover:text-red-600"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
