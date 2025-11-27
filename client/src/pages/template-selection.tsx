import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { PropertyTemplate } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building, Home, Building2, Warehouse, Key, Plus } from "lucide-react";

const propertyTypeIcons = {
  single_family: Home,
  condo: Building,
  townhouse: Building2,
  commercial: Warehouse,
  rental: Key,
};

const propertyTypeImages = {
  single_family: "https://images.unsplash.com/photo-1570129477492-45c003edd2be?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&h=600",
  condo: "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&h=600",
  townhouse: "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&h=600",
  commercial: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&h=600",
  rental: "https://images.unsplash.com/photo-1560518883-ce09059eeffa?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&h=600",
};

export default function TemplateSelection() {
  const { data: templates, isLoading } = useQuery<PropertyTemplate[]>({
    queryKey: ["/api/templates"],
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-gray-600">Loading property templates...</p>
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
              <h1 className="text-2xl font-bold text-primary">🏠 HomeGuard</h1>
            </div>
            <nav className="hidden md:block">
              <div className="ml-10 flex items-baseline space-x-4">
                <Link href="/" className="text-primary font-medium px-3 py-2 rounded-md text-sm">Templates</Link>
                <Link href="/dashboard" className="text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm">Dashboard</Link>
              </div>
            </nav>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Hero Section */}
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">Choose Your Property Type</h2>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Select your property type to get started with a customized maintenance template. 
            We'll help you create a personalized maintenance schedule.
          </p>
        </div>

        {/* Template Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {templates?.map((template) => {
            const IconComponent = propertyTypeIcons[template.type as keyof typeof propertyTypeIcons] || Building;
            const imageUrl = propertyTypeImages[template.type as keyof typeof propertyTypeImages];
            
            return (
              <Link key={template.id} href={`/dashboard/${template.id}`}>
                <Card className="h-full hover:shadow-lg transition-shadow cursor-pointer border-2 border-transparent hover:border-primary">
                  <CardContent className="p-6">
                    {imageUrl && (
                      <img 
                        src={imageUrl} 
                        alt={template.name}
                        className="w-full h-48 object-cover rounded-lg mb-4"
                      />
                    )}
                    <h3 className="text-xl font-semibold text-gray-900 mb-2">{template.name}</h3>
                    <p className="text-gray-600 text-sm mb-4">{template.description}</p>
                    <div className="flex items-center text-sm text-gray-500">
                      <Badge variant="secondary">{template.taskCount}+ Items / Tasks</Badge>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}

          {/* Custom Setup Option */}
          <Link href="/dashboard">
            <Card className="h-full hover:shadow-lg transition-shadow cursor-pointer border-2 border-transparent hover:border-primary">
              <CardContent className="p-6">
                <div className="flex items-center justify-center h-48 bg-gray-100 rounded-lg mb-4">
                  <div className="text-center">
                    <Plus className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                    <span className="text-gray-500 font-medium">Custom Setup</span>
                  </div>
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">Create Custom</h3>
                <p className="text-gray-600 text-sm mb-4">
                  Build your own maintenance schedule from scratch with AI assistance and expert recommendations.
                </p>
                <div className="flex items-center text-sm text-gray-500">
                  <Badge variant="secondary">Unlimited</Badge>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>
    </div>
  );
}
