import { Route, useRoute } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/dashboard";
import TemplateSelection from "@/pages/template-selection";
import NotFound from "@/pages/not-found";

function Router() {
  // wouter's <Route> components can render concurrently if multiple
  // patterns match (e.g. path="*" matches everything). Use `useRoute`
  // to check routes in priority order and render only the first match.
  const [isRoot] = useRoute("/");
  const [isDashboardWithId] = useRoute("/dashboard/:templateId");
  const [isDashboard] = useRoute("/dashboard");

  if (isRoot) return <TemplateSelection />;
  if (isDashboardWithId || isDashboard) return <Dashboard />;
  return <NotFound />;
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
