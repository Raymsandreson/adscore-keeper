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
import { FloatingNav } from "@/components/FloatingNav";
import { IncomingCallBanner } from "@/components/IncomingCallBanner";
import Index from "./pages/Index";
import ActivitiesPage from "./pages/ActivitiesPage";
import LeadsCenter from "./pages/LeadsCenter";

import AnalyticsPage from "./pages/AnalyticsPage";
import LeaderboardPage from "./pages/LeaderboardPage";
import TeamPage from "./pages/TeamPage";
import WorkflowPage from "./pages/WorkflowPage";
import WorkflowProgressPage from "./pages/WorkflowProgressPage";
import ProfilePage from "./pages/ProfilePage";
import FinancePage from "./pages/FinancePage";
import ExpenseFormPage from "./pages/ExpenseFormPage";
import CallsPage from "./pages/CallsPage";
import WhatsAppPage from "./pages/WhatsAppPage";
import NotFound from "./pages/NotFound";
import PrivacyPolicyPage from "./pages/PrivacyPolicyPage";

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
    <>
      <PageTracker />
      <GlobalDatabaseSearch />
      <UserProductivityBanner />
      <IncomingCallBanner />
      <FloatingNav />
      <Routes>
        <Route path="/" element={<ProtectedRoute><ActivitiesPage /></ProtectedRoute>} />
        <Route path="/dashboard" element={<Index />} />
        <Route path="/leads" element={<ProtectedRoute><LeadsCenter /></ProtectedRoute>} />
        
        <Route path="/analytics" element={<ProtectedRoute><AnalyticsPage /></ProtectedRoute>} />
        <Route path="/leaderboard" element={<ProtectedRoute><LeaderboardPage /></ProtectedRoute>} />
        <Route path="/team" element={<ProtectedRoute><TeamPage /></ProtectedRoute>} />
        <Route path="/workflow" element={<ProtectedRoute><WorkflowPage /></ProtectedRoute>} />
        <Route path="/workflow-progress" element={<ProtectedRoute><WorkflowProgressPage /></ProtectedRoute>} />
        <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
        <Route path="/finance" element={<ProtectedRoute><FinancePage /></ProtectedRoute>} />
        <Route path="/expense-form/:token" element={<ExpenseFormPage />} />
        <Route path="/calls" element={<ProtectedRoute><CallsPage /></ProtectedRoute>} />
        <Route path="/whatsapp" element={<ProtectedRoute><WhatsAppPage /></ProtectedRoute>} />
        <Route path="/privacy" element={<PrivacyPolicyPage />} />
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
}

export default App;
