import { Card, CardContent } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Target, Building2, Package, Lightbulb, Briefcase, Network, ChevronRight, ArrowRight, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

export type TranslationAction =
  | { type: 'tab'; tab: 'modelo' | 'estrutura' }
  | { type: 'route'; route: string }
  | { type: 'dialog'; dialog: 'newProduct' };

interface TranslationRow {
  question: string;
  structure: string;
  icon: React.ReactNode;
  color: string;
  detail: {
    explanation: string;
    steps: string[];
    action: string;
    onAction: TranslationAction;
  };
}

const TRANSLATION_ROWS: TranslationRow[] = [
  {
    question: 'Quem é o cliente?',
    structure: 'Núcleos',
    icon: <Lightbulb className="h-4 w-4 text-amber-500" />,
    color: 'border-l-amber-500',
    detail: {
      explanation: 'O cliente é definido pelo problema que ele tem — e o Núcleo Especializado é a unidade que domina esse problema.',
      steps: [
        'Identifique o perfil do cliente ideal (ICP) para cada núcleo',
        'Mapeie a dor principal que ele busca resolver',
        'Valide se o núcleo tem expertise comprovada nessa dor',
      ],
      action: 'Cadastrar Núcleos Especializados →',
      onAction: { type: 'tab', tab: 'modelo' },
    },
  },
  {
    question: 'Como ele chega?',
    structure: 'Marketing + Comercial',
    icon: <Target className="h-4 w-4 text-blue-500" />,
    color: 'border-l-blue-500',
    detail: {
      explanation: 'O canal de aquisição conecta a marca ao cliente. Marketing gera demanda, Comercial converte.',
      steps: [
        'Defina os canais de aquisição (orgânico, pago, indicação, parcerias)',
        'Crie processos comerciais replicáveis (scripts, workflows)',
        'Vincule cada canal a um centro de custo para medir ROI',
      ],
      action: 'Ir para CRM & Pipelines →',
      onAction: { type: 'route', route: '/crm' },
    },
  },
  {
    question: 'Como entregamos?',
    structure: 'Jurídico + Operações',
    icon: <Briefcase className="h-4 w-4 text-green-500" />,
    color: 'border-l-green-500',
    detail: {
      explanation: 'A entrega é onde a promessa da marca se materializa. Precisa de sistemas, não de heróis.',
      steps: [
        'Documente o processo de entrega ponta a ponta',
        'Defina os cargos e funções responsáveis por cada etapa',
        'Crie checklists e SLAs para garantir consistência',
      ],
      action: 'Organizar Áreas e Times →',
      onAction: { type: 'tab', tab: 'estrutura' },
    },
  },
  {
    question: 'Como ganhamos dinheiro?',
    structure: 'Financeiro + Produtos',
    icon: <Package className="h-4 w-4 text-emerald-500" />,
    color: 'border-l-emerald-500',
    detail: {
      explanation: 'O modelo de receita define como o valor criado é capturado. Cada produto é uma expressão monetizável da marca.',
      steps: [
        'Cadastre cada produto/serviço com ticket e faixa de preço',
        'Defina o foco estratégico: gera caixa ou constrói equity?',
        'Vincule produtos aos núcleos que os sustentam',
      ],
      action: 'Cadastrar Produtos →',
      onAction: { type: 'dialog', dialog: 'newProduct' },
    },
  },
  {
    question: 'Como escalamos?',
    structure: 'Tecnologia + Processos',
    icon: <Network className="h-4 w-4 text-purple-500" />,
    color: 'border-l-purple-500',
    detail: {
      explanation: 'Escalar = replicar a experiência da marca sem depender de indivíduos. Sistema > pessoa.',
      steps: [
        'Automatize processos repetitivos com tecnologia',
        'Crie planos de carreira para reter talentos-chave',
        'Estruture empresas como veículos de equity independentes',
      ],
      action: 'Ver Estrutura Organizacional →',
      onAction: { type: 'tab', tab: 'estrutura' },
    },
  },
];

const ECOSYSTEM_PURPOSES = [
  {
    text: 'Eficiência tributária',
    color: 'border-l-emerald-500',
    detail: {
      how: 'Cada empresa do ecossistema pode optar pelo regime tributário mais vantajoso (Simples, Lucro Presumido, Real) conforme sua atividade e faturamento.',
      example: 'Uma holding patrimonial em Lucro Presumido paga ~11% sobre aluguéis, vs. até 27,5% como PF.',
    },
  },
  {
    text: 'Especialização operacional',
    color: 'border-l-blue-500',
    detail: {
      how: 'Separar atividades em empresas distintas permite que cada uma tenha processos, equipe e métricas específicas.',
      example: 'A empresa de marketing foca em CAC e ROAS. A operacional foca em SLA e NPS. Métricas claras = decisões melhores.',
    },
  },
  {
    text: 'Proteção patrimonial',
    color: 'border-l-amber-500',
    detail: {
      how: 'Isolar ativos em holdings e SPEs protege o patrimônio pessoal e separa riscos operacionais.',
      example: 'Se a empresa operacional tiver um passivo trabalhista, os imóveis na holding estão protegidos.',
    },
  },
  {
    text: 'Escalabilidade',
    color: 'border-l-purple-500',
    detail: {
      how: 'Cada unidade pode escalar independentemente, receber investimento ou ser vendida sem impactar as demais.',
      example: 'Vender 30% de uma empresa de tecnologia do grupo sem afetar a operação jurídica.',
    },
  },
  {
    text: 'Redução de riscos',
    color: 'border-l-red-500',
    detail: {
      how: 'Riscos ficam compartimentalizados. Um problema em uma empresa não contamina todo o ecossistema.',
      example: 'Uma crise regulatória no setor X só afeta a empresa X, preservando fluxo de caixa das demais.',
    },
  },
];

