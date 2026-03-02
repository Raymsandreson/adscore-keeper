import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Lightbulb, Users, Package } from 'lucide-react';
import { SpecializedNucleus } from '@/hooks/useSpecializedNuclei';
import { ProductService } from '@/hooks/useProductsServices';
import { Company } from '@/hooks/useCompanies';
import { BrandIdentityCard } from './BrandIdentityCard';
import { ValueFlowSection } from './ValueFlowSection';

interface CreateValueSectionProps {
  companies: Company[];
  nuclei: SpecializedNucleus[];
  products: ProductService[];
  profiles: { id: string; full_name: string | null; email: string | null; user_id: string }[];
}

export function CreateValueSection({ companies, nuclei, products, profiles }: CreateValueSectionProps) {
  const activeNuclei = nuclei.filter(n => n.is_active);
  const activeProducts = products.filter(p => p.is_active);

  return (
    <ValueFlowSection
      color="green"
      number={1}
      title="Criar Valor"
      subtitle="Identidade + Mentalidade + Expertise — de onde vem o valor"
    >
      {/* Marca */}
      <BrandIdentityCard companies={companies} />

      {/* Pessoas / Cultura */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4 text-emerald-500" />
            Pessoas & Cultura
            <Badge variant="secondary" className="ml-auto">{profiles.length} pessoas</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">
            Pessoas são o motor de criação de valor. Cultura alinhada à marca transforma funcionários em embaixadores.
          </p>
          {profiles.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {profiles.slice(0, 12).map(p => (
                <div key={p.id} className="p-2 rounded-md border bg-card text-sm">
                  <p className="font-medium text-xs truncate">{p.full_name || p.email || 'Sem nome'}</p>
                </div>
              ))}
              {profiles.length > 12 && (
                <div className="p-2 rounded-md border bg-muted text-sm flex items-center justify-center">
                  <p className="text-xs text-muted-foreground">+{profiles.length - 12} mais</p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-3 italic">Nenhuma pessoa cadastrada</p>
          )}
        </CardContent>
      </Card>

      {/* Núcleos */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-amber-500" />
            Núcleos Especializados
            <Badge variant="secondary" className="ml-auto">{activeNuclei.length} núcleos</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">
            Expertise que reforça a promessa da marca — cada núcleo é uma competência central.
          </p>
          {activeNuclei.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-3 italic">Nenhum núcleo cadastrado</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {activeNuclei.map(nucleus => (
                <div key={nucleus.id} className="p-3 rounded-lg border bg-card flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: nucleus.color }} />
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{nucleus.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{nucleus.prefix}{nucleus.description ? ` · ${nucleus.description}` : ''}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Produtos & Serviços */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4 text-emerald-500" />
            Produtos & Serviços
            <Badge variant="secondary" className="ml-auto">{activeProducts.length} ativos</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">
            Cada produto é uma expressão tangível da marca — não vende o produto, vende a transformação.
          </p>
          {activeProducts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-3 italic">Nenhum produto cadastrado</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {activeProducts.map(prod => (
                <div key={prod.id} className="p-2.5 rounded-md border bg-card text-sm">
                  <p className="font-medium truncate">{prod.name}</p>
                  <div className="flex gap-1.5 mt-1 flex-wrap">
                    <Badge variant="outline" className="text-xs">{prod.product_type}</Badge>
                    <Badge variant="secondary" className="text-xs">{prod.ticket_tier}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </ValueFlowSection>
  );
}
