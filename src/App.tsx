import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { SessionProvider } from "@/contexts/SessionContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { PageTracker } from "@/components/PageTracker";
import { GlobalDatabaseSearch } from "@/components/GlobalDatabaseSearch";
import { UserProductivityBanner } from "@/components/UserProductivityBanner";
import { AppSidebar } from "@/components/AppSidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import Index from "./pages/Index";
import ActivitiesPage from "./pages/ActivitiesPage";
import LeadsCenter from "./pages/LeadsCenter";
import EditorialCalendarPage from "./pages/EditorialCalendarPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import LeaderboardPage from "./pages/LeaderboardPage";
import TeamPage from "./pages/TeamPage";
import WorkflowPage from "./pages/WorkflowPage";
import WorkflowProgressPage from "./pages/WorkflowProgressPage";
import ProfilePage from "./pages/ProfilePage";
import FinancePage from "./pages/FinancePage";
import ExpenseFormPage from "./pages/ExpenseFormPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <AuthProvider>
        <SessionProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </TooltipProvider>
        </SessionProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

// Separate component to use hooks inside BrowserRouter
function AppRoutes() {
  return (
    <SidebarProvider defaultOpen={false}>
      <PageTracker />
      <GlobalDatabaseSearch />
      <UserProductivityBanner />
      <AppSidebar />
      <div className="flex-1 flex flex-col min-h-screen w-full">
        <header className="h-12 flex items-center border-b border-border/40 px-3 shrink-0">
          <SidebarTrigger />
        </header>
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<ProtectedRoute><ActivitiesPage /></ProtectedRoute>} />
            <Route path="/dashboard" element={<Index />} />
            <Route path="/leads" element={<ProtectedRoute><LeadsCenter /></ProtectedRoute>} />
            <Route path="/editorial" element={<ProtectedRoute><EditorialCalendarPage /></ProtectedRoute>} />
            <Route path="/analytics" element={<ProtectedRoute><AnalyticsPage /></ProtectedRoute>} />
            <Route path="/leaderboard" element={<ProtectedRoute><LeaderboardPage /></ProtectedRoute>} />
            <Route path="/team" element={<ProtectedRoute><TeamPage /></ProtectedRoute>} />
            <Route path="/workflow" element={<ProtectedRoute><WorkflowPage /></ProtectedRoute>} />
            <Route path="/workflow-progress" element={<ProtectedRoute><WorkflowProgressPage /></ProtectedRoute>} />
            <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
            <Route path="/finance" element={<ProtectedRoute><FinancePage /></ProtectedRoute>} />
            <Route path="/expense-form/:token" element={<ProtectedRoute><ExpenseFormPage /></ProtectedRoute>} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </div>
    </SidebarProvider>
  );
}

export default App;
