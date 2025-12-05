import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
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
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilters, setCategoryFilters] = useState<CategoryFilter[]>([]);
  const [showAddTaskModal, setShowAddTaskModal] = useState(false);
  const [loadingCategories, setLoadingCategories] = useState<Record<string, boolean>>({});
  const [abortControllers, setAbortControllers] = useState<Record<string, AbortController>>({});
  const [sortBy, setSortBy] = useState<"default" | "nextDate">("default");
  const [dateFilter, setDateFilter] = useState<"all" | "90days" | "180days" | "1year">("all");

  const { data: tasks = [], isLoading: tasksLoading } = useQuery<MaintenanceTask[]>({
    queryKey: ["/api/tasks", { search: searchTerm, templateId }],
  });

  // Debug logging
  console.log('Dashboard - templateId:', templateId);
  console.log('Dashboard - tasks count:', tasks.length);
  console.log('Dashboard - sample task templateIds:', tasks.slice(0, 3).map(t => ({ title: t.title, templateId: t.templateId })));

  const { data: stats } = useQuery<TaskStats>({
    queryKey: ["/api/stats"],
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

  const handleAIScheduleForCategory = async (categoryName: string) => {
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
      const categoryTasks = tasks.filter(task => task.category === categoryName);
      
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
        body: JSON.stringify({ householdCatalog, provider: 'gemini' }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error('Failed to generate AI schedule');
      }

      const result = await response.json();
      console.log('AI Schedule Results for', categoryName, ':', result);
      
      // Show success message
      alert(`AI schedule generated for ${categoryName}! Check console for results.`);
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

  const filteredTasks = tasks.filter(task => {
    const categoryChecked = categoryFilters.find(f => f.category === task.category)?.checked ?? true;
    return categoryChecked;
  });

  // Apply date range filter
  const dateFilteredTasks = filteredTasks.filter(task => {
    if (dateFilter === "all") return true;
    
    try {
      if (!task.nextMaintenanceDate) return false;
      const nextDates = JSON.parse(task.nextMaintenanceDate);
      const minorDate = nextDates.minor ? new Date(nextDates.minor) : null;
      const majorDate = nextDates.major ? new Date(nextDates.major) : null;
      
      // Get the closer date
      let closerDate: Date | null = null;
      if (minorDate && majorDate) {
        closerDate = minorDate < majorDate ? minorDate : majorDate;
      } else if (minorDate) {
        closerDate = minorDate;
      } else if (majorDate) {
        closerDate = majorDate;
      }
      
      if (!closerDate) return false;
      
      const today = new Date();
      const daysDiff = Math.ceil((closerDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      
      if (dateFilter === "90days") {
        return daysDiff >= 0 && daysDiff <= 90;
      } else if (dateFilter === "180days") {
        return daysDiff >= 0 && daysDiff <= 180;
      } else if (dateFilter === "1year") {
        return daysDiff >= 0 && daysDiff <= 365;
      }
    } catch {
      return false;
    }
    
    return true;
  });

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
              <Button onClick={() => setShowAddTaskModal(true)} className="bg-primary text-white hover:bg-blue-700">
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
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Custom Item / Task
                </Button>
                <Button variant="outline" className="w-full">
                  📋 Export Schedule
                </Button>
              </CardContent>
            </Card>

            {/* Category Filter */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Categories</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {categoryFilters.map((filter) => (
                  <div key={filter.category} className="flex items-center space-x-2 group">
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
                        onClick={() => handleAIScheduleForCategory(filter.category)}
                        title="Generate AI schedule for this category"
                      >
                        <Sparkles className="h-3 w-3 text-purple-600" />
                      </Button>
                    )}
                    <Badge variant="secondary" className="text-xs">
                      {filter.count}
                    </Badge>
                  </div>
                ))}
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
                      <p className="text-2xl font-bold text-gray-900">{stats?.total || 0}</p>
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
                    <select
                      value={dateFilter}
                      onChange={(e) => setDateFilter(e.target.value as "all" | "90days" | "180days" | "1year")}
                      className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="all">Filter: All</option>
                      <option value="90days">Due within 90 days</option>
                      <option value="180days">Due within 180 days</option>
                      <option value="1year">Due within 1 year</option>
                    </select>
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
                    <TaskCard key={task.id} task={task} />
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
    </div>
  );
}
