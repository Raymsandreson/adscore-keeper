/**
 * Filtro "Relacionamento Conosco" da lista de contatos — combinação, não um só.
 *
 * O contato já podia carregar vários relacionamentos ao mesmo tempo
 * (`contacts.classifications text[]`, ver a ficha em MultiClassificationSelect),
 * mas o filtro da lista era um `<Select>` de escolha única: dava para pedir
 * "parceiro" e não "parceiro que também é cliente".
 *
 * Dois modos, porque as duas perguntas existem:
 *  - QUALQUER (padrão): união — "quem é parceiro OU ponte".
 *  - TODOS: interseção — "parceiro que TAMBÉM é cliente".
 *
 * "Sem classificação" é exclusivo: combinar ausência com presença não responde
 * pergunta nenhuma, então marcar limpa o resto (e vice-versa).
 *
 * As opções vêm de `contact_classification_values()`, que lê o que está gravado
 * nos contatos — não a lista de status cadastrados. Motivo: a base divergiu do
 * cadastro. O filtro antigo oferecia "Cliente" apontando para o slug `client`,
 * que não existe em contato nenhum (são 1.658 em `cliente`) — marcava e via
 * zero; e `lead` (309 contatos) nem aparecia. Cada opção mostra a contagem para
 * a divergência ficar visível em vez de virar lista vazia.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tag, ChevronDown, X, Loader2 } from 'lucide-react';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { classificationLabel } from '@/hooks/useContactClassifications';
import { cn } from '@/lib/utils';

/** Valor especial: contatos sem nenhum relacionamento. */
export const NO_CLASSIFICATION = 'none';

export type ClassificationFilterMode = 'any' | 'all';

interface Props {
  /** Vazio = todos os relacionamentos. */
  value: string[];
  onChange: (next: string[]) => void;
  mode: ClassificationFilterMode;
  onModeChange: (mode: ClassificationFilterMode) => void;
  /** Da tabela `contact_classifications` — entra só pela cor e pela ordem. */
  options: { name: string; color?: string }[];
  className?: string;
}

