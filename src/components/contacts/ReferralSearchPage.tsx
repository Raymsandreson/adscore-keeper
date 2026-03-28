import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, MapPin, Package, Users, Phone, Mail, UserCheck, Filter } from 'lucide-react';

interface ReferralContact {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  neighborhood: string | null;
  profession: string | null;
  classification: string | null;
  classifications: string[] | null;
  lead_id: string | null;
}

interface ProductService {
  id: string;
  name: string;
}

interface BoardWithProduct {
  id: string;
  name: string;
  product_service_id: string | null;
}

export function ReferralSearchPage() {
  const [contacts, setContacts] = useState<ReferralContact[]>([]);
  const [products, setProducts] = useState<ProductService[]>([]);
  const [boards, setBoards] = useState<BoardWithProduct[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterState, setFilterState] = useState<string>('__all__');
  const [filterCity, setFilterCity] = useState<string>('__all__');
  const [filterProduct, setFilterProduct] = useState<string>('__all__');
  const [filterClassification, setFilterClassification] = useState<string>('__all__');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const [contactsRes, productsRes, boardsRes, leadsRes] = await Promise.all([
      supabase.from('contacts').select('id, full_name, phone, email, city, state, neighborhood, profession, classification, classifications, lead_id'),
      supabase.from('products_services').select('id, name').eq('is_active', true).order('display_order'),
      supabase.from('kanban_boards').select('id, name, product_service_id'),
      supabase.from('leads').select('id, city, state, neighborhood, product_service_id, board_id'),
    ]);
    
    // Enrich contacts with lead location data
    const leadsMap = new Map((leadsRes.data || []).map((l: any) => [l.id, l]));
    const enrichedContacts = (contactsRes.data || []).map((c: any) => {
      if (c.lead_id && leadsMap.has(c.lead_id)) {
        const lead = leadsMap.get(c.lead_id);
        return {
          ...c,
          city: c.city || lead.city,
          state: c.state || lead.state,
          neighborhood: c.neighborhood || lead.neighborhood,
          _product_service_id: lead.product_service_id,
          _board_id: lead.board_id,
        };
      }
      return { ...c, _product_service_id: null, _board_id: null };
    });
    
    setContacts(enrichedContacts);
    setProducts((productsRes.data || []) as ProductService[]);
    setBoards((boardsRes.data || []) as BoardWithProduct[]);
    setLoading(false);
  };

  // Derive unique states and cities
  const uniqueStates = useMemo(() => {
    const states = new Set<string>();
    contacts.forEach(c => { if (c.state) states.add(c.state); });
    return Array.from(states).sort();
  }, [contacts]);

  const uniqueCities = useMemo(() => {
    const cities = new Set<string>();
    contacts.filter(c => filterState === '__all__' || c.state === filterState)
      .forEach(c => { if (c.city) cities.add(c.city); });
    return Array.from(cities).sort();
  }, [contacts, filterState]);

  // Map board product_service_id
  const boardProductMap = useMemo(() => {
    const map: Record<string, string> = {};
    boards.forEach(b => { if (b.product_service_id) map[b.id] = b.product_service_id; });
    return map;
  }, [boards]);

  const filteredContacts = useMemo(() => {
    return contacts.filter((c: any) => {
      // Search
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const match = c.full_name.toLowerCase().includes(q) ||
          (c.phone && c.phone.includes(q)) ||
          (c.city && c.city.toLowerCase().includes(q)) ||
          (c.neighborhood && c.neighborhood.toLowerCase().includes(q)) ||
          (c.profession && c.profession.toLowerCase().includes(q));
        if (!match) return false;
      }

      // State filter
      if (filterState !== '__all__' && c.state !== filterState) return false;

      // City filter
      if (filterCity !== '__all__' && c.city !== filterCity) return false;

      // Classification filter
      if (filterClassification !== '__all__') {
        if (filterClassification === 'client') {
          const isClient = c.classification === 'Cliente' || 
            (c.classifications && c.classifications.includes('Cliente'));
          if (!isClient) return false;
        } else if (filterClassification === 'prospect') {
          const isProspect = c.classification === 'Prospect' ||
            (c.classifications && c.classifications.includes('Prospect'));
          if (!isProspect) return false;
        }
      }

      // Product filter
      if (filterProduct !== '__all__') {
        const contactProduct = c._product_service_id || 
          (c._board_id && boardProductMap[c._board_id]);
        if (contactProduct !== filterProduct) return false;
      }

      return true;
    });
  }, [contacts, searchQuery, filterState, filterCity, filterClassification, filterProduct, boardProductMap]);

  const clientCount = filteredContacts.filter((c: any) => 
    c.classification === 'Cliente' || (c.classifications && c.classifications.includes('Cliente'))
  ).length;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 p-4 border-b bg-card shrink-0">
        <UserCheck className="h-6 w-6 text-primary" />
        <h1 className="text-lg font-semibold">Busca por Indicação</h1>
        <Badge variant="secondary" className="text-xs">{filteredContacts.length} contatos</Badge>
        {clientCount > 0 && (
          <Badge className="bg-emerald-100 text-emerald-700 text-xs">{clientCount} clientes</Badge>
        )}
      </div>

      {/* Filters */}
      <div className="p-4 border-b bg-muted/30 space-y-3 shrink-0">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, telefone, cidade, bairro, profissão..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Select value={filterState} onValueChange={(v) => { setFilterState(v); setFilterCity('__all__'); }}>
            <SelectTrigger className="h-9 text-xs">
              <MapPin className="h-3 w-3 mr-1" />
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos estados</SelectItem>
              {uniqueStates.map(s => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterCity} onValueChange={setFilterCity}>
            <SelectTrigger className="h-9 text-xs">
              <MapPin className="h-3 w-3 mr-1" />
              <SelectValue placeholder="Cidade" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todas cidades</SelectItem>
              {uniqueCities.map(c => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterProduct} onValueChange={setFilterProduct}>
            <SelectTrigger className="h-9 text-xs">
              <Package className="h-3 w-3 mr-1" />
              <SelectValue placeholder="Produto" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos produtos</SelectItem>
              {products.map(p => (
                <SelectItem key={p.id} value={p.id}>📦 {p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterClassification} onValueChange={setFilterClassification}>
            <SelectTrigger className="h-9 text-xs">
              <Users className="h-3 w-3 mr-1" />
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos</SelectItem>
              <SelectItem value="client">✅ Clientes</SelectItem>
              <SelectItem value="prospect">🔵 Prospects</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {(filterState !== '__all__' || filterCity !== '__all__' || filterProduct !== '__all__' || filterClassification !== '__all__') && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={() => { setFilterState('__all__'); setFilterCity('__all__'); setFilterProduct('__all__'); setFilterClassification('__all__'); }}
          >
            Limpar filtros
          </Button>
        )}
      </div>

      {/* Results */}
      <ScrollArea className="flex-1 p-4">
        {loading ? (
          <p className="text-center text-muted-foreground py-8">Carregando...</p>
        ) : filteredContacts.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">Nenhum contato encontrado com os filtros aplicados</p>
        ) : (
          <div className="grid gap-2">
            {filteredContacts.map((contact: any) => {
              const isClient = contact.classification === 'Cliente' || 
                (contact.classifications && contact.classifications.includes('Cliente'));
              const productId = contact._product_service_id || 
                (contact._board_id && boardProductMap[contact._board_id]);
              const product = productId ? products.find(p => p.id === productId) : null;

              return (
                <Card key={contact.id} className={`${isClient ? 'border-emerald-200 bg-emerald-50/30 dark:border-emerald-900 dark:bg-emerald-950/20' : ''}`}>
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-sm truncate">{contact.full_name}</p>
                          {isClient && (
                            <Badge className="bg-emerald-100 text-emerald-700 text-[10px] shrink-0">
                              Cliente
                            </Badge>
                          )}
                        </div>
                        
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-muted-foreground">
                          {contact.phone && (
                            <span className="flex items-center gap-1">
                              <Phone className="h-3 w-3" />{contact.phone}
                            </span>
                          )}
                          {contact.email && (
                            <span className="flex items-center gap-1">
                              <Mail className="h-3 w-3" />{contact.email}
                            </span>
                          )}
                          {(contact.city || contact.state) && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {[contact.neighborhood, contact.city, contact.state].filter(Boolean).join(', ')}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {contact.profession && (
                            <Badge variant="outline" className="text-[10px]">{contact.profession}</Badge>
                          )}
                          {product && (
                            <Badge variant="secondary" className="text-[10px]">
                              📦 {product.name}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
