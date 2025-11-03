import { Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/dashboard";
import TemplateSelection from "@/pages/template-selection";
import NotFound from "@/pages/not-found";

function Router() {
  // wouter no longer provides a top-level Switch in newer versions —
  // rendering Route elements directly lets each Route decide whether
  // it matches the current location.
  return (
    <>
      <Route path="/" component={TemplateSelection} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/dashboard/:templateId" component={Dashboard} />
      <Route component={NotFound} />
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
