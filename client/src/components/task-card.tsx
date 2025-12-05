import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MaintenanceTask } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Edit2, Trash2, Sparkles } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import EditTaskModal from "./edit-task-modal";

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

export default function TaskCard({ task }: TaskCardProps) {
  const [isCompleting, setIsCompleting] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isMinorCalendarOpen, setIsMinorCalendarOpen] = useState(false);
  const [isMajorCalendarOpen, setIsMajorCalendarOpen] = useState(false);
  const [isLoadingAI, setIsLoadingAI] = useState(false);
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

  const handleMinorDateSelect = async (date: Date | undefined) => {
    if (!date) {
      // User canceled or closed calendar without selecting
      setIsMinorCalendarOpen(false);
      return;
    }
    
    setIsCompleting(true);
    setIsMinorCalendarOpen(false);
    
    try {
      const lastMaintenance = task.lastMaintenanceDate ? JSON.parse(task.lastMaintenanceDate) : { minor: null, major: null };
      const nextMaintenance = task.nextMaintenanceDate ? JSON.parse(task.nextMaintenanceDate) : { minor: null, major: null };
      
      // Store previous dates before updating
      sessionStorage.setItem(`task-${task.id}-minor-prev`, JSON.stringify({
        lastMaintenanceDate: lastMaintenance.minor,
        nextMaintenanceDate: nextMaintenance.minor
      }));
      
      lastMaintenance.minor = date.toISOString();
      
      // Calculate nextMaintenanceDate.minor based on formula: lastMaintenanceDate.minor + minorIntervalMonths
      if (task.minorIntervalMonths) {
        const nextDate = new Date(date);
        nextDate.setMonth(nextDate.getMonth() + task.minorIntervalMonths);
        nextMaintenance.minor = nextDate.toISOString();
      }
      
      const updates: Partial<MaintenanceTask> = {
        lastMaintenanceDate: JSON.stringify(lastMaintenance),
        nextMaintenanceDate: JSON.stringify(nextMaintenance),
      };

      updateTaskMutation.mutate(updates);
    } catch (error) {
      console.error('Error updating minor maintenance:', error);
    } finally {
      setIsCompleting(false);
    }
  };

  const handleMajorDateSelect = async (date: Date | undefined) => {
    if (!date) {
      // User canceled or closed calendar without selecting
      setIsMajorCalendarOpen(false);
      return;
    }
    
    setIsCompleting(true);
    setIsMajorCalendarOpen(false);
    
    try {
      const lastMaintenance = task.lastMaintenanceDate ? JSON.parse(task.lastMaintenanceDate) : { minor: null, major: null };
      const nextMaintenance = task.nextMaintenanceDate ? JSON.parse(task.nextMaintenanceDate) : { minor: null, major: null };
      
      // Store previous dates before updating
      sessionStorage.setItem(`task-${task.id}-major-prev`, JSON.stringify({
        lastMaintenanceDate: lastMaintenance.major,
        nextMaintenanceDate: nextMaintenance.major
      }));
      
      lastMaintenance.major = date.toISOString();
      
      // Calculate nextMaintenanceDate.major based on formula: lastMaintenanceDate.major + majorIntervalMonths
      if (task.majorIntervalMonths) {
        const nextDate = new Date(date);
        nextDate.setMonth(nextDate.getMonth() + task.majorIntervalMonths);
        nextMaintenance.major = nextDate.toISOString();
      }
      
      const updates: Partial<MaintenanceTask> = {
        lastMaintenanceDate: JSON.stringify(lastMaintenance),
        nextMaintenanceDate: JSON.stringify(nextMaintenance),
      };

      updateTaskMutation.mutate(updates);
    } catch (error) {
      console.error('Error updating major maintenance:', error);
    } finally {
      setIsCompleting(false);
    }
  };

  const handleToggleMinorComplete = async (checked: boolean) => {
    if (checked) {
      // Open calendar to select completion date
      setIsMinorCalendarOpen(true);
    } else {
      // Unchecking - restore previous dates
      if (window.confirm("Restore the previous minor maintenance dates?")) {
        setIsCompleting(true);
        try {
          const lastMaintenance = task.lastMaintenanceDate ? JSON.parse(task.lastMaintenanceDate) : { minor: null, major: null };
          const nextMaintenance = task.nextMaintenanceDate ? JSON.parse(task.nextMaintenanceDate) : { minor: null, major: null };
          
          // Restore previous dates from sessionStorage
          const prevData = sessionStorage.getItem(`task-${task.id}-minor-prev`);
          if (prevData) {
            const prev = JSON.parse(prevData);
            lastMaintenance.minor = prev.lastMaintenanceDate;
            nextMaintenance.minor = prev.nextMaintenanceDate;
            sessionStorage.removeItem(`task-${task.id}-minor-prev`);
          } else {
            // If no previous data, clear the dates
            lastMaintenance.minor = null;
          }
          
          const updates: Partial<MaintenanceTask> = {
            lastMaintenanceDate: JSON.stringify(lastMaintenance),
            nextMaintenanceDate: JSON.stringify(nextMaintenance),
          };

          updateTaskMutation.mutate(updates);
        } catch (error) {
          console.error('Error restoring minor maintenance:', error);
        } finally {
          setIsCompleting(false);
        }
      }
    }
  };

  const handleToggleMajorComplete = async (checked: boolean) => {
    if (checked) {
      // Open calendar to select completion date
      setIsMajorCalendarOpen(true);
    } else {
      // Unchecking - restore previous dates
      if (window.confirm("Restore the previous major maintenance dates?")) {
        setIsCompleting(true);
        try {
          const lastMaintenance = task.lastMaintenanceDate ? JSON.parse(task.lastMaintenanceDate) : { minor: null, major: null };
          const nextMaintenance = task.nextMaintenanceDate ? JSON.parse(task.nextMaintenanceDate) : { minor: null, major: null };
          
          // Restore previous dates from sessionStorage
          const prevData = sessionStorage.getItem(`task-${task.id}-major-prev`);
          if (prevData) {
            const prev = JSON.parse(prevData);
            lastMaintenance.major = prev.lastMaintenanceDate;
            nextMaintenance.major = prev.nextMaintenanceDate;
            sessionStorage.removeItem(`task-${task.id}-major-prev`);
          } else {
            // If no previous data, clear the dates
            lastMaintenance.major = null;
          }
          
          const updates: Partial<MaintenanceTask> = {
            lastMaintenanceDate: JSON.stringify(lastMaintenance),
            nextMaintenanceDate: JSON.stringify(nextMaintenance),
          };

          updateTaskMutation.mutate(updates);
        } catch (error) {
          console.error('Error restoring major maintenance:', error);
        } finally {
          setIsCompleting(false);
        }
      }
    }
  };

  const handleDelete = () => {
    if (window.confirm("Are you sure you want to delete this task?")) {
      deleteTaskMutation.mutate();
    }
  };

  const handleAISchedule = async () => {
    setIsLoadingAI(true);
    
    try {
      // Build the item structure for API call
      const item = {
        id: task.id,
        name: task.title,
        brand: task.brand || "",
        model: task.model || "",
        installationDate: task.installationDate || "",
        lastMaintenanceDate: task.lastMaintenanceDate ? JSON.parse(task.lastMaintenanceDate) : { minor: null, major: null },
        nextMaintenanceDate: task.nextMaintenanceDate ? JSON.parse(task.nextMaintenanceDate) : { minor: null, major: null },
        location: task.location || "",
        notes: task.notes || ""
      };

      const response = await fetch('/api/item-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item, provider: 'gemini' })
      });

      if (!response.ok) {
        throw new Error('Failed to generate AI schedule');
      }

      const data = await response.json();
      const result = data.result;
      
      // Update the task with AI results
      const updates: any = {};
      
      if (result.nextMaintenanceDates) {
        updates.nextMaintenanceDate = JSON.stringify({
          minor: result.nextMaintenanceDates.minor || null,
          major: result.nextMaintenanceDates.major || null
        });
      }
      
      if (result.maintenanceSchedule) {
        if (result.maintenanceSchedule.minorIntervalMonths) {
          updates.minorIntervalMonths = parseInt(result.maintenanceSchedule.minorIntervalMonths) || null;
        }
        if (result.maintenanceSchedule.majorIntervalMonths) {
          updates.majorIntervalMonths = parseInt(result.maintenanceSchedule.majorIntervalMonths) || null;
        }
        if (result.maintenanceSchedule.minorTasks && Array.isArray(result.maintenanceSchedule.minorTasks)) {
          updates.minorTasks = JSON.stringify(result.maintenanceSchedule.minorTasks);
        }
        if (result.maintenanceSchedule.majorTasks && Array.isArray(result.maintenanceSchedule.majorTasks)) {
          updates.majorTasks = JSON.stringify(result.maintenanceSchedule.majorTasks);
        }
      }
      
      if (result.reasoning) {
        updates.notes = result.reasoning;
      }
      
      if (Object.keys(updates).length > 0) {
        updateTaskMutation.mutate(updates);
        toast({
          title: "AI Schedule Generated",
          description: "Task has been updated with AI suggestions.",
        });
      }
    } catch (error) {
      console.error('Error generating AI schedule:', error);
      toast({
        title: "Error",
        description: "Failed to generate AI schedule",
        variant: "destructive",
      });
    } finally {
      setIsLoadingAI(false);
    }
  };

  const formatDate = (date: Date | string | null) => {
    if (!date) return "Not set";
    return new Date(date).toLocaleDateString();
  };

  // Check if task has AI-generated task lists
  const hasAITaskLists = () => {
    try {
      const minorTasks = task.minorTasks ? JSON.parse(task.minorTasks) : [];
      const majorTasks = task.majorTasks ? JSON.parse(task.majorTasks) : [];
      return (Array.isArray(minorTasks) && minorTasks.length > 0) || 
             (Array.isArray(majorTasks) && majorTasks.length > 0);
    } catch {
      return false;
    }
  };

  return (
    <Card className="p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
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
          </div>
          <h4 className="font-medium text-gray-900">
            {task.title}
          </h4>
          <p className="text-sm mt-1 text-gray-600">
            {task.description}
          </p>
          {task.notes && (
            <p className="text-sm text-gray-500 mt-2 italic">{task.notes}</p>
          )}
          
          {/* Checkboxes below description */}
          <div className="flex space-x-6 mt-3">
            {/* Minor Maintenance Checkbox with Tasks */}
            <div className="flex flex-col space-y-1">
              <div className="flex items-center space-x-1">
                <Popover open={isMinorCalendarOpen} onOpenChange={setIsMinorCalendarOpen}>
                  <PopoverTrigger asChild>
                    <div>
                      <Checkbox
                        checked={(() => {
                          try {
                            const lastMaintenance = task.lastMaintenanceDate ? JSON.parse(task.lastMaintenanceDate) : { minor: null, major: null };
                            return !!lastMaintenance.minor;
                          } catch {
                            return false;
                          }
                        })()}
                        onCheckedChange={handleToggleMinorComplete}
                        disabled={isCompleting || updateTaskMutation.isPending}
                        title="Click to select completion date"
                        className="h-4 w-4"
                      />
                    </div>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={(() => {
                        try {
                          const lastMaintenance = task.lastMaintenanceDate ? JSON.parse(task.lastMaintenanceDate) : { minor: null, major: null };
                          return lastMaintenance.minor ? new Date(lastMaintenance.minor) : undefined;
                        } catch {
                          return undefined;
                        }
                      })()}
                      onSelect={handleMinorDateSelect}
                      disabled={(date) => date > new Date()}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <div className="flex flex-col">
                  <span className="text-xs text-blue-600 font-semibold">Minor</span>
                  {(() => {
                    try {
                      const lastMaintenance = task.lastMaintenanceDate ? JSON.parse(task.lastMaintenanceDate) : { minor: null, major: null };
                      const nextMaintenance = task.nextMaintenanceDate ? JSON.parse(task.nextMaintenanceDate) : { minor: null, major: null };
                      
                      if (lastMaintenance.minor) {
                        // Show lastMaintenanceDate when checked
                        return (
                          <span className="text-xs text-gray-500">
                            Last: {formatDate(lastMaintenance.minor)}
                          </span>
                        );
                      } else if (nextMaintenance.minor) {
                        // Show nextMaintenanceDate when unchecked
                        return (
                          <span className="text-xs text-gray-500">
                            Next: {formatDate(nextMaintenance.minor)}
                          </span>
                        );
                      }
                    } catch {
                      return null;
                    }
                    return null;
                  })()}
                </div>
              </div>
              {task.minorTasks && (() => {
                try {
                  const minorTasksList = JSON.parse(task.minorTasks);
                  const lastMaintenance = task.lastMaintenanceDate ? JSON.parse(task.lastMaintenanceDate) : { minor: null, major: null };
                  const nextMaintenance = task.nextMaintenanceDate ? JSON.parse(task.nextMaintenanceDate) : { minor: null, major: null };
                  const isChecked = !!lastMaintenance.minor;
                  
                  if (Array.isArray(minorTasksList) && minorTasksList.length > 0) {
                    return (
                      <ul className="ml-5 text-xs text-blue-700 space-y-0.5">
                        {minorTasksList.map((taskItem: string, idx: number) => (
                          <li key={idx} className="leading-tight">• {taskItem}</li>
                        ))}
                        {isChecked && nextMaintenance.minor && (
                          <li className="leading-tight text-gray-600 italic">Next: {formatDate(nextMaintenance.minor)}</li>
                        )}
                      </ul>
                    );
                  }
                } catch (e) {
                  return null;
                }
                return null;
              })()}
            </div>
            
            {/* Major Maintenance Checkbox with Tasks */}
            <div className="flex flex-col space-y-1">
              <div className="flex items-center space-x-1">
                <Popover open={isMajorCalendarOpen} onOpenChange={setIsMajorCalendarOpen}>
                  <PopoverTrigger asChild>
                    <div>
                      <Checkbox
                        checked={(() => {
                          try {
                            const lastMaintenance = task.lastMaintenanceDate ? JSON.parse(task.lastMaintenanceDate) : { minor: null, major: null };
                            return !!lastMaintenance.major;
                          } catch {
                            return false;
                          }
                        })()}
                        onCheckedChange={handleToggleMajorComplete}
                        disabled={isCompleting || updateTaskMutation.isPending}
                        title="Click to select completion date"
                        className="h-4 w-4"
                      />
                    </div>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={(() => {
                        try {
                          const lastMaintenance = task.lastMaintenanceDate ? JSON.parse(task.lastMaintenanceDate) : { minor: null, major: null };
                          return lastMaintenance.major ? new Date(lastMaintenance.major) : undefined;
                        } catch {
                          return undefined;
                        }
                      })()}
                      onSelect={handleMajorDateSelect}
                      disabled={(date) => date > new Date()}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <div className="flex flex-col">
                  <span className="text-xs text-purple-600 font-semibold">Major</span>
                  {(() => {
                    try {
                      const lastMaintenance = task.lastMaintenanceDate ? JSON.parse(task.lastMaintenanceDate) : { minor: null, major: null };
                      const nextMaintenance = task.nextMaintenanceDate ? JSON.parse(task.nextMaintenanceDate) : { minor: null, major: null };
                      
                      if (lastMaintenance.major) {
                        // Show lastMaintenanceDate when checked
                        return (
                          <span className="text-xs text-gray-500">
                            Last: {formatDate(lastMaintenance.major)}
                          </span>
                        );
                      } else if (nextMaintenance.major) {
                        // Show nextMaintenanceDate when unchecked
                        return (
                          <span className="text-xs text-gray-500">
                            Next: {formatDate(nextMaintenance.major)}
                          </span>
                        );
                      }
                    } catch {
                      return null;
                    }
                    return null;
                  })()}
                </div>
              </div>
              {task.majorTasks && (() => {
                try {
                  const majorTasksList = JSON.parse(task.majorTasks);
                  const lastMaintenance = task.lastMaintenanceDate ? JSON.parse(task.lastMaintenanceDate) : { minor: null, major: null };
                  const nextMaintenance = task.nextMaintenanceDate ? JSON.parse(task.nextMaintenanceDate) : { minor: null, major: null };
                  const isChecked = !!lastMaintenance.major;
                  
                  if (Array.isArray(majorTasksList) && majorTasksList.length > 0) {
                    return (
                      <ul className="ml-5 text-xs text-purple-700 space-y-0.5">
                        {majorTasksList.map((taskItem: string, idx: number) => (
                          <li key={idx} className="leading-tight">• {taskItem}</li>
                        ))}
                        {isChecked && nextMaintenance.major && (
                          <li className="leading-tight text-gray-600 italic">Next: {formatDate(nextMaintenance.major)}</li>
                        )}
                      </ul>
                    );
                  }
                } catch (e) {
                  return null;
                }
                return null;
              })()}
            </div>
          </div>
        </div>
        <div className="flex items-center space-x-2 ml-4">
          {!hasAITaskLists() && (
            <Button 
              variant="ghost" 
              size="sm"
              onClick={handleAISchedule}
              disabled={isLoadingAI}
              title="Generate AI maintenance schedule"
              className="text-purple-600 hover:text-purple-700"
            >
              {isLoadingAI ? (
                <div className="animate-spin h-4 w-4 border-2 border-purple-600 border-t-transparent rounded-full" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
            </Button>
          )}
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => setIsEditModalOpen(true)}
          >
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
        </div>
      </div>
      
      <EditTaskModal 
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        task={task}
      />
    </Card>
  );
}
