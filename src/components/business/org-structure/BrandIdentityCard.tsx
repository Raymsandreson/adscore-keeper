import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Building2 } from 'lucide-react';
import { Company } from '@/hooks/useCompanies';

interface BrandIdentityCardProps {
  companies: Company[];
}

const BRAND_ARCHITECTURE_MODELS = [
  { key: 'master', label: 'Master Brand', desc: 'Uma marca forte unifica tudo', example: 'Ex: Virgin' },
  { key: 'endorsed', label: 'Endorsed', desc: 'Marca mãe chancela as sub-marcas', example: 'Ex: Marriott → Courtyard by Marriott' },
  { key: 'house', label: 'House of Brands', desc: 'Marcas independentes sob um grupo', example: 'Ex: P&G (Gillette, Pampers)' },
  { key: 'hybrid', label: 'Híbrido', desc: 'Mix estratégico conforme o público', example: 'Ex: Alphabet → Google, YouTube' },
];

export function BrandIdentityCard({ companies }: BrandIdentityCardProps) {
  const activeCompanies = companies.filter(c => c.is_active);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-500" />
          Marca & Identidade
          <Badge variant="secondary" className="ml-auto text-xs">Eixo central</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          A marca é o ativo invisível que multiplica valor em cada etapa. Sem identidade clara, um grupo é apenas um amontoado de CNPJs.
        </p>

        {/* Brand Architecture Models */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Modelos de Arquitetura de Marca</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {BRAND_ARCHITECTURE_MODELS.map(model => (
              <div key={model.key} className="p-3 rounded-lg border bg-card">
                <p className="font-medium text-sm">{model.label}</p>
                <p className="text-xs text-muted-foreground">{model.desc}</p>
                <p className="text-xs text-muted-foreground italic mt-1">{model.example}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Current brands / companies as brand carriers */}
        {activeCompanies.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Suas marcas atuais</p>
            <div className="flex flex-wrap gap-2">
              {activeCompanies.map(c => (
                <div key={c.id} className="flex items-center gap-2 px-3 py-1.5 rounded-full border bg-card">
                  <Building2 className="h-3 w-3 text-muted-foreground" />
                  <span className="text-sm font-medium">{c.trading_name || c.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
