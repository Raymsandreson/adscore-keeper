import { lazy, Suspense, type ComponentType } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { SessionProvider } from "@/contexts/SessionContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { OfflineBanner } from "@/components/OfflineBanner";
import { PageTracker } from "@/components/PageTracker";
import { FloatingNav } from "@/components/FloatingNav";

// Helper: retry dynamic import once on failure (stale chunk after deploy)
function lazyRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>
) {
  return lazy(() =>
    factory().catch(() => {
      // Force reload once to get fresh chunks
      const key = "chunk_reload";
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, "1");
        window.location.reload();
      }
      return factory();
    })
  );
}

// Lazy-loaded global overlays (non-critical)
const GlobalDatabaseSearch = lazyRetry(() => import("@/components/GlobalDatabaseSearch").then(m => ({ default: m.GlobalDatabaseSearch })));
const UserProductivityBanner = lazyRetry(() => import("@/components/UserProductivityBanner").then(m => ({ default: m.UserProductivityBanner })));
const IncomingCallBanner = lazyRetry(() => import("@/components/IncomingCallBanner").then(m => ({ default: m.IncomingCallBanner })));
const CallFieldSuggestionsBanner = lazyRetry(() => import("@/components/CallFieldSuggestionsBanner").then(m => ({ default: m.CallFieldSuggestionsBanner })));
const FloatingWhatsAppCall = lazyRetry(() => import("@/components/FloatingWhatsAppCall").then(m => ({ default: m.FloatingWhatsAppCall })));
const PWAInstallBanner = lazyRetry(() => import("@/components/PWAInstallBanner").then(m => ({ default: m.PWAInstallBanner })));

// Lazy-loaded pages (with retry for stale chunks)
const Index = lazyRetry(() => import("./pages/Index"));
const ActivitiesPage = lazyRetry(() => import("./pages/ActivitiesPage"));
const LeadsCenter = lazyRetry(() => import("./pages/LeadsCenter"));
const AnalyticsPage = lazyRetry(() => import("./pages/AnalyticsPage"));
const LeaderboardPage = lazyRetry(() => import("./pages/LeaderboardPage"));
const TeamPage = lazyRetry(() => import("./pages/TeamPage"));
const WorkflowPage = lazyRetry(() => import("./pages/WorkflowPage"));
const WorkflowProgressPage = lazyRetry(() => import("./pages/WorkflowProgressPage"));
const ProfilePage = lazyRetry(() => import("./pages/ProfilePage"));
const FinancePage = lazyRetry(() => import("./pages/FinancePage"));
const ExpenseFormPage = lazyRetry(() => import("./pages/ExpenseFormPage"));
const CallsPage = lazyRetry(() => import("./pages/CallsPage"));
const WhatsAppPage = lazyRetry(() => import("./pages/WhatsAppPage"));
const NotFound = lazyRetry(() => import("./pages/NotFound"));
const PrivacyPolicyPage = lazyRetry(() => import("./pages/PrivacyPolicyPage"));
const InstallPage = lazyRetry(() => import("./pages/InstallPage"));
const CasesPage = lazyRetry(() => import("./pages/CasesPage"));
const NucleiPage = lazyRetry(() => import("./pages/NucleiPage"));
const CostOrganizationPage = lazyRetry(() => import("./pages/CostOrganizationPage"));
const ResetPasswordPage = lazyRetry(() => import("./pages/ResetPasswordPage"));
const ContactsPage = lazyRetry(() => import("./pages/ContactsPage"));
const InstagramPage = lazyRetry(() => import("./pages/InstagramPage"));
const SettingsPage = lazyRetry(() => import("./pages/SettingsPage"));

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
            <OfflineBanner />
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
        {/* IncomingCallBanner removido — contabilidade mantida via webhooks */}
        <CallFieldSuggestionsBanner />
        <FloatingWhatsAppCall />
        <PWAInstallBanner />
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
          <Route path="/instagram" element={<ProtectedRoute><InstagramPage /></ProtectedRoute>} />
          <Route path="/contacts" element={<ProtectedRoute><ContactsPage /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
          <Route path="/cases" element={<ProtectedRoute><CasesPage /></ProtectedRoute>} />
          <Route path="/nuclei" element={<ProtectedRoute><NucleiPage /></ProtectedRoute>} />
          <Route path="/cost-organization" element={<ProtectedRoute><CostOrganizationPage /></ProtectedRoute>} />
           <Route path="/privacy" element={<PrivacyPolicyPage />} />
           <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/install" element={<InstallPage />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </>
  );
}

export default App;