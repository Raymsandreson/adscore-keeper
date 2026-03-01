import { Card, CardContent } from '@/components/ui/card';
import { Target, Users, Building2, Package, Lightbulb, Briefcase, UserCheck, Network } from 'lucide-react';

const TRANSLATION_ROWS = [
  {
    question: 'Quem é o cliente?',
    structure: 'Núcleos',
    icon: <Lightbulb className="h-4 w-4 text-amber-500" />,
    structureIcon: <Lightbulb className="h-4 w-4 text-amber-500" />,
  },
  {
    question: 'Como ele chega?',
    structure: 'Marketing + Comercial',
    icon: <Target className="h-4 w-4 text-blue-500" />,
    structureIcon: <Target className="h-4 w-4 text-blue-500" />,
  },
  {
    question: 'Como entregamos?',
    structure: 'Jurídico + Operações',
    icon: <Briefcase className="h-4 w-4 text-green-500" />,
    structureIcon: <Briefcase className="h-4 w-4 text-green-500" />,
  },
  {
    question: 'Como ganhamos dinheiro?',
    structure: 'Financeiro + Produtos',
    icon: <Package className="h-4 w-4 text-emerald-500" />,
    structureIcon: <Package className="h-4 w-4 text-emerald-500" />,
  },
  {
    question: 'Como escalamos?',
    structure: 'Tecnologia + Processos',
    icon: <Network className="h-4 w-4 text-purple-500" />,
    structureIcon: <Network className="h-4 w-4 text-purple-500" />,
  },
];

const ECOSYSTEM_PURPOSES = [
  { icon: '✔', text: 'Eficiência tributária' },
  { icon: '✔', text: 'Especialização operacional' },
  { icon: '✔', text: 'Proteção patrimonial' },
  { icon: '✔', text: 'Escalabilidade' },
  { icon: '✔', text: 'Redução de riscos' },
];

export function BusinessModelTranslation() {
  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
      <CardContent className="p-5">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Translation Table */}
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" />
              Tradução Direta
            </h3>
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left p-2.5 font-semibold text-foreground">Modelo de Negócios</th>
                    <th className="text-left p-2.5 font-semibold text-foreground">Estrutura responde</th>
                  </tr>
                </thead>
                <tbody>
                  {TRANSLATION_ROWS.map((row, i) => (
                    <tr key={i} className="border-t hover:bg-muted/30 transition-colors">
                      <td className="p-2.5 flex items-center gap-2">
                        {row.icon}
                        <span>{row.question}</span>
                      </td>
                      <td className="p-2.5 text-muted-foreground">{row.structure}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Ecosystem Purposes */}
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              Por que um ecossistema de empresas?
            </h3>
            <div className="space-y-2">
              {ECOSYSTEM_PURPOSES.map((p, i) => (
                <div key={i} className="flex items-center gap-2 text-sm p-2 rounded-md bg-muted/30">
                  <span className="text-emerald-500 font-bold">{p.icon}</span>
                  <span>{p.text}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-2">
              <div className="flex items-start gap-2 p-2.5 rounded-lg border bg-card">
                <span className="text-lg">👉</span>
                <div>
                  <p className="text-xs font-semibold text-primary">Modelo de Negócios</p>
                  <p className="text-xs text-muted-foreground">Como criamos, entregamos e capturamos valor.</p>
                </div>
              </div>
              <div className="flex items-start gap-2 p-2.5 rounded-lg border bg-card">
                <span className="text-lg">👉</span>
                <div>
                  <p className="text-xs font-semibold text-primary">Estrutura Organizacional</p>
                  <p className="text-xs text-muted-foreground">Quem executa cada parte desse valor.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
