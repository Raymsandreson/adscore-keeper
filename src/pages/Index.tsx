import { useAuthContext } from "@/contexts/AuthContext";
import { AuthForm } from "@/components/auth/AuthForm";
import Dashboard from "@/components/Dashboard";
import { Loader2 } from "lucide-react";

const Index = () => {
  const { isAuthenticated, loading } = useAuthContext();

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
