import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { MaintenanceTask } from "@shared/schema";
import { TaskStats, CategoryFilter } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Search, ClipboardList, AlertCircle, Clock, CheckCircle } from "lucide-react";
import TaskCard from "@/components/task-card";
import AISuggestionsPanel from "@/components/ai-suggestions-panel";
import AddTaskModal from "@/components/add-task-modal";
import QuestionnaireModal from "@/components/questionnaire-modal";

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
  const [priorityFilter, setPriorityFilter] = useState<string>("");
  const [categoryFilters, setCategoryFilters] = useState<CategoryFilter[]>([]);
  const [showAddTaskModal, setShowAddTaskModal] = useState(false);
  const [showQuestionnaireModal, setShowQuestionnaireModal] = useState(false);
  const [showAISuggestions, setShowAISuggestions] = useState(true);

  const { data: tasks = [], isLoading: tasksLoading } = useQuery<MaintenanceTask[]>({
    queryKey: ["/api/tasks", { search: searchTerm, priority: priorityFilter, templateId }],
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

    const filters = Object.entries(categoryCounts).map(([category, count]) => ({
      category,
      color: categoryColors[category as keyof typeof categoryColors] || "bg-gray-500",
      count,
      checked: true,
    }));

    setCategoryFilters(filters);
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

  const filteredTasks = tasks.filter(task => {
    const categoryChecked = categoryFilters.find(f => f.category === task.category)?.checked ?? true;
    return categoryChecked;
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
                Add Task
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
                  Add Custom Task
                </Button>
                <Button 
                  onClick={() => setShowQuestionnaireModal(true)}
                  className="w-full bg-accent text-white hover:bg-green-700"
                >
                  🤖 AI Suggestions
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
                  <div key={filter.category} className="flex items-center space-x-2">
                    <Checkbox
                      checked={filter.checked}
                      onCheckedChange={() => toggleCategoryFilter(filter.category)}
                    />
                    <span className="text-sm flex-1">{filter.category}</span>
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
                      <p className="text-sm font-medium text-gray-600">Total Tasks</p>
                      <p className="text-2xl font-bold text-gray-900">{stats?.total || 0}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center">
                    <div className="bg-red-100 rounded-lg p-3">
                      <AlertCircle className="w-6 h-6 text-red-600" />
                    </div>
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-600">Overdue</p>
                      <p className="text-2xl font-bold text-red-600">{stats?.overdue || 0}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center">
                    <div className="bg-yellow-100 rounded-lg p-3">
                      <Clock className="w-6 h-6 text-yellow-600" />
                    </div>
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-600">Due Soon</p>
                      <p className="text-2xl font-bold text-yellow-600">{stats?.dueSoon || 0}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center">
                    <div className="bg-green-100 rounded-lg p-3">
                      <CheckCircle className="w-6 h-6 text-green-600" />
                    </div>
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-600">Completed</p>
                      <p className="text-2xl font-bold text-green-600">{stats?.completed || 0}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Tasks Section */}
            <Card>
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <CardTitle className="text-lg">Maintenance Tasks</CardTitle>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative">
                      <Search className="w-5 h-5 text-gray-400 absolute left-3 top-2.5" />
                      <Input
                        placeholder="Search tasks..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10 w-full sm:w-64"
                      />
                    </div>
                    <Select value={priorityFilter} onValueChange={(val) => setPriorityFilter(val === 'all' ? '' : val)}>
                      <SelectTrigger className="w-full sm:w-32">
                        <SelectValue placeholder="All Priorities" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Priorities</SelectItem>
                        <SelectItem value="Urgent">Urgent</SelectItem>
                        <SelectItem value="High">High</SelectItem>
                        <SelectItem value="Medium">Medium</SelectItem>
                        <SelectItem value="Low">Low</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {filteredTasks.map((task) => (
                    <TaskCard key={task.id} task={task} />
                  ))}
                  {filteredTasks.length === 0 && (
                    <div className="text-center py-8 text-gray-500">
                      <ClipboardList className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                      <p>No tasks match your current filters.</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Modals and Panels */}
      {showAISuggestions && (
        <AISuggestionsPanel 
          onClose={() => setShowAISuggestions(false)}
          existingTasks={tasks}
        />
      )}

      {showAddTaskModal && (
        <AddTaskModal
          isOpen={showAddTaskModal}
          onClose={() => setShowAddTaskModal(false)}
        />
      )}

      {showQuestionnaireModal && (
        <QuestionnaireModal
          isOpen={showQuestionnaireModal}
          onClose={() => setShowQuestionnaireModal(false)}
          templateId={templateId}
        />
      )}
    </div>
  );
}
