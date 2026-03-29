import { useNavigate } from "react-router-dom";
import { useAuthContext } from "@/contexts/AuthContext";
import { useEffect } from "react";
import {
  CheckCircle2, MessageSquare, BarChart3, Shield, Users, Zap,
  Bot, FileText, Phone, ArrowRight, ChevronRight, Star
} from "lucide-react";
import { Button } from "@/components/ui/button";
import dashboardMockup from "@/assets/dashboard-mockup.jpg";
import abraciLogo from "@/assets/abraci-logo.jpg";

const WhatsJUDLogo = ({ size = "md" }: { size?: "sm" | "md" | "lg" }) => {
  const sizes = { sm: "text-xl", md: "text-3xl", lg: "text-5xl" };
  return (
    <div className="flex items-center gap-1">
      <span className={`${sizes[size]} font-light tracking-tight text-foreground`}>whats</span>
      <span className={`${sizes[size]} font-bold text-primary-foreground bg-primary px-2 py-0.5 rounded-md`}>JUD</span>
    </div>
  );
};

const features = [
  {
    icon: MessageSquare,
    title: "WhatsApp com IA",
    desc: "Agentes de inteligência artificial que atendem, qualificam e fazem follow-up automaticamente pelo WhatsApp.",
  },
  {
    icon: BarChart3,
    title: "Kanban & Funil de Vendas",
    desc: "Visualize toda a jornada do cliente em quadros personalizáveis com drag-and-drop intuitivo.",
  },
  {
    icon: Bot,
    title: "Automações Inteligentes",
    desc: "Crie fluxos automáticos: criação de grupos, envio de documentos, follow-ups programados.",
  },
  {
    icon: FileText,
    title: "Assinatura Eletrônica",
    desc: "Integração nativa com ZapSign para envio e acompanhamento de contratos digitais.",
  },
  {
    icon: Phone,
    title: "Ligações com Transcrição IA",
    desc: "Realize chamadas diretamente da plataforma com gravação e resumo automático por IA.",
  },
  {
    icon: Users,
    title: "Gestão de Equipes",
    desc: "Controle de produtividade, metas, comissões e ranking em tempo real.",
  },
  {
    icon: BarChart3,
    title: "Modelo de Negócios & Lucratividade",
    desc: "Gerencie seu modelo de negócios com medição de lucratividade por produto, equity e visão estratégica completa.",
  },
  {
    icon: Shield,
    title: "Contabilidade & Jurimetria",
    desc: "Controle financeiro integrado com análise jurimétrica para decisões baseadas em dados reais.",
  },
  {
    icon: Zap,
    title: "Antecipação de Honorários",
    desc: "Antecipe recebíveis do escritório com controle total de fluxo de caixa e previsibilidade financeira.",
  },
  {
    icon: CheckCircle2,
    title: "Bancarização do Escritório",
    desc: "Transforme seu escritório em um hub financeiro: ofereça crédito e empréstimos para seus próprios clientes.",
  },
];

const stats = [
  { value: "10x", label: "mais produtividade" },
  { value: "500+", label: "escritórios atendidos" },
  { value: "98%", label: "taxa de satisfação" },
  { value: "24/7", label: "atendimento IA" },
];

