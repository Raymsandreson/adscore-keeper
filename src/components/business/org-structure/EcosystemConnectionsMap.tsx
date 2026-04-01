import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Lightbulb, Package, Building2, Users, Kanban, Link2, ArrowRight } from 'lucide-react';
import { SpecializedNucleus } from '@/hooks/useSpecializedNuclei';
import { ProductService } from '@/hooks/useProductsServices';
import { Company } from '@/hooks/useCompanies';
import { KanbanBoard } from '@/hooks/useKanbanBoards';

interface Team {
  id: string;
  name: string;
  board_id: string | null;
}

interface TeamMember {
  id: string;
  team_id: string;
  user_id: string;
}

interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  user_id: string;
}

type EntityType = 'nucleus' | 'product' | 'board' | 'company' | 'team';

interface EcosystemConnectionsMapProps {
  nuclei: SpecializedNucleus[];
  products: ProductService[];
  companies: Company[];
  boards: KanbanBoard[];
  teams: Team[];
  teamMembers: TeamMember[];
  profiles: Profile[];
}

export function EcosystemConnectionsMap({
  nuclei, products, companies, boards, teams, teamMembers,
}: EcosystemConnectionsMapProps) {
  const [selectedType, setSelectedType] = useState<EntityType | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const activeNuclei = nuclei.filter(n => n.is_active);
  const activeProducts = products.filter(p => p.is_active);
  const activeCompanies = companies.filter(c => c.is_active);
  const funnelBoards = boards.filter(b => b.board_type === 'funnel');

  // Connection logic
  const getConnectedProducts = (type: EntityType, id: string) => {
    if (type === 'nucleus') return activeProducts.filter(p => p.nucleus_id === id);
    if (type === 'company') return activeProducts.filter(p => p.company_id === id);
    if (type === 'board') {
      const board = boards.find(b => b.id === id);
      return board?.product_service_id ? activeProducts.filter(p => p.id === board.product_service_id) : [];
    }
    if (type === 'team') {
      const team = teams.find(t => t.id === id);
      if (!team?.board_id) return [];
      const board = boards.find(b => b.id === team.board_id);
      return board?.product_service_id ? activeProducts.filter(p => p.id === board.product_service_id) : [];
    }
    return [];
  };

  const getConnectedBoards = (type: EntityType, id: string) => {
    if (type === 'product') return funnelBoards.filter(b => b.product_service_id === id);
    if (type === 'nucleus') {
      const nucleusProducts = activeProducts.filter(p => p.nucleus_id === id);
      return funnelBoards.filter(b => nucleusProducts.some(p => p.id === b.product_service_id));
    }
    if (type === 'company') {
      const companyProducts = activeProducts.filter(p => p.company_id === id);
      return funnelBoards.filter(b => companyProducts.some(p => p.id === b.product_service_id));
    }
    if (type === 'team') {
      const team = teams.find(t => t.id === id);
      return team?.board_id ? funnelBoards.filter(b => b.id === team.board_id) : [];
    }
    return [];
  };

  const getConnectedTeams = (type: EntityType, id: string) => {
    if (type === 'board') return teams.filter(t => t.board_id === id);
    if (type === 'product') {
      const productBoards = funnelBoards.filter(b => b.product_service_id === id);
      return teams.filter(t => productBoards.some(b => b.id === t.board_id));
    }
    if (type === 'nucleus') {
      const nucleusProducts = activeProducts.filter(p => p.nucleus_id === id);
      const productBoards = funnelBoards.filter(b => nucleusProducts.some(p => p.id === b.product_service_id));
      return teams.filter(t => productBoards.some(b => b.id === t.board_id));
    }
    if (type === 'company') {
      const companyProducts = activeProducts.filter(p => p.company_id === id);
      const productBoards = funnelBoards.filter(b => companyProducts.some(p => p.id === b.product_service_id));
      return teams.filter(t => productBoards.some(b => b.id === t.board_id));
    }
    return [];
  };

  const getConnectedNuclei = (type: EntityType, id: string) => {
    if (type === 'product') {
      const product = activeProducts.find(p => p.id === id);
      return product?.nucleus_id ? activeNuclei.filter(n => n.id === product.nucleus_id) : [];
    }
    if (type === 'board') {
      const board = boards.find(b => b.id === id);
      if (!board?.product_service_id) return [];
      const product = activeProducts.find(p => p.id === board.product_service_id);
      return product?.nucleus_id ? activeNuclei.filter(n => n.id === product.nucleus_id) : [];
    }
    if (type === 'company') {
      const companyProducts = activeProducts.filter(p => p.company_id === id);
      const nucleusIds = [...new Set(companyProducts.map(p => p.nucleus_id).filter(Boolean))];
      return activeNuclei.filter(n => nucleusIds.includes(n.id));
    }
    if (type === 'team') {
      const team = teams.find(t => t.id === id);
      if (!team?.board_id) return [];
      const board = boards.find(b => b.id === team.board_id);
      if (!board?.product_service_id) return [];
      const product = activeProducts.find(p => p.id === board.product_service_id);
      return product?.nucleus_id ? activeNuclei.filter(n => n.id === product.nucleus_id) : [];
    }
    return [];
  };

  const getConnectedCompanies = (type: EntityType, id: string) => {
    if (type === 'nucleus') {
      // Direct: nucleus.company_id
      const nucleus = activeNuclei.find(n => n.id === id);
      return nucleus?.company_id ? activeCompanies.filter(c => c.id === nucleus.company_id) : [];
    }
    if (type === 'product') {
      // Via product.company_id OR product.nucleus.company_id
      const product = activeProducts.find(p => p.id === id);
      if (product?.company_id) return activeCompanies.filter(c => c.id === product.company_id);
      if (product?.nucleus_id) {
        const nucleus = activeNuclei.find(n => n.id === product.nucleus_id);
        return nucleus?.company_id ? activeCompanies.filter(c => c.id === nucleus.company_id) : [];
      }
      return [];
    }
    if (type === 'board') {
      const board = boards.find(b => b.id === id);
      if (!board?.product_service_id) return [];
      const product = activeProducts.find(p => p.id === board.product_service_id);
      if (product?.company_id) return activeCompanies.filter(c => c.id === product.company_id);
      if (product?.nucleus_id) {
        const nucleus = activeNuclei.find(n => n.id === product.nucleus_id);
        return nucleus?.company_id ? activeCompanies.filter(c => c.id === nucleus.company_id) : [];
      }
      return [];
    }
    if (type === 'team') {
      const team = teams.find(t => t.id === id);
      if (!team?.board_id) return [];
      const board = boards.find(b => b.id === team.board_id);
      if (!board?.product_service_id) return [];
      const product = activeProducts.find(p => p.id === board.product_service_id);
      if (product?.company_id) return activeCompanies.filter(c => c.id === product.company_id);
      if (product?.nucleus_id) {
        const nucleus = activeNuclei.find(n => n.id === product.nucleus_id);
        return nucleus?.company_id ? activeCompanies.filter(c => c.id === nucleus.company_id) : [];
      }
      return [];
    }
    return [];
  };

  const isHighlighted = (type: EntityType, id: string) => {
    if (!selectedType || !selectedId) return false;
    if (selectedType === type && selectedId === id) return true;
    if (type === 'nucleus') return getConnectedNuclei(selectedType, selectedId).some(n => n.id === id);
    if (type === 'product') return getConnectedProducts(selectedType, selectedId).some(p => p.id === id);
    if (type === 'board') return getConnectedBoards(selectedType, selectedId).some(b => b.id === id);
    if (type === 'team') return getConnectedTeams(selectedType, selectedId).some(t => t.id === id);
    if (type === 'company') return getConnectedCompanies(selectedType, selectedId).some(c => c.id === id);
    return false;
  };

  const handleSelect = (type: EntityType, id: string) => {
    if (selectedType === type && selectedId === id) {
      setSelectedType(null);
      setSelectedId(null);
    } else {
      setSelectedType(type);
      setSelectedId(id);
    }
  };

  const hasSelection = selectedType !== null;

  const itemClass = (type: EntityType, id: string) => {
    const highlighted = isHighlighted(type, id);
    const dimmed = hasSelection && !highlighted;
    return `p-3 rounded-lg border cursor-pointer transition-all duration-200 ${
      highlighted
        ? 'ring-2 ring-primary border-primary bg-primary/5 shadow-md scale-[1.02]'
        : dimmed
          ? 'opacity-30 border-border bg-card'
          : 'border-border bg-card hover:border-primary/50 hover:shadow-sm'
    }`;
  };

  // Summary of connections when selected
  const renderConnectionSummary = () => {
    if (!selectedType || !selectedId) return null;
    const connNuclei = getConnectedNuclei(selectedType, selectedId);
    const connProducts = getConnectedProducts(selectedType, selectedId);
    const connBoards = getConnectedBoards(selectedType, selectedId);
    const connTeams = getConnectedTeams(selectedType, selectedId);
    const connCompanies = getConnectedCompanies(selectedType, selectedId);

    const parts: string[] = [];
    if (selectedType !== 'nucleus' && connNuclei.length > 0) parts.push(`${connNuclei.length} núcleo(s)`);
    if (selectedType !== 'product' && connProducts.length > 0) parts.push(`${connProducts.length} produto(s)`);
    if (selectedType !== 'board' && connBoards.length > 0) parts.push(`${connBoards.length} funil(is)`);
    if (selectedType !== 'team' && connTeams.length > 0) parts.push(`${connTeams.length} time(s)`);
    if (selectedType !== 'company' && connCompanies.length > 0) parts.push(`${connCompanies.length} empresa(s)`);

    if (parts.length === 0) return (
      <div className="text-center py-2 px-4 rounded-lg bg-muted/50 border border-dashed text-sm text-muted-foreground">
        Nenhuma conexão encontrada — vincule este item a outros no gerenciamento
      </div>
    );

    return (
      <div className="flex items-center gap-2 py-2 px-4 rounded-lg bg-primary/5 border border-primary/20 text-sm">
        <Link2 className="h-4 w-4 text-primary shrink-0" />
        <span className="text-muted-foreground">Conectado a:</span>
        <span className="font-medium">{parts.join(' · ')}</span>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Link2 className="h-4 w-4 text-primary" />
          Mapa de Conexões do Ecossistema
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Clique em qualquer item para ver suas conexões. Cadeia: Núcleo → Produto → Funil → Time | Produto → Empresa
        </p>
        {hasSelection && (
          <Button variant="ghost" size="sm" className="self-start text-xs mt-1" onClick={() => { setSelectedType(null); setSelectedId(null); }}>
            Limpar seleção
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {renderConnectionSummary()}

        {/* Flow columns */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {/* Núcleos */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 mb-2">
              <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Núcleos</span>
              <Badge variant="secondary" className="text-[10px] ml-auto">{activeNuclei.length}</Badge>
            </div>
            {activeNuclei.map(n => (
              <div key={n.id} className={itemClass('nucleus', n.id)} onClick={() => handleSelect('nucleus', n.id)}>
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: n.color }} />
                  <p className="text-xs font-medium truncate">{n.name}</p>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">{n.prefix}</p>
              </div>
            ))}
            {activeNuclei.length === 0 && <p className="text-xs text-muted-foreground italic text-center py-2">Nenhum</p>}
          </div>

          {/* Produtos */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 mb-2">
              <Package className="h-3.5 w-3.5 text-emerald-500" />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Produtos</span>
              <Badge variant="secondary" className="text-[10px] ml-auto">{activeProducts.length}</Badge>
            </div>
            {activeProducts.map(p => (
              <div key={p.id} className={itemClass('product', p.id)} onClick={() => handleSelect('product', p.id)}>
                <p className="text-xs font-medium truncate">{p.name}</p>
                <div className="flex gap-1 mt-1 flex-wrap">
                  <Badge variant="outline" className="text-[10px]">{p.product_type}</Badge>
                  {!p.nucleus_id && !p.company_id && (
                    <Badge variant="destructive" className="text-[10px]">Sem vínculo</Badge>
                  )}
                </div>
              </div>
            ))}
            {activeProducts.length === 0 && <p className="text-xs text-muted-foreground italic text-center py-2">Nenhum</p>}
          </div>

          {/* Funis */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 mb-2">
              <Kanban className="h-3.5 w-3.5 text-blue-500" />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Funis</span>
              <Badge variant="secondary" className="text-[10px] ml-auto">{funnelBoards.length}</Badge>
            </div>
            {funnelBoards.map(b => (
              <div key={b.id} className={itemClass('board', b.id)} onClick={() => handleSelect('board', b.id)}>
                <p className="text-xs font-medium truncate">{b.name}</p>
                {!b.product_service_id && (
                  <Badge variant="destructive" className="text-[10px] mt-1">Sem produto</Badge>
                )}
              </div>
            ))}
            {funnelBoards.length === 0 && <p className="text-xs text-muted-foreground italic text-center py-2">Nenhum</p>}
          </div>

          {/* Times */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 mb-2">
              <Users className="h-3.5 w-3.5 text-purple-500" />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Times</span>
              <Badge variant="secondary" className="text-[10px] ml-auto">{teams.length}</Badge>
            </div>
            {teams.map(t => {
              const memberCount = teamMembers.filter(tm => tm.team_id === t.id).length;
              return (
                <div key={t.id} className={itemClass('team', t.id)} onClick={() => handleSelect('team', t.id)}>
                  <p className="text-xs font-medium truncate">{t.name}</p>
                  <p className="text-[10px] text-muted-foreground">{memberCount} membro(s)</p>
                  {!t.board_id && (
                    <Badge variant="destructive" className="text-[10px] mt-1">Sem funil</Badge>
                  )}
                </div>
              );
            })}
            {teams.length === 0 && <p className="text-xs text-muted-foreground italic text-center py-2">Nenhum</p>}
          </div>

          {/* Empresas */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 mb-2">
              <Building2 className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Empresas</span>
              <Badge variant="secondary" className="text-[10px] ml-auto">{activeCompanies.length}</Badge>
            </div>
            {activeCompanies.map(c => (
              <div key={c.id} className={itemClass('company', c.id)} onClick={() => handleSelect('company', c.id)}>
                <p className="text-xs font-medium truncate">{c.name}</p>
                {c.trading_name && <p className="text-[10px] text-muted-foreground truncate">{c.trading_name}</p>}
              </div>
            ))}
            {activeCompanies.length === 0 && <p className="text-xs text-muted-foreground italic text-center py-2">Nenhuma</p>}
          </div>
        </div>

        {/* Flow arrows hint */}
        <div className="flex items-center justify-center gap-2 pt-2 text-muted-foreground">
          <span className="text-[10px] font-medium">Núcleo</span>
          <ArrowRight className="h-3 w-3" />
          <span className="text-[10px] font-medium">Produto</span>
          <ArrowRight className="h-3 w-3" />
          <span className="text-[10px] font-medium">Funil</span>
          <ArrowRight className="h-3 w-3" />
          <span className="text-[10px] font-medium">Time</span>
          <span className="text-[10px] mx-1">|</span>
          <span className="text-[10px] font-medium">Produto</span>
          <ArrowRight className="h-3 w-3" />
          <span className="text-[10px] font-medium">Empresa</span>
        </div>
      </CardContent>
    </Card>
  );
}
