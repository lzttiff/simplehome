import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { User, type UiSettingsTab } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Home, Building, Loader2 } from "lucide-react";
import AccountMenu from "@/components/account-menu";
import UserSettingsModal from "@/components/user-settings-modal";
import { OPEN_SETTINGS_EVENT } from "@/lib/ai-readiness";
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const PROPERTY_TYPES = [
  {
    type: "single_family",
    name: "Single-Family Home",
    description: "Comprehensive maintenance for detached homes with yard, roof, HVAC systems, and exterior care.",
    taskCount: 150,
    imageUrl: "https://images.unsplash.com/photo-1570129477492-45c003edd2be?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&h=600",
    icon: Home,
  },
  {
    type: "condo",
    name: "Condo",
    description: "Essential maintenance for condo owners covering unit-specific systems, appliances, and shared building responsibilities.",
    taskCount: 80,
    imageUrl: "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&h=600",
    icon: Building,
  },
];

export default function TemplateSelection() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isCreating, setIsCreating] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<UiSettingsTab | undefined>(undefined);

  const { data: user } = useQuery<User>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: Infinity,
    retry: false,
  });

  useEffect(() => {
    const openSettings = (event: Event) => {
      const customEvent = event as CustomEvent<{ tab?: UiSettingsTab }>;
      setSettingsInitialTab(customEvent.detail?.tab);
      setShowSettingsModal(true);
    };

    window.addEventListener(OPEN_SETTINGS_EVENT, openSettings as EventListener);
    return () => {
      window.removeEventListener(OPEN_SETTINGS_EVENT, openSettings as EventListener);
    };
  }, []);

  const handleSelect = async (type: string) => {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const res = await apiRequest("POST", "/api/properties", { type });
      const template = await res.json();
      await queryClient.invalidateQueries({ queryKey: ["/api/properties/count"] });
      navigate(`/dashboard/${template.id}`);
    } catch (error) {
      toast({
        title: "Failed to set up property",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
      setIsCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <h1 className="text-2xl font-bold text-primary">SimpleHome</h1>
            {user && (
              <div className="flex items-center">
                <AccountMenu user={user} onSettingsClick={() => setShowSettingsModal(true)} />
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center mb-10">
          <h2 className="text-3xl font-bold text-gray-900 mb-3">Welcome! Set up your first property</h2>
          <p className="text-lg text-gray-600">
            Choose your property type to get a pre-built maintenance checklist tailored to your home.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {PROPERTY_TYPES.map((pt) => (
            <button
              key={pt.type}
              onClick={() => handleSelect(pt.type)}
              disabled={isCreating}
              className={cn(
                "text-left rounded-xl border-2 border-transparent bg-white shadow-sm transition-all",
                "hover:border-primary hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
                isCreating && "opacity-60 cursor-not-allowed"
              )}
            >
              <Card className="h-full border-0 shadow-none">
                <CardContent className="p-6">
                  <img
                    src={pt.imageUrl}
                    alt={pt.name}
                    className="w-full h-48 object-cover rounded-lg mb-4"
                  />
                  <div className="flex items-center gap-2 mb-2">
                    <pt.icon className="w-5 h-5 text-primary" />
                    <h3 className="text-xl font-semibold text-gray-900">{pt.name}</h3>
                  </div>
                  <p className="text-gray-600 text-sm mb-4">{pt.description}</p>
                  <Badge variant="secondary">{pt.taskCount}+ maintenance items</Badge>
                </CardContent>
              </Card>
            </button>
          ))}
        </div>

        {isCreating && (
          <div className="flex items-center justify-center gap-2 mt-8 text-gray-600">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Setting up your property...</span>
          </div>
        )}
      </div>

      <UserSettingsModal
        isOpen={showSettingsModal}
        onClose={() => { setShowSettingsModal(false); setSettingsInitialTab(undefined); }}
        currentTimezone={user?.timezone ?? null}
        currentName={user?.name ?? ""}
        initialTab={settingsInitialTab}
      />
    </div>
  );
}
