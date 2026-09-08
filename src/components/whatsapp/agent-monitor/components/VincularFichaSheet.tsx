/**
 * Ligar um grupo de WhatsApp à ficha do cliente — a ponte que faltava.
 *
 * POR QUE EXISTE (08/09/2026). A aba "Sem ficha" passou a mostrar 156 grupos
 * que o assessor atende sem saber de quem são. Mostrar não conserta: a pessoa
 * lia o problema e não tinha o que clicar. Daqui sai a linha em
 * `lead_whatsapp_groups`, e é essa linha que faz a `dom_contexto_processual`
 * achar o cliente — e, com ele, o caso, os processos, as peças e a atividade.
 *
 * DOIS CAMINHOS, PORQUE SÃO DOIS PROBLEMAS DIFERENTES
 *   • AMBÍGUO — duas ou mais fichas apontam para o mesmo grupo. As candidatas
 *     já existem; o que falta é ALGUÉM DIZER QUAL. Elas vêm no topo, com o
 *     número de processos de cada uma, que costuma ser o que desempata.
 *   • SEM FICHA — nenhuma aponta. Aqui a candidata tem que ser procurada pelo
 *     nome, porque a ficha em geral existe e só não sabe do grupo.
 *
 * O QUE ESTE PAINEL NÃO É. Não é formulário de lead. Escolhida a ficha, quem
 * abre é o `LeadPainelPorId` — o `LeadEditDialog` de sempre — e é lá que se
 * chega ao caso e aos processos. Duplicar aquele formulário aqui criaria a
 * segunda versão da mesma coisa, que é justamente o que a regra de formulário
 * único proíbe.
 *
 * NÃO ADIVINHA. A lista de candidatas vem do cadastro (`whatsapp_group_id`) ou
 * da busca por nome que a pessoa digitou. Em nenhum momento o painel escolhe
 * sozinho — o vínculo errado conta a um cliente o processo de outro, e foi
 * exatamente por recusar esse palpite que 40 grupos ficaram ambíguos em vez de
 * receberem uma ficha sorteada.
 */
import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { invalidateGroupLeadCache } from '@/integrations/supabase/group-lead-links';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Link2, Search, Loader2, UserX, AlertTriangle } from 'lucide-react';

const dbAny = db as unknown as SupabaseClient;

/** Só os dígitos do jid, que é como a `dom_jid_curto` do banco compara. */
const jidCurto = (v: string) => String(v || '').split('@')[0];

export interface GrupoSemFicha {
  group_jid: string;
  group_name: string | null;
  situacao: 'ambiguo' | 'sem_ficha';
  fichas_no_cadastro: number;
}

/** O que a consulta a `leads` devolve aqui — só o necessário para escolher. */
interface LinhaLead {
  id: string;
  lead_name?: string | null;
  case_number?: string | null;
}

interface Candidata {
  id: string;
  lead_name: string | null;
  case_number: string | null;
  processos: number;
  /** true quando a ficha já aponta para este grupo no cadastro. */
  doCadastro: boolean;
}

