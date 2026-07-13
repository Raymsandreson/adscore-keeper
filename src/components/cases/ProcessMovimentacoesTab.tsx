import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { db } from '@/integrations/supabase';
import { CATEGORIAS } from '@/lib/processUpdateCategorias';
import type { UpdateCategoria } from '@/hooks/useProcessUpdates';

interface MovItem {
  key: string;
  escavadorId: string | null;
  data: string | null;
  tipoRaw: string;
  isExpediente: boolean;
  conteudo: string;
}

type Filtro = 'todas' | 'expedientes' | 'andamentos';

const MAX_ITENS = 200;

function normalizeMovs(movimentacoes: unknown[] | null | undefined): MovItem[] {
  if (!Array.isArray(movimentacoes)) return [];
  const items: MovItem[] = [];
  movimentacoes.forEach((raw, i) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = raw as any;
    const conteudo = (m?.conteudo || m?.titulo || m?.descricao || '').toString().replace(/\s+/g, ' ').trim();
    const data = (m?.data || m?.data_hora || '').toString().slice(0, 10) || null;
    if (!conteudo && !data) return;
    const tipoRaw = (m?.tipo || '').toString().toUpperCase();
    items.push({
      key: m?.id != null ? String(m.id) : `idx-${i}`,
      escavadorId: m?.id != null ? String(m.id) : null,
      data,
      tipoRaw,
      // No Escavador/PJe, PUBLICACAO é expediente destinado às partes;
      // ANDAMENTO (e demais) são movimentações internas do processo.
      isExpediente: tipoRaw.includes('PUBLICACAO'),
      conteudo,
    });
  });
  items.sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  return items.slice(0, MAX_ITENS);
}

function fmtData(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

/**
 * Aba "Movimentações" do processo: lista completa de movimentações e
 * expedientes (publicações/intimações), com a categoria do feed do sino
 * quando a movimentação já foi classificada (process_updates).
 */
export function ProcessMovimentacoesTab({
  processId,
  movimentacoes,
}: {
  processId: string;
  movimentacoes: unknown[] | null | undefined;
}) {
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [categoriaById, setCategoriaById] = useState<Record<string, UpdateCategoria>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const itens = useMemo(() => normalizeMovs(movimentacoes), [movimentacoes]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // process_updates ainda não está no types.ts gerado.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const client = db as any;
        const { data } = await client
          .from('process_updates')
          .select('escavador_movimentacao_id, categoria')
          .eq('process_id', processId)
          .not('escavador_movimentacao_id', 'is', null);
        if (cancelled) return;
        const map: Record<string, UpdateCategoria> = {};
        for (const r of (data || []) as Array<{ escavador_movimentacao_id: string; categoria: UpdateCategoria }>) {
          map[r.escavador_movimentacao_id] = r.categoria;
        }
        setCategoriaById(map);
      } catch (err) {
        console.error('Error fetching update categories:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [processId]);

  const counts = useMemo(() => ({
    todas: itens.length,
    expedientes: itens.filter((i) => i.isExpediente).length,
    andamentos: itens.filter((i) => !i.isExpediente).length,
  }), [itens]);

  const visiveis = useMemo(() => {
    if (filtro === 'expedientes') return itens.filter((i) => i.isExpediente);
    if (filtro === 'andamentos') return itens.filter((i) => !i.isExpediente);
    return itens;
  }, [itens, filtro]);

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (!itens.length) {
    return (
      <p className="text-xs text-muted-foreground text-center py-8">
        Nenhuma movimentação salva pra este processo. Use "Buscar no Escavador" pra sincronizar.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-1 flex-wrap">
        {([
          { value: 'todas', label: 'Todas' },
          { value: 'expedientes', label: 'Expedientes' },
          { value: 'andamentos', label: 'Andamentos' },
        ] as Array<{ value: Filtro; label: string }>).map((f) => (
          <button
            key={f.value}
            onClick={() => setFiltro(f.value)}
            className={cn(
              'text-[11px] px-2 py-1 rounded-full border whitespace-nowrap transition-colors',
              filtro === f.value ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-accent',
            )}
          >
            {f.label} ({counts[f.value]})
          </button>
        ))}
      </div>

      <div className="space-y-1.5">
        {visiveis.map((item) => {
          const categoria = item.escavadorId ? categoriaById[item.escavadorId] : undefined;
          const style = categoria ? CATEGORIAS[categoria] : null;
          const Icon = style?.icon;
          const isOpen = expanded.has(item.key);
          return (
            <div
              key={item.key}
              className={cn(
                'border rounded-lg p-2.5 cursor-pointer hover:bg-muted/40 transition-colors',
                style?.borda && 'border-l-2',
                style?.borda,
              )}
              onClick={() => toggleExpand(item.key)}
            >
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-medium text-muted-foreground">{fmtData(item.data)}</span>
                <Badge variant="outline" className="text-[9px] px-1.5 py-0">
                  {item.isExpediente ? 'Expediente' : 'Andamento'}
                </Badge>
                {style && Icon && (
                  <Badge variant="outline" className={cn('text-[9px] px-1.5 py-0 gap-1', style.badge)}>
                    <Icon className="h-2.5 w-2.5" />
                    {style.label}
                  </Badge>
                )}
              </div>
              <p className={cn('text-[11px] mt-1 text-muted-foreground whitespace-pre-wrap', !isOpen && 'line-clamp-3')}>
                {item.conteudo || '(sem conteúdo)'}
              </p>
            </div>
          );
        })}
      </div>

      {itens.length >= MAX_ITENS && (
        <p className="text-[10px] text-muted-foreground text-center">
          Mostrando as {MAX_ITENS} movimentações mais recentes.
        </p>
      )}
    </div>
  );
}