export const ClassificationFilterSelect: React.FC<Props> = ({
  value, onChange, mode, onModeChange, options, className,
}) => {
  const [open, setOpen] = useState(false);
  const [inUse, setInUse] = useState<{ name: string; contacts: number }[] | null>(null);
  const [loading, setLoading] = useState(false);

  // Só ao abrir: a contagem varre os contatos e ninguém precisa dela fechada.
  useEffect(() => {
    if (!open || inUse !== null) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        await ensureExternalSession();
        const { data, error } = await (db as any).rpc('contact_classification_values');
        if (error) throw error;
        if (!cancelled) {
          setInUse(((data || []) as any[]).map(r => ({ name: r.name, contacts: Number(r.contacts) || 0 })));
        }
      } catch (e) {
        console.warn('[ClassificationFilterSelect] falha ao listar relacionamentos em uso', e);
        if (!cancelled) setInUse([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, inUse]);

  const colorOf = useMemo(() => {
    const map: Record<string, string | undefined> = {};
    options.forEach(o => { map[o.name] = o.color; });
    return map;
  }, [options]);

  /** Em uso primeiro (com contagem); status cadastrado e ainda zerado, no fim. */
  const list = useMemo(() => {
    const rows = new Map<string, { name: string; contacts: number | null }>();
    (inUse || []).forEach(r => rows.set(r.name, { name: r.name, contacts: r.contacts }));
    options.forEach(o => { if (!rows.has(o.name)) rows.set(o.name, { name: o.name, contacts: inUse ? 0 : null }); });
    // Marcado que não aparece em lugar nenhum continua visível — senão o filtro
    // fica ativo sem jeito de desmarcar.
    value.forEach(n => { if (n !== NO_CLASSIFICATION && !rows.has(n)) rows.set(n, { name: n, contacts: inUse ? 0 : null }); });
    return Array.from(rows.values()).sort((a, b) => (b.contacts ?? 0) - (a.contacts ?? 0));
  }, [inUse, options, value]);

  const toggle = (name: string) => {
    if (name === NO_CLASSIFICATION) {
      onChange(value.includes(NO_CLASSIFICATION) ? [] : [NO_CLASSIFICATION]);
      return;
    }
    const withoutNone = value.filter(v => v !== NO_CLASSIFICATION);
    onChange(
      withoutNone.includes(name)
        ? withoutNone.filter(v => v !== name)
        : [...withoutNone, name]
    );
  };

  const isNone = value.includes(NO_CLASSIFICATION);
  const label = value.length === 0
    ? 'Todos Relacionamentos'
    : isNone
      ? 'Sem classificação'
      : value.length === 1
        ? classificationLabel(value[0])
        : `${classificationLabel(value[0])} +${value.length - 1}`;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn('h-8 w-[190px] justify-start gap-1 px-2 text-xs font-normal', className)}
          title="Relacionamento Conosco"
        >
          <Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{label}</span>
          {value.length > 1 && !isNone && (
            <Badge variant="secondary" className="ml-auto h-4 shrink-0 px-1 text-[10px]">
              {mode === 'all' ? 'e' : 'ou'}
            </Badge>
          )}
          <ChevronDown className={cn('h-3 w-3 shrink-0 text-muted-foreground', value.length > 1 && !isNone ? 'ml-1' : 'ml-auto')} />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-[20rem]">
        <DropdownMenuLabel className="flex items-center justify-between gap-2">
          <span>Relacionamento Conosco</span>
          {value.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="inline-flex items-center gap-1 text-[11px] font-normal text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" /> limpar
            </button>
          )}
        </DropdownMenuLabel>

        {/* O modo só muda o resultado com 2+ marcados; some antes disso para
            não virar decisão sem consequência. */}
        {value.length > 1 && !isNone && (
          <div className="px-2 pb-2">
            <div className="flex items-center gap-0.5 rounded-md bg-muted/60 p-0.5">
              {([
                { key: 'any', label: 'Qualquer um', hint: 'Contato com pelo menos um dos marcados' },
                { key: 'all', label: 'Todos juntos', hint: 'Só quem tem todos os marcados ao mesmo tempo' },
              ] as const).map(opt => (
                <button
                  key={opt.key}
                  type="button"
                  title={opt.hint}
                  onClick={() => onModeChange(opt.key)}
                  className={cn(
                    'flex-1 rounded px-2 py-1 text-[11px] transition-colors',
                    mode === opt.key ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <DropdownMenuSeparator />

        <div className="max-h-[300px] space-y-0.5 overflow-y-auto p-1">
          {loading && (
            <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> carregando…
            </div>
          )}

          {list.map(opt => {
            const checked = value.includes(opt.name);
            const empty = opt.contacts === 0;
            return (
              <button
                key={opt.name}
                type="button"
                onClick={() => toggle(opt.name)}
                title={empty ? 'Nenhum contato com esse relacionamento' : undefined}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                <Checkbox checked={checked} className="pointer-events-none h-3.5 w-3.5 shrink-0" />
                <span className={cn('h-2 w-2 shrink-0 rounded-full', colorOf[opt.name] || 'bg-slate-400')} />
                <span className={cn('truncate', empty && 'text-muted-foreground')}>
                  {classificationLabel(opt.name)}
                </span>
                {opt.contacts !== null && (
                  <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {opt.contacts}
                  </span>
                )}
              </button>
            );
          })}

          <DropdownMenuSeparator />

          <button
            type="button"
            onClick={() => toggle(NO_CLASSIFICATION)}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
          >
            <Checkbox checked={isNone} className="pointer-events-none h-3.5 w-3.5 shrink-0" />
            <span className="h-2 w-2 shrink-0 rounded-full border border-dashed border-muted-foreground" />
            <span className="truncate text-muted-foreground">Sem classificação</span>
          </button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
