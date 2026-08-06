/**
 * Contatos da vara/tribunal deste processo, dentro da tela do processo.
 *
 * O operador não precisa saber "em que vara está o processo do fulano": o
 * número CNJ já diz o tribunal e a unidade de origem, e o contato aparece aqui.
 * Quando ele confirma que um contato atende aquela origem, o código fica
 * gravado em `court_contacts.origin_codes` — daí em diante o casamento é exato
 * e vale para todos os processos daquela unidade.
 */

import { useCallback, useEffect, useState } from 'react';
import { db } from '@/integrations/supabase';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Landmark, Loader2, Link2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { parseCnj, originScopeLabel } from '@/lib/cnj';
import { branchLabel, degreeLabel, contactTypeLabel } from '@/lib/courtCatalog';
import { CourtContactChannels, type CourtContact } from '@/components/activities/CourtContactsSheet';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const courtContactsTable = () => (db as any).from('court_contacts');

interface Props {
  processNumber: string | null | undefined;
}

export function CourtContactsForProcess({ processNumber }: Props) {
  const info = parseCnj(processNumber);
  const [contacts, setContacts] = useState<CourtContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);

  const courtCode = info?.courtCode || null;

  const load = useCallback(async () => {
    if (!courtCode) { setContacts([]); return; }
    setLoading(true);
    try {
      const { data, error } = await courtContactsTable()
        .select('*')
        .eq('court_code', courtCode)
        .is('deleted_at', null)
        .order('name');
      if (error) throw error;
      setContacts((data || []) as CourtContact[]);
    } catch (e) {
      console.error('[CourtContactsForProcess] load falhou', e);
    } finally {
      setLoading(false);
    }
  }, [courtCode]);

  useEffect(() => { load(); }, [load]);

  if (!info) {
    return (
      <p className="text-[11px] text-muted-foreground">
        Contatos da vara aparecem quando o processo tem número CNJ completo.
      </p>
    );
  }

  const matches = (c: CourtContact) =>
    Boolean(info.originCode && c.origin_codes?.includes(info.originCode));

  const linkOrigin = async (c: CourtContact) => {
    setLinkingId(c.id);
    try {
      const next = [...new Set([...(c.origin_codes || []), info.originCode])];
      const { error } = await courtContactsTable()
        .update({ origin_codes: next, updated_at: new Date().toISOString() })
        .eq('id', c.id);
      if (error) throw error;
      toast.success(`Contato marcado como atendendo a origem ${info.originCode}.`);
      await load();
    } catch (e) {
      console.error('[CourtContactsForProcess] vincular origem falhou', e);
      toast.error('Não foi possível vincular a unidade.');
    } finally {
      setLinkingId(null);
    }
  };

  // Quem já atende esta origem sobe; o resto do tribunal fica logo abaixo.
  const sorted = [...contacts].sort(
    (a, b) => Number(matches(b)) - Number(matches(a)) || a.name.localeCompare(b.name, 'pt-BR'),
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Landmark className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-semibold">Contatos da vara</span>
        <Badge variant="secondary" className="text-[10px]">{info.courtCode}</Badge>
        <span className="text-[10px] text-muted-foreground">origem {info.originCode}</span>
        {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>

      {!loading && sorted.length === 0 && (
        <p className="text-[11px] text-muted-foreground">
          Nenhum contato cadastrado para o {info.courtCode}. Cadastre em Atividades → Varas e Tribunais.
        </p>
      )}

      {sorted.map((c) => {
        const exact = matches(c);
        return (
          <div
            key={c.id}
            className={cn(
              'rounded-md border p-2',
              exact ? 'border-primary/50 bg-primary/5' : 'bg-card',
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-medium leading-tight">{c.unit_name || c.name}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                  <Badge variant="outline" className="text-[10px]">
                    {contactTypeLabel(c.contact_type) || 'Contato'}
                  </Badge>
                  {c.degree && <span>{degreeLabel(c.degree, true)}</span>}
                  {c.branch && <span>{branchLabel(c.branch, true)}</span>}
                  {(c.comarca || c.uf) && <span>{[c.comarca, c.uf].filter(Boolean).join('/')}</span>}
                </div>
              </div>
              {exact ? (
                <span className="flex shrink-0 items-center gap-1 text-[10px] text-primary">
                  <Check className="h-3 w-3" /> {originScopeLabel(c.branch as never)}
                </span>
              ) : (
                <Button
                  variant="ghost" size="sm" className="h-6 shrink-0 gap-1 px-1.5 text-[10px]"
                  title={`Marcar que este contato atende a origem ${info.originCode}`}
                  disabled={linkingId === c.id}
                  onClick={() => linkOrigin(c)}
                >
                  {linkingId === c.id
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <Link2 className="h-3 w-3" />}
                  é esta
                </Button>
              )}
            </div>
            <div className="mt-1.5">
              <CourtContactChannels contact={c} />
            </div>
            {c.notes && <p className="mt-1 text-[10px] text-muted-foreground">{c.notes}</p>}
          </div>
        );
      })}
    </div>
  );
}