interface BusinessModelTranslationProps {
  onAction?: (action: TranslationAction) => void;
}

export function BusinessModelTranslation({ onAction }: BusinessModelTranslationProps) {
  const handleAction = (action: TranslationAction) => {
    onAction?.(action);
  };

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
      <CardContent className="p-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Translation - Clickable */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-2">
              <Target className="h-3.5 w-3.5 text-primary" />
              Tradução Direta
              <span className="text-[10px] font-normal text-muted-foreground/60">· clique para explorar</span>
            </h3>
            <Accordion type="single" collapsible className="space-y-1">
              {TRANSLATION_ROWS.map((row, i) => (
                <AccordionItem key={i} value={`q-${i}`} className={cn("border rounded-lg px-3 border-l-4", row.color, "data-[state=open]:bg-muted/30")}>
                  <AccordionTrigger className="py-2.5 text-sm hover:no-underline gap-2">
                    <div className="flex items-center gap-2 flex-1 text-left">
                      {row.icon}
                      <span className="font-medium">{row.question}</span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground mx-1" />
                      <span className="text-muted-foreground text-xs">{row.structure}</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pb-3">
                    <div className="space-y-2.5 pl-6">
                      <p className="text-sm text-foreground/80">{row.detail.explanation}</p>
                      <div className="space-y-1">
                        {row.detail.steps.map((step, j) => (
                          <div key={j} className="flex items-start gap-2 text-xs text-muted-foreground">
                            <span className="font-bold text-primary mt-0.5">{j + 1}.</span>
                            <span>{step}</span>
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={() => handleAction(row.detail.onAction)}
                        className="flex items-center gap-2 w-full p-2.5 rounded-md bg-primary/10 hover:bg-primary/20 border border-primary/20 hover:border-primary/40 text-xs transition-all cursor-pointer group"
                      >
                        <ExternalLink className="h-3.5 w-3.5 text-primary shrink-0 group-hover:scale-110 transition-transform" />
                        <span className="text-primary font-semibold">{row.detail.action}</span>
                      </button>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>

          {/* Ecosystem - Clickable */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-2">
              <Building2 className="h-3.5 w-3.5 text-primary" />
              Por que um ecossistema?
              <span className="text-[10px] font-normal text-muted-foreground/60">· clique para ver como</span>
            </h3>
            <Accordion type="single" collapsible className="space-y-1">
              {ECOSYSTEM_PURPOSES.map((p, i) => (
                <AccordionItem key={i} value={`e-${i}`} className={cn("border rounded-lg px-3 border-l-4", p.color, "data-[state=open]:bg-muted/30")}>
                  <AccordionTrigger className="py-2.5 text-sm hover:no-underline gap-2">
                    <div className="flex items-center gap-2 flex-1 text-left">
                      <span className="text-emerald-500 font-bold text-xs">✔</span>
                      <span className="font-medium">{p.text}</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pb-3">
                    <div className="space-y-2 pl-6">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Como funciona</p>
                        <p className="text-sm text-foreground/80">{p.detail.how}</p>
                      </div>
                      <div className="p-2 rounded-md bg-muted/50 border">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Exemplo prático</p>
                        <p className="text-xs text-muted-foreground">{p.detail.example}</p>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>

            {/* Compact definition cards */}
            <div className="grid grid-cols-2 gap-2 mt-3">
              <button
                onClick={() => handleAction({ type: 'tab', tab: 'modelo' })}
                className="flex items-center gap-2 p-2 rounded-lg border bg-card text-xs hover:bg-muted/50 transition-colors cursor-pointer text-left"
              >
                <span className="text-base">👉</span>
                <div>
                  <p className="font-semibold text-primary leading-tight">Modelo de Negócios</p>
                  <p className="text-muted-foreground text-[10px]">Como criamos, entregamos e capturamos valor.</p>
                </div>
              </button>
              <button
                onClick={() => handleAction({ type: 'tab', tab: 'estrutura' })}
                className="flex items-center gap-2 p-2 rounded-lg border bg-card text-xs hover:bg-muted/50 transition-colors cursor-pointer text-left"
              >
                <span className="text-base">👉</span>
                <div>
                  <p className="font-semibold text-primary leading-tight">Estrutura</p>
                  <p className="text-muted-foreground text-[10px]">Quem executa cada parte desse valor.</p>
                </div>
              </button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
