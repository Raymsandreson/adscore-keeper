import React, { lazy, Suspense, type ComponentType } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { SessionProvider } from "@/contexts/SessionContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { OfflineBanner } from "@/components/OfflineBanner";
import { PageTracker } from "@/components/PageTracker";
import { AppSidebar } from "@/components/AppSidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { GlobalDatabaseSearch } from "@/components/GlobalDatabaseSearch";
import { UserProductivityBanner } from "@/components/UserProductivityBanner";
import { CallFieldSuggestionsBanner } from "@/components/CallFieldSuggestionsBanner";
import { FloatingWhatsAppCall } from "@/components/FloatingWhatsAppCall";
import { PWAInstallBanner } from "@/components/PWAInstallBanner";

// Helper: retry dynamic import once per module on failure (stale chunk after deploy)
function lazyRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  retryKey: string
) {
  return lazy(async () => {
    const storageKey = `chunk_reload:${retryKey}`;

    try {
      const module = await factory();

      // Guard against stale/corrupted chunks that resolve without a default export
      if (!module || typeof module.default !== 'function') {
        throw new Error(`Module "${retryKey}" loaded but has no valid default export`);
      }

      sessionStorage.removeItem(storageKey);
      return module;
    } catch (error) {
      const retries = Number(sessionStorage.getItem(storageKey) ?? "0");

      if (retries < 1) {
        sessionStorage.setItem(storageKey, String(retries + 1));
        window.location.reload();

        // Keep suspense pending until reload happens
        return new Promise<{ default: T }>(() => {});
      }

      throw error;
    }
  });
}

// Error boundary to prevent blank screens
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen gap-4 p-4 text-center">
          <p className="text-lg font-semibold">Algo deu errado</p>
          <p className="text-sm text-muted-foreground">Tente recarregar a página.</p>
          <button
            onClick={() => {
              sessionStorage.clear();
              window.location.reload();
            }}
            className="px-4 py-2 rounded bg-primary text-primary-foreground text-sm"
          >
            Recarregar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Lazy-loaded pages (with retry for stale chunks)
const Index = lazyRetry(() => import("./pages/Index"), "Index");
const ActivitiesPage = lazyRetry(() => import("./pages/ActivitiesPage"), "ActivitiesPage");
const LeadsCenter = lazyRetry(() => import("./pages/LeadsCenter"), "LeadsCenter");
const AnalyticsPage = lazyRetry(() => import("./pages/AnalyticsPage"), "AnalyticsPage");
const LeaderboardPage = lazyRetry(() => import("./pages/LeaderboardPage"), "LeaderboardPage");
const TeamPage = lazyRetry(() => import("./pages/TeamPage"), "TeamPage");
const WorkflowPage = lazyRetry(() => import("./pages/WorkflowPage"), "WorkflowPage");
const WorkflowProgressPage = lazyRetry(() => import("./pages/WorkflowProgressPage"), "WorkflowProgressPage");
const ProfilePage = lazyRetry(() => import("./pages/ProfilePage"), "ProfilePage");
const FinancePage = lazyRetry(() => import("./pages/FinancePage"), "FinancePage");
const ExpenseFormPage = lazyRetry(() => import("./pages/ExpenseFormPage"), "ExpenseFormPage");
const CallsPage = lazyRetry(() => import("./pages/CallsPage"), "CallsPage");
const WhatsAppPage = lazyRetry(() => import("./pages/WhatsAppPage"), "WhatsAppPage");
const NotFound = lazyRetry(() => import("./pages/NotFound"), "NotFound");
const PrivacyPolicyPage = lazyRetry(() => import("./pages/PrivacyPolicyPage"), "PrivacyPolicyPage");
const InstallPage = lazyRetry(() => import("./pages/InstallPage"), "InstallPage");
const CasesPage = lazyRetry(() => import("./pages/CasesPage"), "CasesPage");
const NucleiPage = lazyRetry(() => import("./pages/NucleiPage"), "NucleiPage");
const CostOrganizationPage = lazyRetry(() => import("./pages/CostOrganizationPage"), "CostOrganizationPage");
const ProcessTrackingPage = lazyRetry(() => import("./pages/ProcessTrackingPage"), "ProcessTrackingPage");
const ResetPasswordPage = lazyRetry(() => import("./pages/ResetPasswordPage"), "ResetPasswordPage");
const ContactsPage = lazyRetry(() => import("./pages/ContactsPage"), "ContactsPage");
const InstagramPage = lazyRetry(() => import("./pages/InstagramPage"), "InstagramPage");
const SettingsPage = lazyRetry(() => import("./pages/SettingsPage"), "SettingsPage");

const queryClient = new QueryClient();

const PageLoading = () => (
  <div className="flex items-center justify-center h-screen">
    <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
  </div>
);

const App = () => (
  <ErrorBoundary>
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
  </ErrorBoundary>
);

// Separate component to use hooks inside BrowserRouter
function AppRoutes() {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <main className="flex-1">
            <PageTracker />
            <GlobalDatabaseSearch />
            <UserProductivityBanner />
            <CallFieldSuggestionsBanner />
            <FloatingWhatsAppCall />
            <PWAInstallBanner />
            <Suspense fallback={<PageLoading />}>
              <Routes>
                <Route path="/" element={<ProtectedRoute><ActivitiesPage /></ProtectedRoute>} />
                <Route path="/index" element={<Navigate to="/dashboard" replace />} />
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
                <Route path="/process-tracking" element={<ProtectedRoute><ProcessTrackingPage /></ProtectedRoute>} />
                <Route path="/privacy" element={<PrivacyPolicyPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/install" element={<InstallPage />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

export default App;
