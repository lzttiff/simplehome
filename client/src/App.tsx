import { Route, useRoute } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/dashboard";
import TemplateSelection from "@/pages/template-selection";
import NotFound from "@/pages/not-found";

function Router() {
  // Use Route components to properly extract URL parameters
  return (
    <>
      <Route path="/" component={TemplateSelection} />
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
