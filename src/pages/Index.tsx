import { useAuthContext } from "@/contexts/AuthContext";
import { AuthForm } from "@/components/auth/AuthForm";
import Dashboard from "@/components/Dashboard";
import { Loader2 } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";

const Index = () => {
  const { isAuthenticated, loading } = useAuthContext();
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

  if (!isAuthenticated) {
    return <AuthForm />;
  }

  return <Dashboard />;
};

export default Index;
