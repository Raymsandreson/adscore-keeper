import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, LogIn, UserPlus, Eye, EyeOff, Scale, CheckCircle2, BarChart3, MessageSquare, Shield } from 'lucide-react';

const UF_OPTIONS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

const PasswordInput = ({ id, value, onChange, show, onToggle, placeholder = '••••••••' }: {
  id: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  show: boolean; onToggle: () => void; placeholder?: string;
}) => (
  <div className="relative">
    <Input
      id={id}
      type={show ? 'text' : 'password'}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      required
      className="pr-10 h-12 rounded-xl border-border/60 bg-muted/30 focus:bg-background"
    />
    <button
      type="button"
      onClick={onToggle}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
      tabIndex={-1}
    >
      {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  </div>
);

const WhatsJUDLogo = ({ className = "" }: { className?: string }) => (
  <a href="/landing" className={`flex items-center gap-1 cursor-pointer hover:opacity-80 transition-opacity ${className}`}>
    <span className="text-3xl md:text-4xl font-light tracking-tight text-foreground">whats</span>
    <span className="text-3xl md:text-4xl font-bold text-primary-foreground bg-primary px-2 py-0.5 rounded-md">JUD</span>
  </a>
);

const features = [
  { icon: CheckCircle2, title: 'Organize seus processos', desc: 'Gerencie leads, atividades e casos em um só lugar' },
  { icon: MessageSquare, title: 'WhatsApp integrado', desc: 'Comunicação automatizada com agentes de IA' },
  { icon: BarChart3, title: 'Métricas em tempo real', desc: 'Dashboards completos para acompanhar sua equipe' },
  { icon: Shield, title: 'Seguro e confiável', desc: 'Seus dados protegidos com criptografia de ponta' },
];

export const AuthForm = () => {
  const [activeTab, setActiveTab] = useState<'login' | 'signup'>('login');
  const [isLoading, setIsLoading] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [showSignupConfirm, setShowSignupConfirm] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [signupName, setSignupName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirmPassword, setSignupConfirmPassword] = useState('');
  const [isLawyer, setIsLawyer] = useState(false);
  const [oabNumber, setOabNumber] = useState('');
  const [oabUf, setOabUf] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: loginEmail, password: loginPassword });
    if (error) {
      toast.error('Erro ao fazer login', { description: error.message });
    } else {
      toast.success('Login realizado com sucesso!');
    }
    setIsLoading(false);
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (signupPassword !== signupConfirmPassword) { toast.error('As senhas não coincidem'); return; }
    if (signupPassword.length < 6) { toast.error('A senha deve ter pelo menos 6 caracteres'); return; }
    setIsLoading(true);
    const metadata: any = { full_name: signupName };
    if (isLawyer && oabNumber.trim()) { metadata.oab_number = oabNumber.trim(); metadata.oab_uf = oabUf; }
    const { error } = await supabase.auth.signUp({
      email: signupEmail, password: signupPassword,
      options: { emailRedirectTo: window.location.origin, data: metadata },
    });
    if (error) { toast.error('Erro ao criar conta', { description: error.message }); }
    else { toast.success('Conta criada com sucesso!', { description: 'Você já pode fazer login.' }); }
    setIsLoading(false);
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail.trim()) { toast.error('Informe seu email'); return; }
    setForgotLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      toast.success('Email enviado!', { description: 'Verifique sua caixa de entrada (e spam) para redefinir a senha.' });
      setShowForgotPassword(false);
      setForgotEmail('');
    } catch (error: any) {
      toast.error('Erro ao enviar email', { description: error.message });
    } finally { setForgotLoading(false); }
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-background">
      {/* Left: Hero/branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-primary relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 left-10 w-72 h-72 rounded-full bg-white/20 blur-3xl" />
          <div className="absolute bottom-20 right-10 w-96 h-96 rounded-full bg-white/10 blur-3xl" />
        </div>
        <div className="relative z-10 flex flex-col justify-center px-12 xl:px-20 text-white">
          <a href="/landing" className="flex items-center gap-1 mb-8 hover:opacity-80 transition-opacity">
            <span className="text-5xl font-light tracking-tight">whats</span>
            <span className="text-5xl font-bold bg-white text-primary px-3 py-1 rounded-lg">JUD</span>
          </a>
          <h1 className="text-3xl xl:text-4xl font-bold mb-4 leading-tight">
            Organize sua vida,<br />tenha liberdade e<br />acelere seus processos
          </h1>
          <p className="text-white/80 text-lg mb-12 max-w-md">
            Deixe a inteligência artificial trabalhar para você e foque no crescimento do seu escritório
          </p>
          <div className="space-y-6">
            {features.map((f, i) => (
              <div key={i} className="flex items-start gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center">
                  <f.icon className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="font-semibold text-sm">{f.title}</p>
                  <p className="text-white/70 text-sm">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right: Auth form */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden flex flex-col items-center mb-8">
            <WhatsJUDLogo />
            <p className="text-muted-foreground text-sm mt-2">Acelere seus processos com IA</p>
          </div>

          {showForgotPassword ? (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-foreground">Redefinir senha</h2>
                <p className="text-muted-foreground text-sm mt-1">Informe seu email para receber o link</p>
              </div>
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="forgot-email">Email</Label>
                  <Input id="forgot-email" type="email" placeholder="seu@email.com" value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)} required className="h-12 rounded-xl" />
                </div>
                <Button type="submit" className="w-full h-12 rounded-xl text-base font-semibold" disabled={forgotLoading}>
                  {forgotLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Enviar link de redefinição
                </Button>
                <Button type="button" variant="ghost" className="w-full" onClick={() => setShowForgotPassword(false)}>
                  Voltar ao login
                </Button>
              </form>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="hidden lg:block">
                <h2 className="text-2xl font-bold text-foreground">
                  {activeTab === 'login' ? 'Bem-vindo de volta' : 'Crie sua conta'}
                </h2>
                <p className="text-muted-foreground text-sm mt-1">
                  {activeTab === 'login' ? 'Faça login para acessar a plataforma' : 'Cadastre-se gratuitamente'}
                </p>
              </div>

              {/* Tab switcher */}
              <div className="flex bg-muted rounded-xl p-1">
                <button
                  onClick={() => setActiveTab('login')}
                  className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all ${
                    activeTab === 'login' 
                      ? 'bg-background text-foreground shadow-sm' 
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Entrar
                </button>
                <button
                  onClick={() => setActiveTab('signup')}
                  className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all ${
                    activeTab === 'signup' 
                      ? 'bg-background text-foreground shadow-sm' 
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Criar Conta
                </button>
              </div>

              {activeTab === 'login' ? (
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="login-email">Email</Label>
                    <Input id="login-email" type="email" placeholder="seu@email.com" value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)} required className="h-12 rounded-xl border-border/60 bg-muted/30 focus:bg-background" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-password">Senha</Label>
                    <PasswordInput id="login-password" value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)} show={showLoginPassword}
                      onToggle={() => setShowLoginPassword(!showLoginPassword)} />
                  </div>
                  <div className="flex justify-end">
                    <button type="button" onClick={() => setShowForgotPassword(true)}
                      className="text-xs text-primary hover:underline font-medium">
                      Esqueci minha senha
                    </button>
                  </div>
                  <Button type="submit" className="w-full h-12 rounded-xl text-base font-semibold" disabled={isLoading}>
                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <LogIn className="h-4 w-4 mr-2" />}
                    Entrar
                  </Button>
                </form>
              ) : (
                <form onSubmit={handleSignup} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signup-name">Nome Completo</Label>
                    <Input id="signup-name" type="text" placeholder="Seu nome" value={signupName}
                      onChange={(e) => setSignupName(e.target.value)} required className="h-12 rounded-xl border-border/60 bg-muted/30 focus:bg-background" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-email">Email</Label>
                    <Input id="signup-email" type="email" placeholder="seu@email.com" value={signupEmail}
                      onChange={(e) => setSignupEmail(e.target.value)} required className="h-12 rounded-xl border-border/60 bg-muted/30 focus:bg-background" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Senha</Label>
                    <PasswordInput id="signup-password" value={signupPassword}
                      onChange={(e) => setSignupPassword(e.target.value)} show={showSignupPassword}
                      onToggle={() => setShowSignupPassword(!showSignupPassword)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-confirm">Confirmar Senha</Label>
                    <PasswordInput id="signup-confirm" value={signupConfirmPassword}
                      onChange={(e) => setSignupConfirmPassword(e.target.value)} show={showSignupConfirm}
                      onToggle={() => setShowSignupConfirm(!showSignupConfirm)} />
                  </div>
                  <div className="space-y-3 rounded-xl border border-border/60 p-3">
                    <div className="flex items-center space-x-2">
                      <Checkbox id="is-lawyer" checked={isLawyer} onCheckedChange={(c) => setIsLawyer(c === true)} />
                      <Label htmlFor="is-lawyer" className="flex items-center gap-1.5 cursor-pointer text-sm">
                        <Scale className="h-4 w-4" /> Sou advogado(a)
                      </Label>
                    </div>
                    {isLawyer && (
                      <div className="grid grid-cols-3 gap-2">
                        <div className="col-span-2">
                          <Input placeholder="Número da OAB" value={oabNumber} onChange={(e) => setOabNumber(e.target.value)} className="h-10 rounded-lg" />
                        </div>
                        <Select value={oabUf} onValueChange={setOabUf}>
                          <SelectTrigger className="h-10 rounded-lg"><SelectValue placeholder="UF" /></SelectTrigger>
                          <SelectContent>{UF_OPTIONS.map(uf => <SelectItem key={uf} value={uf}>{uf}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                  <Button type="submit" className="w-full h-12 rounded-xl text-base font-semibold" disabled={isLoading}>
                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <UserPlus className="h-4 w-4 mr-2" />}
                    Criar Conta
                  </Button>
                </form>
              )}

              <div className="text-center space-y-2">
                <a href="/landing" className="text-sm text-primary hover:underline font-medium">
                  ← Conheça o WhatsJUD
                </a>
                <p className="text-xs text-muted-foreground">
                  Ao criar uma conta, você concorda com nossos termos de uso.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
