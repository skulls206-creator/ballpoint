import { useState } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import AuthPage from "@/pages/AuthPage";
import { AuthProvider, useAuth } from "@/lib/authContext";
import { KhurkOSBanner } from "@/components/KhurkOSBanner";

const queryClient = new QueryClient();

function AppRouter() {
  const { user, loading, login, register } = useAuth();
  const [authError, setAuthError] = useState<string | undefined>();
  const [authLoading, setAuthLoading] = useState(false);

  const handleAuth = async (email: string, password: string, mode: "login" | "register") => {
    setAuthError(undefined);
    setAuthLoading(true);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await register(email, password);
      }
    } catch (err: any) {
      setAuthError(err.message ?? "Something went wrong. Please try again.");
    } finally {
      setAuthLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <AuthPage onAuth={handleAuth} error={authError} loading={authLoading} />;
  }

  return (
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </WouterRouter>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <AppRouter />
          <KhurkOSBanner />
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