export function VincularFichaSheet({
  grupo, onOpenChange, onVinculado,
}: {
  grupo: GrupoSemFicha | null;
  onOpenChange: (aberto: boolean) => void;
  onVinculado: (leadId: string) => void;
}) {
  const [candidatas, setCandidatas] = useState<Candidata[]>([]);
  const [busca, setBusca] = useState('');
  const [achadas, setAchadas] = useState<Candidata[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [ligando, setLigando] = useState<string | null>(null);

  /** Conta processos de cada ficha numa consulta só — N fichas, não N queries. */
  const comProcessos = useCallback(async (linhas: LinhaLead[], doCadastro: boolean): Promise<Candidata[]> => {
    const ids = linhas.map(l => l.id);
    const contagem = new Map<string, number>();
    if (ids.length) {
      const { data: procs } = await dbAny.from('lead_processes')
        .select('lead_id').in('lead_id', ids).is('deleted_at', null);
      for (const p of (procs as { lead_id: string }[]) || []) {
        contagem.set(p.lead_id, (contagem.get(p.lead_id) || 0) + 1);
      }
    }
    return linhas.map(l => ({
      id: l.id,
      lead_name: l.lead_name ?? null,
      case_number: l.case_number ?? null,
      processos: contagem.get(l.id) || 0,
      doCadastro,
    }));
  }, []);

  // As fichas que o CADASTRO já associa a este grupo. No caso ambíguo são elas
  // as candidatas; no sem-ficha vem vazio, e a busca abaixo é o caminho.
  useEffect(() => {
    if (!grupo) { setCandidatas([]); setBusca(''); setAchadas([]); return; }
    let vivo = true;
    (async () => {
      try {
        await ensureExternalSession();
        const curto = jidCurto(grupo.group_jid);
        const { data } = await dbAny.from('leads')
          .select('id, lead_name, case_number, whatsapp_group_id')
          .in('whatsapp_group_id', [curto, `${curto}@g.us`])
          .is('deleted_at', null);
        if (!vivo) return;
        setCandidatas(await comProcessos((data as LinhaLead[]) || [], true));
      } catch (e) {
        if (vivo) toast.error('Não consegui listar as fichas do grupo: ' + (e as Error).message);
      }
    })();
    return () => { vivo = false; };
  }, [grupo, comProcessos]);

  const procurar = useCallback(async (termo: string) => {
    const t = termo.trim();
    if (t.length < 3) { setAchadas([]); return; }
    setBuscando(true);
    try {
      await ensureExternalSession();
      const { data } = await dbAny.from('leads')
        .select('id, lead_name, case_number')
        .ilike('lead_name', `%${t}%`)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(20);
      setAchadas(await comProcessos((data as LinhaLead[]) || [], false));
    } catch (e) {
      toast.error('Falha na busca: ' + (e as Error).message);
      setAchadas([]);
    } finally {
      setBuscando(false);
    }
  }, [comProcessos]);

  // Digitar e esperar: 350ms sem tecla nova antes de ir ao banco.
  useEffect(() => {
    const t = setTimeout(() => { void procurar(busca); }, 350);
    return () => clearTimeout(t);
  }, [busca, procurar]);

  const ligar = async (c: Candidata) => {
    if (!grupo || ligando) return;
    setLigando(c.id);
    try {
      await ensureExternalSession();
      const curto = jidCurto(grupo.group_jid);
      // `auto_linked: false` — foi uma PESSOA que decidiu. A distinção importa:
      // os 166 vínculos de 08/09 entraram como automação e podem ser desfeitos
      // em bloco por isso; estes não devem cair junto.
      const { error } = await dbAny.from('lead_whatsapp_groups').insert({
        lead_id: c.id,
        group_jid: `${curto}@g.us`,
        group_name: grupo.group_name,
        auto_linked: false,
      });
      if (error) throw error;
      invalidateGroupLeadCache(curto);
      toast.success(`Grupo ligado a ${c.lead_name || 'a ficha'}.`);
      onVinculado(c.id);
    } catch (e) {
      toast.error('Não consegui ligar: ' + (e as Error).message);
    } finally {
      setLigando(null);
    }
  };

  const Ficha = ({ c }: { c: Candidata }) => (
    <Card>
      <CardContent className="p-3 flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate">{c.lead_name || 'ficha sem nome'}</p>
          <p className="text-[10px] text-muted-foreground">
            {c.case_number ? `caso ${c.case_number} · ` : ''}
            {c.processos === 1 ? '1 processo' : `${c.processos} processos`}
            {c.processos === 0 && ' — nenhum processo cadastrado'}
          </p>
        </div>
        <Button size="sm" className="h-7 text-xs gap-1 shrink-0"
                disabled={!!ligando} onClick={() => ligar(c)}>
          {ligando === c.id
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <Link2 className="h-3 w-3" />}
          É esta
        </Button>
      </CardContent>
    </Card>
  );

  return (
    <Sheet open={!!grupo} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-sm flex items-center gap-2">
            <UserX className="h-4 w-4 shrink-0" />
            <span className="truncate">{grupo?.group_name || 'Grupo'}</span>
          </SheetTitle>
        </SheetHeader>

        {grupo && (
          <div className="space-y-4 pt-3">
            <p className="text-[11px] text-muted-foreground">
              Escolher a ficha liga este grupo ao cliente. A partir daí o assessor passa a
              ver o caso, os processos, as peças e a atividade da equipe — e o painel de
              fontes para de mostrar "(0)".
            </p>

            {grupo.situacao === 'ambiguo' && (
              <div className="space-y-2">
                <Label className="text-xs flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                  {grupo.fichas_no_cadastro} fichas apontam para este grupo
                </Label>
                <p className="text-[10px] text-muted-foreground">
                  O sistema não escolhe entre elas — seria sortear de quem é o processo.
                  Quem tem processo cadastrado costuma ser a certa, mas confira na conversa.
                </p>
                {candidatas.map(c => <Ficha key={c.id} c={c} />)}
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-xs">
                {grupo.situacao === 'ambiguo' ? 'Ou procurar outra ficha' : 'Procurar a ficha do cliente'}
              </Label>
              {grupo.situacao === 'sem_ficha' && (
                <p className="text-[10px] text-muted-foreground">
                  Nenhuma ficha aponta para este grupo — mas ela quase sempre existe e só
                  não sabe do grupo. Procure pelo nome do cliente ou pelo número do caso.
                </p>
              )}
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={busca}
                  onChange={e => setBusca(e.target.value)}
                  placeholder="nome do cliente (3 letras ou mais)"
                  className="h-8 pl-7 text-xs"
                />
              </div>
              {buscando && (
                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />procurando…
                </p>
              )}
              {!buscando && busca.trim().length >= 3 && achadas.length === 0 && (
                <p className="text-[11px] text-muted-foreground italic">
                  Nenhuma ficha com esse nome. Se o cliente ainda não tem ficha, cadastre
                  primeiro — daqui só dá para ligar a uma que já existe.
                </p>
              )}
              {achadas.map(c => <Ficha key={c.id} c={c} />)}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
