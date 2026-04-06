import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthContext } from '@/contexts/AuthContext';
import { useModulePermissions, MODULE_DEFINITIONS } from '@/hooks/useModulePermissions';
import { Loader2, Shield, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ProtectedRouteProps {
  children: ReactNode;
  requiredModule?: string;
}

export function ProtectedRoute({ children, requiredModule }: ProtectedRouteProps) {
  const { isAuthenticated, loading } = useAuthContext();
  const { canView, loading: permLoading } = useModulePermissions();
  const location = useLocation();

  // While auth is loading, show a full-screen spinner (before we know if user is authenticated)
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/dashboard" state={{ returnTo: location.pathname }} replace />;
  }

  // Auto-detect module from route if not explicitly provided
  const moduleKey = requiredModule || MODULE_DEFINITIONS.find(m => m.route === location.pathname)?.key;
  
  if (moduleKey && !permLoading && !canView(moduleKey)) {
    // If user is on the home route (/), redirect to the first permitted module instead of blocking
    if (location.pathname === '/') {
      const firstPermitted = MODULE_DEFINITIONS.find(m => m.key !== 'activities' && canView(m.key));
      if (firstPermitted) {
        return <Navigate to={firstPermitted.route} replace />;
      }
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Shield className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
          <h1 className="text-2xl font-bold mb-2">Acesso Restrito</h1>
          <p className="text-muted-foreground mb-4">
            Você não tem permissão para acessar esta seção.
          </p>
          <Button onClick={() => window.history.back()}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Voltar
          </Button>
        </div>
      </div>
    );
  }

  // Render children always (don't unmount on permLoading) to avoid closing open dialogs
  return <>{children}</>;
}

