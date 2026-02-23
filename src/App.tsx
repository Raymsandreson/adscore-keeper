import { lazy, Suspense } from "react";
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
import { FloatingNav } from "@/components/FloatingNav";

// Lazy-loaded global overlays (non-critical)
const GlobalDatabaseSearch = lazy(() => import("@/components/GlobalDatabaseSearch").then(m => ({ default: m.GlobalDatabaseSearch })));
const UserProductivityBanner = lazy(() => import("@/components/UserProductivityBanner").then(m => ({ default: m.UserProductivityBanner })));
const IncomingCallBanner = lazy(() => import("@/components/IncomingCallBanner").then(m => ({ default: m.IncomingCallBanner })));
const CallFieldSuggestionsBanner = lazy(() => import("@/components/CallFieldSuggestionsBanner").then(m => ({ default: m.CallFieldSuggestionsBanner })));

// Lazy-loaded pages
const Index = lazy(() => import("./pages/Index"));
const ActivitiesPage = lazy(() => import("./pages/ActivitiesPage"));
const LeadsCenter = lazy(() => import("./pages/LeadsCenter"));
const AnalyticsPage = lazy(() => import("./pages/AnalyticsPage"));
const LeaderboardPage = lazy(() => import("./pages/LeaderboardPage"));
const TeamPage = lazy(() => import("./pages/TeamPage"));
const WorkflowPage = lazy(() => import("./pages/WorkflowPage"));
const WorkflowProgressPage = lazy(() => import("./pages/WorkflowProgressPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const FinancePage = lazy(() => import("./pages/FinancePage"));
const ExpenseFormPage = lazy(() => import("./pages/ExpenseFormPage"));
const CallsPage = lazy(() => import("./pages/CallsPage"));
const WhatsAppPage = lazy(() => import("./pages/WhatsAppPage"));
const NotFound = lazy(() => import("./pages/NotFound"));
const PrivacyPolicyPage = lazy(() => import("./pages/PrivacyPolicyPage"));

const queryClient = new QueryClient();

const PageLoading = () => (
  <div className="flex items-center justify-center h-screen">
    <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
  </div>
);

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
      <Suspense fallback={null}>
        <GlobalDatabaseSearch />
        <UserProductivityBanner />
        <IncomingCallBanner />
        <CallFieldSuggestionsBanner />
      </Suspense>
      <FloatingNav />
      <Suspense fallback={<PageLoading />}>
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
      </Suspense>
    </>
  );
}

export default App;