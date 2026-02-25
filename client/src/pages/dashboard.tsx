import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { MaintenanceTask } from "@shared/schema";
import { TaskStats, CategoryFilter } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Search, ClipboardList, Sparkles } from "lucide-react";
import TaskCard from "@/components/task-card";
import AddTaskModal from "@/components/add-task-modal";
import ExportScheduleModal from "@/components/export-schedule-modal";
import { cn } from "@/lib/utils";

const categoryColors = {
  Appliances: "bg-cyan-500",
  "HVAC & Mechanical": "bg-red-500",
  "Plumbing & Water": "bg-blue-500", 
  "Electrical & Lighting": "bg-yellow-500",
  "Structural & Exterior": "bg-green-500",
  "Interior & Finishes": "bg-purple-500",
  "Safety & Fire": "bg-orange-500",
  "Yard & Outdoor Equipment": "bg-emerald-500",
  "IT & Communications": "bg-indigo-500",
  "Furniture & Fixtures": "bg-pink-500",
};

export default function Dashboard() {
  const { templateId } = useParams();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilters, setCategoryFilters] = useState<CategoryFilter[]>([]);
  const [showAddTaskModal, setShowAddTaskModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [loadingCategories, setLoadingCategories] = useState<Record<string, boolean>>({});
  const [abortControllers, setAbortControllers] = useState<Record<string, AbortController>>({});
  const [sortBy, setSortBy] = useState<"default" | "nextDate">("default");
  const [dateFilter, setDateFilter] = useState<number | null>(null); // null = all, 0 = past due only, positive = past due + days
  const [includeMinor, setIncludeMinor] = useState(true);
  const [includeMajor, setIncludeMajor] = useState(true);

  const { data: tasks = [], isLoading: tasksLoading } = useQuery<MaintenanceTask[]>({
    queryKey: ["/api/tasks", { search: searchTerm, templateId }],
  });

  // Debug logging
  console.log('Dashboard - templateId:', templateId);
  console.log('Dashboard - tasks count:', tasks.length);
  console.log('Dashboard - sample task templateIds:', tasks.slice(0, 3).map(t => ({ title: t.title, templateId: t.templateId })));

  const { data: stats } = useQuery<TaskStats>({
    queryKey: ["/api/stats", { templateId }],
  });

  // Update category filters when tasks change
  // Note: tasks are already filtered by templateId from the backend API
  useEffect(() => {
    const categoryCounts = tasks.reduce((acc, task) => {
      acc[task.category] = (acc[task.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const newFilters = Object.entries(categoryCounts).map(([category, count]) => ({
      category,
      color: categoryColors[category as keyof typeof categoryColors] || "bg-gray-500",
      count,
      checked: true,
    }));

    // Only update if the categories have actually changed
    setCategoryFilters(prev => {
      if (prev.length === 0) return newFilters;
      
      // Check if categories changed by comparing category names
      const prevCategories = prev.map(f => f.category).sort().join(',');
      const newCategories = newFilters.map(f => f.category).sort().join(',');
      
      if (prevCategories !== newCategories) {
        return newFilters;
      }
      
      // Update counts only, preserve checked state
      return prev.map(filter => {
        const newFilter = newFilters.find(f => f.category === filter.category);
        return newFilter ? { ...filter, count: newFilter.count } : filter;
      });
    });
  }, [tasks]);

  const toggleCategoryFilter = (category: string) => {
    setCategoryFilters(prev => 
      prev.map(filter => 
        filter.category === category 
          ? { ...filter, checked: !filter.checked }
          : filter
      )
    );
  };

  const toggleAllCategories = () => {
    const allChecked = categoryFilters.every(f => f.checked);
    setCategoryFilters(prev => 
      prev.map(filter => ({ ...filter, checked: !allChecked }))
    );
  };

  const hasAITaskLists = (task: MaintenanceTask) => {
    try {
      const minorTasks = task.minorTasks ? JSON.parse(task.minorTasks) : [];
      const majorTasks = task.majorTasks ? JSON.parse(task.majorTasks) : [];
      return (Array.isArray(minorTasks) && minorTasks.length > 0) || 
             (Array.isArray(majorTasks) && majorTasks.length > 0);
    } catch {
      return false;
    }
  };

  const handleAIScheduleForCategory = async (categoryName: string, includeAll: boolean = true, showNoItemsAlert: boolean = true) => {
    // If already loading, ask to cancel
    if (loadingCategories[categoryName]) {
      const confirmCancel = window.confirm(`AI generation is in progress for ${categoryName}. Do you want to cancel it?`);
      if (confirmCancel && abortControllers[categoryName]) {
        // Abort the request
        abortControllers[categoryName].abort();
        // Clean up state
        setLoadingCategories(prev => ({ ...prev, [categoryName]: false }));
        setAbortControllers(prev => {
          const { [categoryName]: _, ...rest } = prev;
          return rest;
        });
        console.log('AI generation cancelled for', categoryName);
      }
      return;
    }

    // Create a new AbortController for this request
    const controller = new AbortController();
    setAbortControllers(prev => ({ ...prev, [categoryName]: controller }));
    setLoadingCategories(prev => ({ ...prev, [categoryName]: true }));
    
    try {
      // Get all tasks for this category
      let categoryTasks = tasks.filter(task => task.category === categoryName);
      
      // Filter to only tasks without AI suggestions if includeAll is false
      if (!includeAll) {
        categoryTasks = categoryTasks.filter(task => !hasAITaskLists(task));
        if (categoryTasks.length === 0) {
          if (showNoItemsAlert) {
            alert(`All items in ${categoryName} already have AI suggestions.`);
          }
          return;
        }
      }
      
      // Build the householdCatalog structure for this category
      const householdCatalog = [{
        categoryName,
        items: categoryTasks.map(task => ({
          id: task.id,
          name: task.title,
          brand: task.brand || "",
          model: task.model || "",
          installationDate: task.installationDate || "",
          lastMaintenanceDate: task.lastMaintenanceDate ? JSON.parse(task.lastMaintenanceDate) : { minor: null, major: null },
          nextMaintenanceDate: task.nextMaintenanceDate ? JSON.parse(task.nextMaintenanceDate) : { minor: null, major: null },
          location: task.location || "",
          notes: task.notes || ""
        }))
      }];

      const response = await fetch('/api/category-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ householdCatalog }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error('Failed to generate AI schedule');
      }

      const result = await response.json();
      console.log('AI Schedule Results for', categoryName, ':', result);
      
      // Invalidate queries to refresh the UI
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      
      // Show success message
      const updatedCount = result.updatedCount || categoryTasks.length;
      alert(`AI schedule generated for ${categoryName}! ${updatedCount} items updated.`);
    } catch (error) {
      // Don't show error if request was aborted
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('AI generation aborted for', categoryName);
        alert(`AI generation cancelled for ${categoryName}`);
      } else {
        console.error('Error generating AI schedule:', error);
        alert(`Failed to generate AI schedule for ${categoryName}`);
      }
    } finally {
      setLoadingCategories(prev => ({ ...prev, [categoryName]: false }));
      setAbortControllers(prev => {
        const { [categoryName]: _, ...rest } = prev;
        return rest;
      });
    }
  };

  const handleAIScheduleForAllCategories = async (includeAll: boolean) => {
    // Get all checked categories
    const checkedCategories = categoryFilters.filter(f => f.checked);
    
    // If not includeAll, pre-filter to only categories with items without AI suggestions
    let categoriesToProcess = checkedCategories;
    if (!includeAll) {
      categoriesToProcess = checkedCategories.filter(filter => {
        const categoryTasks = tasks.filter(task => task.category === filter.category);
        const tasksWithoutAI = categoryTasks.filter(task => !hasAITaskLists(task));
        return tasksWithoutAI.length > 0;
      });
      
      if (categoriesToProcess.length === 0) {
        alert("All items in the selected categories already have AI suggestions.");
        return;
      }
    }
    
    const confirmMessage = includeAll 
      ? "Generate AI suggestions for all items in all categories? This may take a while."
      : `Generate AI suggestions for items without existing suggestions in ${categoriesToProcess.length} ${categoriesToProcess.length === 1 ? 'category' : 'categories'}? This may take a while.`;
    
    if (!window.confirm(confirmMessage)) {
      return;
    }
    
    // Process all categories in parallel
    const promises = categoriesToProcess.map(filter => 
      handleAIScheduleForCategory(filter.category, includeAll, false)
    );
    
    try {
      await Promise.all(promises);
      alert(`AI generation complete for ${categoriesToProcess.length} ${categoriesToProcess.length === 1 ? 'category' : 'categories'}!`);
    } catch (error) {
      console.error('Error in parallel AI generation:', error);
      // Individual errors are already handled in handleAIScheduleForCategory
    }
  };

  // Helper function to check if a maintenance date passes the date filter
  const passesDateFilter = (maintenanceDate: string | null): boolean => {
    if (!maintenanceDate) return false;
    if (dateFilter === null) return true; // Show all
    
    try {
      const date = new Date(maintenanceDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const daysDiff = Math.ceil((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      
      if (dateFilter === 0) {
        return daysDiff < 0; // Past due only
      } else if (dateFilter > 0) {
        return daysDiff <= dateFilter; // Past due + within specified days
      }
    } catch {
      return false;
    }
    return false;
  };

  // Calculate which maintenance types to show for each task
  interface TaskWithFilters extends MaintenanceTask {
    showMinor: boolean;
    showMajor: boolean;
  }

  const filteredTasks: TaskWithFilters[] = tasks
    .filter(task => {
      // First apply category filter
      const categoryChecked = categoryFilters.find(f => f.category === task.category)?.checked ?? true;
      return categoryChecked;
    })
    .map(task => {
      // For each task, determine which maintenance types to show
      let showMinor = false;
      let showMajor = false;

      try {
        const nextMaintenance = task.nextMaintenanceDate ? JSON.parse(task.nextMaintenanceDate) : null;
        
        // Check minor maintenance
        if (includeMinor) {
          if (dateFilter === null) {
            // No date filter - show if it exists
            showMinor = !!nextMaintenance?.minor;
          } else {
            // Date filter active - check if minor passes
            showMinor = passesDateFilter(nextMaintenance?.minor);
          }
        }

        // Check major maintenance
        if (includeMajor) {
          if (dateFilter === null) {
            // No date filter - show if it exists
            showMajor = !!nextMaintenance?.major;
          } else {
            // Date filter active - check if major passes
            showMajor = passesDateFilter(nextMaintenance?.major);
          }
        }

        // If task has no maintenance dates at all, show it with both flags true (but sections won't render if dates don't exist)
        if (!nextMaintenance || (!nextMaintenance.minor && !nextMaintenance.major)) {
          showMinor = includeMinor;
          showMajor = includeMajor;
        }
      } catch {
        // On error, default to showing based on type filters
        showMinor = includeMinor;
        showMajor = includeMajor;
      }

      return {
        ...task,
        showMinor,
        showMajor,
      };
    })
    .filter(task => {
      // Only show tasks where at least one maintenance type passes the filters
      return task.showMinor || task.showMajor;
    });

  // Remove old filtering logic
  const dateFilteredTasks = filteredTasks;

  // Sort tasks based on selected option
  const sortedTasks = [...dateFilteredTasks].sort((a, b) => {
    if (sortBy === "nextDate") {
      // Get the closer nextMaintenanceDate for each task
      const getCloserDate = (task: MaintenanceTask): Date | null => {
        try {
          if (!task.nextMaintenanceDate) return null;
          const nextDates = JSON.parse(task.nextMaintenanceDate);
          const minorDate = nextDates.minor ? new Date(nextDates.minor) : null;
          const majorDate = nextDates.major ? new Date(nextDates.major) : null;
          
          if (!minorDate && !majorDate) return null;
          if (!minorDate) return majorDate;
          if (!majorDate) return minorDate;
          
          return minorDate < majorDate ? minorDate : majorDate;
        } catch {
          return null;
        }
      };
      
      const dateA = getCloserDate(a);
      const dateB = getCloserDate(b);
      
      // Tasks without dates go to the end
      if (!dateA && !dateB) return 0;
      if (!dateA) return 1;
      if (!dateB) return -1;
      
      return dateA.getTime() - dateB.getTime();
    }
    return 0; // Default: maintain original order
  });

  if (tasksLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <Link href="/">
                <h1 className="text-2xl font-bold text-primary cursor-pointer">🏠 HomeGuard</h1>
              </Link>
            </div>
            <nav className="hidden md:block">
              <div className="ml-10 flex items-baseline space-x-4">
                <Link href="/dashboard" className="text-primary font-medium px-3 py-2 rounded-md text-sm">Dashboard</Link>
                <Link href="/" className="text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm">Templates</Link>
              </div>
            </nav>
            <div className="flex items-center space-x-3">
              <Button onClick={() => setShowAddTaskModal(true)} className="bg-primary text-white hover:bg-blue-700" title="Add a new custom maintenance item or task">
                <Plus className="w-4 h-4 mr-2" />
                Add Item / Task
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Sidebar */}
          <div className="lg:col-span-1">
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="text-lg">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button 
                  onClick={() => setShowAddTaskModal(true)}
                  className="w-full bg-primary text-white hover:bg-blue-700"
                  title="Create a new custom maintenance item or task"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Custom Item / Task
                </Button>
                <Button 
                  variant="outline" 
                  className="w-full" 
                  title="Export your maintenance schedule to a file"
                  onClick={() => setShowExportModal(true)}
                >
                  📋 Export Schedule
                </Button>
              </CardContent>
            </Card>

            {/* Maintenance Type Filter */}
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="text-lg">Maintenance Type</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center space-x-2" title="Show tasks with minor maintenance scheduled">
                  <Checkbox
                    id="include-minor"
                    checked={includeMinor}
                    onCheckedChange={(checked) => setIncludeMinor(checked === true)}
                  />
                  <label htmlFor="include-minor" className="text-sm cursor-pointer">
                    Include Minor Maintenance
                  </label>
                </div>
                <div className="flex items-center space-x-2" title="Show tasks with major maintenance scheduled">
                  <Checkbox
                    id="include-major"
                    checked={includeMajor}
                    onCheckedChange={(checked) => setIncludeMajor(checked === true)}
                  />
                  <label htmlFor="include-major" className="text-sm cursor-pointer">
                    Include Major Maintenance
                  </label>
                </div>
                {!includeMinor && !includeMajor && (
                  <p className="text-xs text-red-600 mt-1">At least one type must be selected</p>
                )}
              </CardContent>
            </Card>

            {/* Category Filter */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Categories</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {/* Select All Checkbox */}
                <div className="flex items-center space-x-2 pb-2 border-b" title="Toggle selection of all categories at once">
                  <Checkbox
                    checked={categoryFilters.every(f => f.checked)}
                    onCheckedChange={toggleAllCategories}
                  />
                  <span className="text-sm font-medium">Select/Deselect All</span>
                </div>
                {categoryFilters.map((filter) => (
                  <div key={filter.category} className="flex items-center space-x-2 group" title={`Filter items by ${filter.category} category`}>
                    <Checkbox
                      checked={filter.checked}
                      onCheckedChange={() => toggleCategoryFilter(filter.category)}
                    />
                    <span className="text-sm flex-1">{filter.category}</span>
                    {loadingCategories[filter.category] ? (
                      <>
                        <div className="animate-spin h-3 w-3 border-2 border-primary border-t-transparent rounded-full" />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs"
                          onClick={() => handleAIScheduleForCategory(filter.category)}
                          title="Cancel AI generation"
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => handleAIScheduleForCategory(filter.category, false)}
                        title="Generate AI schedule for items without suggestions"
                      >
                        <Sparkles className="h-3 w-3 text-purple-600" />
                      </Button>
                    )}
                    <Badge variant="secondary" className="text-xs">
                      {filter.count}
                    </Badge>
                  </div>
                ))}
                <div className="pt-3 border-t space-y-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-xs"
                    onClick={() => handleAIScheduleForAllCategories(false)}
                    disabled={Object.values(loadingCategories).some(loading => loading)}
                    title="Generate AI maintenance schedules for items that don't have suggestions yet"
                  >
                    <Sparkles className="h-3 w-3 mr-2" />
                    AI for Items Without Suggestions
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-xs"
                    onClick={() => handleAIScheduleForAllCategories(true)}
                    disabled={Object.values(loadingCategories).some(loading => loading)}
                    title="Generate or regenerate AI maintenance schedules for all items in selected categories"
                  >
                    <Sparkles className="h-3 w-3 mr-2" />
                    AI for All Items
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Main Content */}
          <div className="lg:col-span-3">
            {/* Stats Overview */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center">
                    <div className="bg-blue-100 rounded-lg p-3">
                      <ClipboardList className="w-6 h-6 text-blue-600" />
                    </div>
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-600">Total Items / Tasks</p>
                      <p className="text-2xl font-bold text-gray-900">{tasks.length}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card 
                className={cn(
                  "cursor-pointer hover:shadow-lg transition-all",
                  dateFilter === 0 && "ring-2 ring-red-500 shadow-lg"
                )}
                onClick={() => setDateFilter(dateFilter === 0 ? null : 0)}
                title={dateFilter === 0 ? "Click to clear overdue filter" : "Click to filter and show only overdue tasks"}
              >
                <CardContent className="p-6">
                  <div className="flex items-center">
                    <div className="bg-red-100 rounded-lg p-3">
                      <ClipboardList className="w-6 h-6 text-red-600" />
                    </div>
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-600 flex items-center gap-1">
                        Over Due 
                        {dateFilter === 0 && <span className="text-red-600">🔍</span>}
                      </p>
                      <p className="text-2xl font-bold text-gray-900">{stats?.pastDue || 0}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

            </div>

            {/* Tasks Section */}
            <Card>
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <CardTitle className="text-lg">Items / Tasks</CardTitle>
                  <div className="flex gap-2">
                    <div className="flex items-center gap-2">
                      <label htmlFor="dateRange" className="text-sm text-gray-600 whitespace-nowrap">Due within:</label>
                      <input
                        id="dateRange"
                        type="number"
                        min="0"
                        placeholder="All"
                        value={dateFilter === null ? "" : dateFilter}
                        onChange={(e) => {
                          const value = e.target.value;
                          setDateFilter(value === "" ? null : parseInt(value, 10));
                        }}
                        className="w-20 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                      <span className="text-sm text-gray-600">days {dateFilter === 0 ? "(past due only)" : dateFilter !== null ? "(incl. past due)" : ""}</span>
                    </div>
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as "default" | "nextDate")}
                      className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="default">Sort: Default</option>
                      <option value="nextDate">Sort: Next Due Date</option>
                    </select>
                    <div className="relative">
                      <Search className="w-5 h-5 text-gray-400 absolute left-3 top-2.5" />
                      <Input
                        placeholder="Search Items / Tasks..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10 w-full sm:w-64"
                      />
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {sortedTasks.map((task) => (
                    <TaskCard 
                      key={task.id} 
                      task={task} 
                      showMinor={task.showMinor}
                      showMajor={task.showMajor}
                    />
                  ))}
                  {sortedTasks.length === 0 && (
                    <div className="text-center py-8 text-gray-500">
                      <ClipboardList className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                      <p>No Items / Tasks match your current filters.</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Modals */}
      {showAddTaskModal && (
        <AddTaskModal
          isOpen={showAddTaskModal}
          onClose={() => setShowAddTaskModal(false)}
        />
      )}
      
      {showExportModal && (
        <ExportScheduleModal
          isOpen={showExportModal}
          onClose={() => setShowExportModal(false)}
          tasks={sortedTasks}
        />
      )}
    </div>
  );
}
