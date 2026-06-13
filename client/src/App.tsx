import { useEffect } from "react";
import { Route, useLocation } from "wouter";
import { queryClient, getQueryFn } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/dashboard";
import TemplateSelection from "@/pages/template-selection";
import NotFound from "@/pages/not-found";
import AuthPage from "@/pages/auth";

function useUser() {
  return useQuery({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: Infinity,
    retry: false,
  });
}

function usePropertyCount(enabled: boolean) {
  return useQuery<{ count: number }>({
    queryKey: ["/api/properties/count"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled,
    staleTime: Infinity,
    retry: false,
  });
}

function RedirectToDashboard() {
  const [, navigate] = useLocation();
  useEffect(() => { navigate("/dashboard"); }, [navigate]);
  return null;
}

function Router() {
  const { data: user, isLoading: userLoading } = useUser();
  const { data: count, isLoading: countLoading } = usePropertyCount(!!user);

  if (userLoading || (user && countLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  const isNewUser = count?.count === 0;

  return (
    <>
      <Route path="/">
        {isNewUser ? <TemplateSelection /> : <RedirectToDashboard />}
      </Route>
      <Route path="/dashboard/:templateId?" component={Dashboard} />
      <Route path="/:rest*" component={NotFound} />
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
