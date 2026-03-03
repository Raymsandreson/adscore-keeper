import { useAuthContext } from "@/contexts/AuthContext";
import { AuthForm } from "@/components/auth/AuthForm";
import Dashboard from "@/components/Dashboard";
import { Loader2, WifiOff, RefreshCw } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

const Index = () => {
  const { isAuthenticated, loading, connectionError, retry } = useAuthContext();
  const location = useLocation();
  const navigate = useNavigate();
  const returnTo = (location.state as any)?.returnTo;

  useEffect(() => {
    if (isAuthenticated && returnTo) {
      navigate(returnTo, { replace: true });
    }
  }, [isAuthenticated, returnTo, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (connectionError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center max-w-md space-y-4">
          <WifiOff className="h-16 w-16 mx-auto text-destructive" />
          <h1 className="text-2xl font-bold text-foreground">Servidor temporariamente indisponível</h1>
          <p className="text-muted-foreground text-sm">
            Não foi possível conectar ao servidor. Isso pode acontecer quando o sistema está com alta demanda.
          </p>
          <div className="bg-muted/50 rounded-lg p-3 text-left text-xs text-muted-foreground font-mono">
            <p className="font-semibold mb-1">Diagnóstico:</p>
            <p>{connectionError}</p>
            <p className="mt-1">Hora: {new Date().toLocaleTimeString('pt-BR')}</p>
          </div>
          <Button onClick={retry} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Tentar novamente
          </Button>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AuthForm />;
  }

  return <Dashboard />;
};

export default Index;
