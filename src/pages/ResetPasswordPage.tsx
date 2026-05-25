import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Loader2, Eye, EyeOff, CheckCircle } from 'lucide-react';

const ResetPasswordPage = () => {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [isRecovery, setIsRecovery] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  // Capturar o hash IMEDIATAMENTE no module-load, antes do supabase client
  // (detectSessionInUrl=true) consumi-lo.
  const [initialHash] = useState(() =>
    typeof window !== 'undefined' ? window.location.hash : ''
  );
  const [initialSearch] = useState(() =>
    typeof window !== 'undefined' ? window.location.search : ''
  );

  useEffect(() => {
    let isMounted = true;
    let safetyTimer: ReturnType<typeof setTimeout> | null = null;

    const hashParams = new URLSearchParams(initialHash.replace(/^#/, ''));
    const queryParams = new URLSearchParams(initialSearch);
    const urlType = hashParams.get('type') ?? queryParams.get('type');
    const hashAccessToken = hashParams.get('access_token');
    const hashRefreshToken = hashParams.get('refresh_token');
    const queryCode = queryParams.get('code');
    const looksLikeRecovery =
      urlType === 'recovery' || !!hashAccessToken || !!queryCode;

    const cleanUrl = () => {
      try {
        window.history.replaceState({}, document.title, window.location.pathname);
      } catch {}
    };

    const markRecovery = () => {
      if (!isMounted) return;
      setIsRecovery(true);
      setRecoveryError(null);
      setInitializing(false);
      cleanUrl();
    };

    const markInvalid = (msg?: string) => {
      if (!isMounted) return;
      setIsRecovery(false);
      if (msg) setRecoveryError(msg);
      setInitializing(false);
    };

    // Listener primeiro — captura PASSWORD_RECOVERY / SIGNED_IN /
    // INITIAL_SESSION disparados pelo detectSessionInUrl do supabase client.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!isMounted) return;
        if (event === 'PASSWORD_RECOVERY') {
          markRecovery();
          return;
        }
        if (
          (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') &&
          session?.user &&
          looksLikeRecovery
        ) {
          markRecovery();
        }
      }
    );

    (async () => {
      try {
        if (hashAccessToken && hashRefreshToken && urlType === 'recovery') {
          const { error } = await supabase.auth.setSession({
            access_token: hashAccessToken,
            refresh_token: hashRefreshToken,
          });
          if (error) throw error;
          markRecovery();
          return;
        }

        if (queryCode) {
          const { data, error } = await supabase.auth.exchangeCodeForSession(queryCode);
          if (error) throw error;
          if (urlType === 'recovery' || data?.session) {
            markRecovery();
          } else {
            markInvalid('Link inválido ou expirado. Solicite um novo link.');
          }
          return;
        }

        // Hash já consumido pelo detectSessionInUrl — verificar sessão atual.
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user && looksLikeRecovery) {
          markRecovery();
          return;
        }

        if (looksLikeRecovery) {
          markInvalid('Sua sessão de recuperação expirou. Solicite um novo link.');
        } else {
          markInvalid();
        }
      } catch (error: any) {
        console.error('[RESET] Error establishing recovery session:', error);
        markInvalid(error?.message || 'Link inválido ou expirado. Solicite um novo link.');
      }
    })();

    // Safety net: nunca deixar o spinner travado indefinidamente.
    safetyTimer = setTimeout(() => {
      if (!isMounted) return;
      setInitializing((cur) => {
        if (cur) {
          setRecoveryError('Não foi possível validar o link. Tente novamente ou solicite um novo.');
        }
        return false;
      });
    }, 10000);

    return () => {
      isMounted = false;
      if (safetyTimer) clearTimeout(safetyTimer);
      subscription.unsubscribe();
    };
  }, [initialHash, initialSearch]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error('As senhas não coincidem');
      return;
    }
    if (password.length < 6) {
      toast.error('A senha deve ter pelo menos 6 caracteres');
      return;
    }
    setLoading(true);

    // Safety net: nunca deixar o botão travado em loading.
    const safetyTimer = setTimeout(() => {
      setLoading(false);
      toast.error('Tempo limite excedido', {
        description: 'A operação demorou demais. Tente novamente ou solicite um novo link.',
      });
    }, 15000);

    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.user) {
        setIsRecovery(false);
        setRecoveryError('Sua sessão de recuperação expirou. Solicite um novo link.');
        throw new Error('Link inválido ou expirado');
      }

      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch {
        // best-effort
      }

      setSuccess(true);
      toast.success('Senha redefinida com sucesso!');
      setTimeout(() => navigate('/dashboard', { replace: true }), 2000);
    } catch (error: any) {
      console.error('[RESET] updateUser falhou:', error);
      const raw = String(error?.message || '');
      let friendly = raw || 'Não foi possível redefinir a senha.';
      if (/same_password|should be different/i.test(raw)) {
        friendly = 'A nova senha precisa ser diferente da atual.';
      } else if (/pwned|leaked|compromised|weak/i.test(raw)) {
        friendly = 'Esta senha apareceu em vazamentos públicos. Escolha outra mais forte.';
      } else if (/expired|invalid|jwt|token/i.test(raw)) {
        friendly = 'Sua sessão de recuperação expirou. Solicite um novo link.';
        setIsRecovery(false);
        setRecoveryError(friendly);
      }
      toast.error('Erro ao redefinir senha', { description: friendly });
    } finally {
      clearTimeout(safetyTimer);
      setLoading(false);
    }
  };

  if (initializing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-primary" />
            <CardTitle className="text-2xl">Validando link</CardTitle>
            <CardDescription>Aguarde enquanto confirmamos sua recuperação de senha.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (!isRecovery && !success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">WhatsJUD</CardTitle>
            <CardDescription>{recoveryError || 'Link inválido ou expirado. Solicite um novo link de redefinição.'}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => navigate('/')}>Voltar ao login</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CheckCircle className="h-12 w-12 text-emerald-500 mx-auto mb-2" />
            <CardTitle className="text-2xl">Senha redefinida!</CardTitle>
            <CardDescription>Redirecionando...</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
            <CardTitle className="text-2xl">WhatsJUD</CardTitle>
            <CardDescription>Defina sua nova senha</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">Nova Senha</Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirmar Nova Senha</Label>
              <div className="relative">
                <Input
                  id="confirm-password"
                  type={showConfirm ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
                  tabIndex={-1}
                >
                  {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Redefinir Senha
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default ResetPasswordPage;