const LandingPage = () => {
  const { isAuthenticated } = useAuthContext();
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthenticated) navigate("/", { replace: true });
  }, [isAuthenticated, navigate]);

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border/40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
          <WhatsJUDLogo size="sm" />
          <div className="hidden md:flex items-center gap-8 text-sm text-muted-foreground">
            <a href="#funcionalidades" className="hover:text-foreground transition-colors">Funcionalidades</a>
            <a href="#como-funciona" className="hover:text-foreground transition-colors">Como funciona</a>
            <a href="#clientes" className="hover:text-foreground transition-colors">Clientes</a>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")}>
              Entrar
            </Button>
            <Button size="sm" onClick={() => navigate("/dashboard")} className="gap-1">
              Teste grátis <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-16 pb-20 md:pt-24 md:pb-32">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <div className="text-center max-w-4xl mx-auto mb-12">
            <div className="inline-flex items-center gap-2 bg-primary/10 text-primary text-sm font-medium px-4 py-1.5 rounded-full mb-6">
              <Zap className="h-4 w-4" />
              Plataforma #1 para escritórios jurídicos
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-foreground leading-tight mb-6">
              Plataforma de geração de{" "}
              <span className="text-primary">dinheiro infinito</span> para advogados
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
              Conquiste sua liberdade financeira e operacional. Enquanto a IA cuida do atendimento, 
              captação e follow-up, você foca no que realmente importa: crescer e lucrar.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button size="lg" onClick={() => navigate("/dashboard")} className="gap-2 text-base h-12 px-8 rounded-xl shadow-lg shadow-primary/25">
                Cadastre-se Gratuitamente <ArrowRight className="h-4 w-4" />
              </Button>
              <Button size="lg" variant="outline" onClick={() => {
                document.getElementById("funcionalidades")?.scrollIntoView({ behavior: "smooth" });
              }} className="text-base h-12 px-8 rounded-xl">
                Conheça as funcionalidades
              </Button>
            </div>
          </div>

          {/* Dashboard Mockup */}
          <div className="relative max-w-5xl mx-auto">
            <div className="absolute -inset-4 bg-gradient-to-t from-primary/10 via-primary/5 to-transparent rounded-3xl blur-2xl" />
            <div className="relative rounded-2xl overflow-hidden shadow-2xl shadow-primary/10 border border-border/40">
              <img
                src={dashboardMockup}
                alt="WhatsJUD Dashboard - CRM Jurídico com WhatsApp e IA"
                width={1280}
                height={800}
                className="w-full h-auto"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-12 bg-muted/30 border-y border-border/40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((s, i) => (
              <div key={i} className="text-center">
                <p className="text-3xl md:text-4xl font-bold text-primary">{s.value}</p>
                <p className="text-sm text-muted-foreground mt-1">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="funcionalidades" className="py-20 md:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              Tudo que você precisa em um só lugar
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Do primeiro contato à conclusão do caso, o WhatsJUD automatiza e organiza todo o fluxo do seu escritório.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f, i) => (
              <div key={i} className="group p-6 rounded-2xl border border-border/60 bg-card hover:shadow-lg hover:shadow-primary/5 hover:border-primary/30 transition-all duration-300">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/15 transition-colors">
                  <f.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="como-funciona" className="py-20 md:py-28 bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">Como funciona</h2>
            <p className="text-lg text-muted-foreground">Comece a usar em 3 passos simples</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { step: "01", title: "Crie sua conta", desc: "Cadastro gratuito em menos de 2 minutos. Sem cartão de crédito." },
              { step: "02", title: "Conecte seu WhatsApp", desc: "Escaneie o QR Code e conecte suas instâncias de WhatsApp à plataforma." },
              { step: "03", title: "Ative seus agentes IA", desc: "Configure os agentes para atender, qualificar e acompanhar seus leads automaticamente." },
            ].map((s, i) => (
              <div key={i} className="relative text-center">
                <div className="w-16 h-16 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center text-2xl font-bold mx-auto mb-6">
                  {s.step}
                </div>
                {i < 2 && (
                  <ChevronRight className="hidden md:block absolute top-8 -right-4 h-6 w-6 text-primary/40" />
                )}
                <h3 className="text-xl font-semibold text-foreground mb-3">{s.title}</h3>
                <p className="text-muted-foreground text-sm">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Client: ABRACI */}
      <section id="clientes" className="py-20 md:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              Quem usa, confia
            </h2>
            <p className="text-lg text-muted-foreground">
              Organizações que confiam no WhatsJUD para gerenciar seus processos
            </p>
          </div>
          <div className="max-w-3xl mx-auto">
            <div className="bg-card rounded-3xl border border-border/60 p-8 md:p-12 shadow-lg">
              <div className="flex flex-col md:flex-row items-center gap-8">
                <div className="flex-shrink-0">
                  <img
                    src={abraciLogo}
                    alt="ABRACI - Associação Brasileira"
                    width={160}
                    height={160}
                    loading="lazy"
                    className="w-32 h-32 md:w-40 md:h-40 object-contain rounded-2xl"
                  />
                </div>
                <div className="flex-1 text-center md:text-left">
                  <div className="flex gap-1 justify-center md:justify-start mb-3">
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} className="h-5 w-5 fill-primary text-primary" />
                    ))}
                  </div>
                  <blockquote className="text-foreground text-lg font-medium mb-4 leading-relaxed">
                    "O WhatsJUD revolucionou a forma como gerenciamos nossos casos e nos comunicamos com nossos beneficiários. 
                    A automação via WhatsApp com IA nos permitiu escalar o atendimento mantendo a qualidade."
                  </blockquote>
                  <div>
                    <p className="font-semibold text-foreground">ABRACI</p>
                    <p className="text-sm text-muted-foreground">Associação Brasileira de Cidadania</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 md:py-28 bg-primary relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 left-10 w-72 h-72 rounded-full bg-white/20 blur-3xl" />
          <div className="absolute bottom-10 right-10 w-96 h-96 rounded-full bg-white/10 blur-3xl" />
        </div>
        <div className="max-w-4xl mx-auto px-4 text-center relative z-10">
          <h2 className="text-3xl md:text-4xl font-bold text-primary-foreground mb-6">
            Pronto para transformar seu escritório?
          </h2>
          <p className="text-lg text-primary-foreground/80 mb-8 max-w-2xl mx-auto">
            Junte-se a centenas de escritórios que já estão usando IA para automatizar atendimentos e acelerar processos.
          </p>
          <Button
            size="lg"
            variant="secondary"
            onClick={() => navigate("/dashboard")}
            className="text-base h-12 px-8 rounded-xl gap-2 font-semibold"
          >
            Comece agora — é grátis <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 bg-background border-t border-border/40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <WhatsJUDLogo size="sm" />
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} WhatsJUD. Todos os direitos reservados.
          </p>
          <div className="flex gap-6 text-sm text-muted-foreground">
            <a href="/privacy" className="hover:text-foreground transition-colors">Privacidade</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
