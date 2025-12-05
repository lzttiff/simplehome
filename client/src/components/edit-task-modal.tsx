import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { MaintenanceTask } from "@shared/schema";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface EditTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: MaintenanceTask;
}

const formSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required"),
  category: z.string().min(1, "Category is required"),
  priority: z.enum(["Low", "Medium", "High", "Urgent"]),
  brand: z.string().optional(),
  model: z.string().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
  lastMaintenanceDateMinor: z.date().optional().nullable(),
  lastMaintenanceDateMajor: z.date().optional().nullable(),
  minorTasks: z.string().optional(),
  majorTasks: z.string().optional(),
});

type FormData = z.infer<typeof formSchema>;

const categories = [
  "Appliances",
  "HVAC & Mechanical",
  "Plumbing & Water",
  "Electrical & Lighting",
  "Structural & Exterior",
  "Interior & Finishes",
  "Safety & Fire",
  "Yard & Outdoor Equipment",
  "IT & Communications",
  "Furniture & Fixtures",
  "Turnover & Tenant-ready"
];

const priorities = ["Low", "Medium", "High", "Urgent"];

export default function EditTaskModal({ isOpen, onClose, task }: EditTaskModalProps) {
  const [isMinorCalendarOpen, setIsMinorCalendarOpen] = useState(false);
  const [isMajorCalendarOpen, setIsMajorCalendarOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Parse lastMaintenanceDate from task
  const getLastMaintenanceDates = () => {
    try {
      if (task.lastMaintenanceDate) {
        const parsed = JSON.parse(task.lastMaintenanceDate);
        return {
          minor: parsed.minor ? new Date(parsed.minor) : null,
          major: parsed.major ? new Date(parsed.major) : null,
        };
      }
    } catch (e) {
      console.error("Error parsing lastMaintenanceDate:", e);
    }
    return { minor: null, major: null };
  };

  // Parse task lists from JSON
  const getTaskList = (taskListJson: string | null) => {
    if (!taskListJson) return "";
    try {
      const parsed = JSON.parse(taskListJson);
      if (Array.isArray(parsed)) {
        return parsed.join("\n");
      }
    } catch (e) {
      console.error("Error parsing task list:", e);
    }
    return "";
  };

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: task.title,
      description: task.description,
      category: task.category,
      priority: task.priority as "Low" | "Medium" | "High" | "Urgent",
      brand: task.brand || "",
      model: task.model || "",
      location: task.location || "",
      notes: task.notes || "",
      lastMaintenanceDateMinor: getLastMaintenanceDates().minor,
      lastMaintenanceDateMajor: getLastMaintenanceDates().major,
      minorTasks: getTaskList(task.minorTasks),
      majorTasks: getTaskList(task.majorTasks),
    },
  });

  // Reset form when task changes
  useEffect(() => {
    const dates = getLastMaintenanceDates();
    form.reset({
      title: task.title,
      description: task.description,
      category: task.category,
      priority: task.priority as "Low" | "Medium" | "High" | "Urgent",
      brand: task.brand || "",
      model: task.model || "",
      location: task.location || "",
      notes: task.notes || "",
      lastMaintenanceDateMinor: dates.minor,
      lastMaintenanceDateMajor: dates.major,
      minorTasks: getTaskList(task.minorTasks),
      majorTasks: getTaskList(task.majorTasks),
    });
  }, [task, form]);

  const updateTaskMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const lastMaintenanceDate = JSON.stringify({
        minor: data.lastMaintenanceDateMinor?.toISOString() || null,
        major: data.lastMaintenanceDateMajor?.toISOString() || null,
      });
      
      // Parse task lists from newline-separated strings to JSON arrays
      const parseTaskList = (taskString: string | undefined) => {
        if (!taskString || !taskString.trim()) return null;
        const tasks = taskString.split("\n")
          .map(t => t.trim())
          .filter(t => t.length > 0);
        return tasks.length > 0 ? JSON.stringify(tasks) : null;
      };
      
      const response = await apiRequest("PATCH", `/api/tasks/${task.id}`, {
        title: data.title,
        description: data.description,
        category: data.category,
        priority: data.priority,
        status: data.status,
        brand: data.brand || null,
        model: data.model || null,
        location: data.location || null,
        notes: data.notes || null,
        lastMaintenanceDate,
        minorTasks: parseTaskList(data.minorTasks),
        majorTasks: parseTaskList(data.majorTasks),
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({
        title: "Item / Task updated",
        description: "Item / task has been updated successfully.",
      });
      onClose();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update item / task",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: FormData) => {
    updateTaskMutation.mutate(data);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Item / Task</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Item / Task Title</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter item / task title" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="Enter item / task description and instructions"
                      rows={3}
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {categories.map((category) => (
                          <SelectItem key={category} value={category}>
                            {category}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Priority</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select priority" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {priorities.map((priority) => (
                          <SelectItem key={priority} value={priority}>
                            {priority}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="brand"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Brand (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="Brand" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="model"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Model (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="Model" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="location"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Location (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="Location" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="space-y-4">
              <FormField
                control={form.control}
                name="lastMaintenanceDateMinor"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Last Maintenance Date - Minor (Optional)</FormLabel>
                    <Popover open={isMinorCalendarOpen} onOpenChange={setIsMinorCalendarOpen}>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            className={cn(
                              "w-full pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                          >
                            {field.value ? (
                              format(field.value, "PPP")
                            ) : (
                              <span>Pick a date</span>
                            )}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value || undefined}
                          onSelect={(date) => {
                            field.onChange(date);
                            setIsMinorCalendarOpen(false);
                          }}
                          disabled={(date) => date > new Date()}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="lastMaintenanceDateMajor"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Last Maintenance Date - Major (Optional)</FormLabel>
                    <Popover open={isMajorCalendarOpen} onOpenChange={setIsMajorCalendarOpen}>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            className={cn(
                              "w-full pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                          >
                            {field.value ? (
                              format(field.value, "PPP")
                            ) : (
                              <span>Pick a date</span>
                            )}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value || undefined}
                          onSelect={(date) => {
                            field.onChange(date);
                            setIsMajorCalendarOpen(false);
                          }}
                          disabled={(date) => date > new Date()}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes (Optional)</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="Additional notes or instructions"
                      rows={2}
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-4">
              <FormField
                control={form.control}
                name="minorTasks"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-blue-600">Minor Maintenance Tasks (Optional)</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Enter each task on a new line&#10;Example:&#10;Inspect for cracks&#10;Clean filters&#10;Check connections"
                        rows={4}
                        {...field}
                        value={field.value ?? ""}
                        className="font-mono text-sm"
                      />
                    </FormControl>
                    <FormMessage />
                    <p className="text-xs text-muted-foreground">Enter one task per line</p>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="majorTasks"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-purple-600">Major Maintenance Tasks (Optional)</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Enter each task on a new line&#10;Example:&#10;Full system inspection&#10;Replace worn parts&#10;Professional service"
                        rows={4}
                        {...field}
                        value={field.value ?? ""}
                        className="font-mono text-sm"
                      />
                    </FormControl>
                    <FormMessage />
                    <p className="text-xs text-muted-foreground">Enter one task per line</p>
                  </FormItem>
                )}
              />
            </div>

            <div className="flex justify-end space-x-3 pt-4">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateTaskMutation.isPending}>
                {updateTaskMutation.isPending ? "Updating..." : "Update Task"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
