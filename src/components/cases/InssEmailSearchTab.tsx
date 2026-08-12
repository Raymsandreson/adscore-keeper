/**
 * Aba "Buscar no E-mail" do Cadastrar Processo.
 *
 * O que faz, em 1 frase: procura o requerimento do cliente entre os e-mails do
 * INSS que o robô já leu (`gmail-inss-sync` → `inss_admin_processes`) e cadastra
 * o processo direto no caso.
 *
 * Por que buscar no banco e não no Gmail ao vivo: os e-mails já chegam parseados
 * (requerimento, NB, status, despacho, segurado). Consultar o Gmail na hora
 * gastaria cota do gateway e devolveria texto cru. O botão "procurar no Gmail
 * agora" existe só pro caso do e-mail ter chegado depois da última rodada.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Search, Loader2, AlertCircle, CheckCircle2, Mail, RefreshCw, Link2,
} from 'lucide-react';
import { db, ensureExternalSession, authClient } from '@/integrations/supabase';
import { remapToExternal } from '@/integrations/supabase/uuid-remap';
import { toast } from 'sonner';
import {
  upsertInssLeadProcess, inssProcessTitle, type InssProcessRow,
} from '@/lib/inssLeadProcess';
import { resolveAssignmentForCase, createOrAttachAndamentoActivity } from '@/lib/processAssignment';
import { cloudFunctions } from '@/lib/functionRouter';

interface Props {
  caseId: string;
  /** Null em caso órfão (lead purgado): a busca cai só no contexto do caso. */
  leadId: string | null;
  /** POP e responsável escolhidos no topo do modal. */
  workflowId: string;
  workflowName: string | null;
  responsibleExtId: string | null;
  onProcessAdded: () => void;
  onDone: () => void;
}

interface ResultRow extends InssProcessRow {
  /** Nome do lead ao qual o requerimento já está preso, quando for outro. */
  linked_lead_name?: string | null;
  linked_case_number?: string | null;
  /** Quantos tokens do cliente bateram no nome do segurado. */
  score: number;
}

const STOPWORDS = new Set([
  'DA', 'DE', 'DO', 'DAS', 'DOS', 'E', 'DI', 'DU', 'JR', 'JUNIOR', 'NETO', 'FILHO', 'FILHA',
  // Lixo comum nos títulos de lead/caso deste escritório.
  'PREV', 'CASO', 'BPC', 'LOAS', 'INSS', 'AUTISMO', 'PROCESSO', 'CLIENTE',
]);

// Range dos diacríticos combinantes (NFD). Montado via RegExp pra manter o
// arquivo em ASCII puro — caractere combinante solto é invisível no editor.
const COMBINING = new RegExp('[\\u0300-\\u036f]', 'g');

const normalize = (s: string): string =>
  String(s || '')
    .normalize('NFD').replace(COMBINING, '')
    .toUpperCase().replace(/[^A-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

/** Tokens de nome que valem busca: ≥3 letras, sem stopword, sem número. */
const nameTokens = (s: string): string[] =>
  normalize(s).split(' ').filter((t) => t.length >= 3 && !/\d/.test(t) && !STOPWORDS.has(t));

const fmtDate = (s?: string | null): string | null => {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('pt-BR');
};

const statusCls = (s?: string | null): string => {
  const v = (s || '').toLowerCase();
  if (v.includes('exig')) return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300';
  if (v.includes('cancel')) return 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
  if (v.includes('conclu')) return 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300';
  if (v.includes('protocol')) return 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300';
  return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
};

const SELECT_COLS =
  'id, requerimento_number, current_status, benefit_type, benefit_number, cpf_segurado, ' +
  'nome_segurado, protocol_date, last_email_at, last_email_subject, servico, despacho, ' +
  'resultado, created_at, lead_id, case_id';

export default function InssEmailSearchTab({
  caseId, leadId, workflowId, workflowName, responsibleExtId, onProcessAdded, onDone,
}: Props) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [autoTerms, setAutoTerms] = useState<string[]>([]);
  /** Nome civil vindo da procuração — mostrado pra deixar claro de onde veio a busca. */
  const [procName, setProcName] = useState<string | null>(null);
  const didAutoSearch = useRef(false);

  /**
   * Pistas do cliente, da mais confiável pra menos:
   *
   *  1. **Procuração (ZapSign)** — `outorgante_name`/`outorgante_cpf` saem do PDF
   *     assinado. É o nome civil completo, o mesmo que o INSS usa nos e-mails.
   *     Achamos a procuração pelo `lead_id` e, quando ela está órfã, pelo
   *     telefone do lead/contato (comparando os últimos 8 dígitos, porque o
   *     nono dígito aparece num cadastro e some no outro).
   *  2. Contatos do lead (`lead_id` e `contact_leads`) — nome civil parcial.
   *  3. Título do caso / nome do lead — costumam vir com apelido e lixo
   *     ("✅PREV 542 | Cícero/Milla").
   *
   * `victim_name` entra só como último recurso: o campo é de acidente de
   * trabalho e em previdenciário não existe vítima. Ele só tem nome de cliente
   * porque o trigger `copy_zapsign_data_to_lead` despeja a procuração ali.
   */
  const loadClientTerms = useCallback(async (): Promise<{
    tokens: string[]; cpfs: string[]; procuracaoName: string | null;
  }> => {
    const names: string[] = [];
    const cpfs: string[] = [];
    const phones: string[] = [];
    let procuracaoName: string | null = null;
    /** Últimos 8 dígitos: o que sobra igual com ou sem nono dígito e com/sem DDI. */
    const phoneTail = (p?: string | null): string | null => {
      const d = String(p || '').replace(/\D/g, '');
      // <10 dígitos não é telefone; >15 é jid de grupo do WhatsApp.
      if (d.length < 10 || d.length > 15) return null;
      return d.slice(-8);
    };
    try {
      // Caso órfão não tem lead: as quatro queries por lead_id sairiam como
      // `eq.null` e derrubariam o Promise.all inteiro, levando junto o caso.
      const semLead = Promise.resolve({ data: null });
      const [caseRes, leadRes, contactsRes, linksRes, procRes] = await Promise.all([
        db.from('legal_cases' as any).select('title, client_name').eq('id', caseId).maybeSingle(),
        leadId ? db.from('leads' as any).select('lead_name, victim_name, cpf, lead_phone, lead_phone_raw').eq('id', leadId).maybeSingle() : semLead,
        leadId ? db.from('contacts' as any).select('full_name, cpf, phone').eq('lead_id', leadId).limit(20) : semLead,
        leadId ? db.from('contact_leads' as any).select('contact_id').eq('lead_id', leadId).limit(20) : semLead,
        leadId ? db.from('zapsign_documents' as any)
          .select('outorgante_name, outorgante_cpf, signer_name, document_name')
          .eq('lead_id', leadId).limit(10) : semLead,
      ]);
      const c = (caseRes.data || {}) as any;
      const l = (leadRes.data || {}) as any;
      names.push(c.client_name, c.title, l.victim_name, l.lead_name);
      if (l.cpf) cpfs.push(String(l.cpf).replace(/\D/g, ''));
      for (const p of [l.lead_phone, l.lead_phone_raw]) {
        const t = phoneTail(p);
        if (t) phones.push(t);
      }
      const pushContact = (ct: any) => {
        names.push(ct.full_name);
        if (ct.cpf) cpfs.push(String(ct.cpf).replace(/\D/g, ''));
        const t = phoneTail(ct.phone);
        if (t) phones.push(t);
      };
      for (const ct of ((contactsRes.data || []) as any[])) pushContact(ct);
      const contactIds = ((linksRes.data || []) as any[]).map((r) => r.contact_id).filter(Boolean);
      if (contactIds.length) {
        const { data: more } = await db
          .from('contacts' as any).select('full_name, cpf, phone').in('id', contactIds);
        for (const ct of ((more || []) as any[])) pushContact(ct);
      }

      const pushProcuracao = (docs: any[]) => {
        for (const d of docs) {
          const nome = String(d.outorgante_name || d.signer_name || '').trim();
          if (nome) {
            names.push(nome);
            if (!procuracaoName) procuracaoName = nome;
          }
          if (d.outorgante_cpf) cpfs.push(String(d.outorgante_cpf).replace(/\D/g, ''));
        }
      };
      pushProcuracao((procRes.data || []) as any[]);

      // Procuração órfã (lead_id nulo — a maioria delas): acha pelo telefone de
      // quem assinou. Sem isso o nome civil fica invisível pro caso.
      if (!procuracaoName && phones.length) {
        const uniqPhones = Array.from(new Set(phones)).slice(0, 6);
        const { data: byPhone } = await db
          .from('zapsign_documents' as any)
          .select('outorgante_name, outorgante_cpf, signer_name, signer_phone')
          .or(uniqPhones.map((t) => `signer_phone.ilike.%${t}`).join(','))
          .limit(10);
        pushProcuracao((byPhone || []) as any[]);
      }
    } catch (e) {
      console.warn('[InssEmailSearchTab] falha ao carregar pistas do cliente:', e);
    }
    const tokens = Array.from(new Set(names.filter(Boolean).flatMap((n) => nameTokens(String(n)))));
    return {
      tokens,
      cpfs: Array.from(new Set(cpfs.filter((c) => c.length === 11))),
      procuracaoName,
    };
  }, [caseId, leadId]);

  /** Enriquece com o nome do lead/caso onde o requerimento já está preso. */
  const decorateLinks = useCallback(async (rows: InssProcessRow[]): Promise<ResultRow[]> => {
    const leadIds = Array.from(new Set(rows.map((r) => r.lead_id).filter(Boolean))) as string[];
    const caseIds = Array.from(new Set(rows.map((r) => r.case_id).filter(Boolean))) as string[];
    const leadName: Record<string, string> = {};
    const caseNum: Record<string, string> = {};
    if (leadIds.length) {
      const { data } = await db.from('leads' as any).select('id, lead_name').in('id', leadIds);
      for (const l of ((data || []) as any[])) leadName[l.id] = l.lead_name || '(sem nome)';
    }
    if (caseIds.length) {
      const { data } = await db.from('legal_cases' as any).select('id, case_number').in('id', caseIds);
      for (const c of ((data || []) as any[])) caseNum[c.id] = c.case_number || '';
    }
    return rows.map((r) => ({
      ...r,
      score: 0,
      linked_lead_name: r.lead_id ? (leadName[r.lead_id] ?? null) : null,
      linked_case_number: r.case_id ? (caseNum[r.case_id] ?? null) : null,
    }));
  }, []);

  const runSearch = useCallback(async (opts: { tokens?: string[]; cpfs?: string[]; raw?: string }) => {
    setSearching(true);
    setError('');
    setSelected(new Set());
    try {
      await ensureExternalSession();
      const found = new Map<string, InssProcessRow>();
      const scoreOf = new Map<string, number>();

      const collect = async (filter: (q: any) => any) => {
        const { data, error: qErr } = await filter(
          db.from('inss_admin_processes' as any).select(SELECT_COLS).is('deleted_at', null),
        ).limit(40);
        if (qErr) throw qErr;
        for (const row of ((data || []) as any[])) if (!found.has(row.id)) found.set(row.id, row);
      };

      const raw = (opts.raw || '').trim();
      if (raw) {
        const digits = raw.replace(/\D/g, '');
        // Nº de requerimento / NB / CPF digitado à mão
        if (digits.length >= 6) {
          await collect((q) => q.or(
            `requerimento_number.ilike.%${digits}%,benefit_number.ilike.%${digits}%,cpf_segurado.eq.${digits}`,
          ));
        }
        const toks = nameTokens(raw);
        if (toks.length) {
          await collect((q) => q.or(toks.map((t) => `nome_segurado.ilike.%${t}%`).join(',')));
        }
        if (!digits && !toks.length) {
          await collect((q) => q.ilike('nome_segurado', `%${raw}%`));
        }
      }

      for (const cpf of (opts.cpfs || [])) {
        await collect((q) => q.eq('cpf_segurado', cpf));
      }
      const tokens = opts.tokens || [];
      if (tokens.length) {
        await collect((q) => q.or(tokens.map((t) => `nome_segurado.ilike.%${t}%`).join(',')));
      }

      // Score = quantos tokens do cliente aparecem no nome do segurado, com bônus
      // quando o token é o PRIMEIRO nome. Sem o bônus, "Cícero" empata entre
      // "CICERO GOMES DA SILVA FILHO" e "FRANCISCO CICERO DE SOUSA" — e o
      // homônimo com e-mail mais recente subiria na frente do cliente certo.
      const refTokens = Array.from(new Set([...tokens, ...nameTokens(raw)]));
      for (const [id, row] of found) {
        const n = normalize(row.nome_segurado || '');
        const first = n.split(' ')[0] || '';
        const hits = refTokens.filter((t) => n.includes(t));
        scoreOf.set(id, hits.length + (hits.some((t) => t === first) ? 2 : 0));
      }

      const decorated = await decorateLinks(Array.from(found.values()));
      decorated.forEach((r) => { r.score = scoreOf.get(r.id) || 0; });
      decorated.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        // Sem caso primeiro (é o que normalmente se quer cadastrar), depois recentes.
        if (!!a.case_id !== !!b.case_id) return a.case_id ? 1 : -1;
        return String(b.last_email_at || '').localeCompare(String(a.last_email_at || ''));
      });

      setResults(decorated);
      if (decorated.length === 0) {
        setError('Nenhum requerimento do INSS encontrado nos e-mails já lidos.');
      }
    } catch (e: any) {
      console.error('[InssEmailSearchTab] busca falhou:', e);
      setError(e?.message || 'Erro ao buscar nos e-mails');
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [decorateLinks]);

  // Busca automática ao abrir a aba, usando o nome/CPF do cliente do caso.
  useEffect(() => {
    if (didAutoSearch.current) return;
    didAutoSearch.current = true;
    (async () => {
      const { tokens, cpfs, procuracaoName } = await loadClientTerms();
      setAutoTerms(tokens);
      setProcName(procuracaoName);
      if (tokens.length === 0 && cpfs.length === 0) {
        setError('Sem nome, CPF ou procuração no cadastro do cliente — digite o nome ou o nº do requerimento.');
        return;
      }
      await runSearch({ tokens, cpfs });
    })();
  }, [loadClientTerms, runSearch]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  /** Roda o sync do Gmail sob demanda e repete a busca. */
  const syncNow = async () => {
    setSyncing(true);
    try {
      const { data: j, error } = await cloudFunctions.invoke<any>('gmail-inss-sync', {
        body: { lookback_days: 30 },
      });
      if (error) throw error;
      if (!j?.success) {
        toast.error('Sync do Gmail falhou: ' + (j.error || 'desconhecido'));
      } else {
        toast.success(`Gmail lido: ${j.checked || 0} e-mail(s), ${j.created_processes || 0} novo(s)`);
      }
      const { tokens, cpfs, procuracaoName } = await loadClientTerms();
      setProcName(procuracaoName);
      await runSearch({ tokens, cpfs, raw: query });
    } catch (e: any) {
      toast.error('Falha ao chamar o sync: ' + (e?.message || 'erro'));
    } finally {
      setSyncing(false);
    }
  };

  const selectedRows = useMemo(
    () => results.filter((r) => selected.has(r.id)),
    [results, selected],
  );
  /** Selecionados que estão presos em OUTRO caso — exigem confirmação de mudança. */
  const movingRows = useMemo(
    () => selectedRows.filter((r) => (r.case_id && r.case_id !== caseId) || (r.lead_id && r.lead_id !== leadId)),
    [selectedRows, caseId, leadId],
  );

  const save = async () => {
    if (selectedRows.length === 0) return;
    if (movingRows.length > 0) {
      const lines = movingRows
        .map((r) => `• Req. ${r.requerimento_number} — hoje em: ${r.linked_lead_name || 'lead sem nome'}${r.linked_case_number ? ` (caso ${r.linked_case_number})` : ' (sem caso)'}`)
        .join('\n');
      const ok = window.confirm(
        `${movingRows.length} requerimento(s) já estão vinculados a outro lead/caso:\n\n${lines}\n\nMover para este caso?`,
      );
      if (!ok) return;
    }

    setSaving(true);
    let done = 0;
    try {
      const { data: { user } } = await authClient.auth.getUser();
      const extUserId = await remapToExternal(user?.id);

      for (const proc of selectedRows) {
        try {
          const { id: processId } = await upsertInssLeadProcess({
            caseId,
            leadId,
            proc,
            createdBy: extUserId,
            workflowId: workflowId || null,
            workflowName,
            responsibleUserId: responsibleExtId,
          });

          const { error: linkErr } = await db
            .from('inss_admin_processes' as any)
            .update({
              lead_id: leadId,
              case_id: caseId,
              linked_at: new Date().toISOString(),
              linked_by: extUserId,
            })
            .eq('id', proc.id);
          if (linkErr) throw linkErr;

          const title = inssProcessTitle(proc);
          try {
            // Requerimento do INSS puxado do e-mail: sempre administrativo.
            const { extAssignedTo, assignedName } = await resolveAssignmentForCase(title, caseId, user?.id, 'administrativo');
            const r = await createOrAttachAndamentoActivity({
              leadId,
              caseId,
              processId,
              processTitle: title,
              extAssignedTo: extAssignedTo ?? extUserId,
              assignedName,
              extCreatedBy: extUserId,
            });
            if (!r.ok) toast.error(`Atividade de "${title}" não criada: ${r.error || 'erro'}`);
          } catch (actErr: any) {
            console.error('[InssEmailSearchTab] atividade falhou:', actErr);
            toast.error(`Atividade não criada: ${actErr?.message || 'erro'}`);
          }

          done++;
        } catch (e: any) {
          console.error('[InssEmailSearchTab] falha no requerimento', proc.requerimento_number, e);
          toast.error(`Req. ${proc.requerimento_number}: ${e?.message || 'erro ao cadastrar'}`);
        }
      }

      if (done > 0) {
        toast.success(`${done} processo(s) do INSS cadastrado(s) no caso`);
        onProcessAdded();
        onDone();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 mt-3">
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Nome do segurado, CPF ou nº do requerimento..."
          className="flex-1"
          onKeyDown={(e) => {
            if (e.key === 'Enter') runSearch({ raw: query, tokens: query.trim() ? [] : autoTerms });
          }}
        />
        <Button
          onClick={() => runSearch({ raw: query, tokens: query.trim() ? [] : autoTerms })}
          disabled={searching}
          size="sm"
        >
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </Button>
      </div>

      {!query.trim() && (procName || autoTerms.length > 0) && (
        <p className="text-[10px] text-muted-foreground break-words">
          {procName
            ? <>Nome da procuração: <span className="font-medium text-foreground">{procName}</span></>
            : <>Buscando pelo cliente do caso: {autoTerms.slice(0, 6).join(', ')}</>}
        </p>
      )}

      {error && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-2 rounded">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
          <Button variant="outline" size="sm" className="w-full" onClick={syncNow} disabled={syncing}>
            {syncing
              ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
              : <RefreshCw className="h-4 w-4 mr-2" />}
            Não achei — procurar no Gmail agora
          </Button>
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {results.map((r) => {
            const isSelected = selected.has(r.id);
            const linkedElsewhere = (r.case_id && r.case_id !== caseId) || (r.lead_id && r.lead_id !== leadId);
            const alreadyHere = r.case_id === caseId;
            return (
              <div
                key={r.id}
                className={`border rounded-lg p-3 cursor-pointer transition-colors hover:bg-muted/50 ${
                  isSelected ? 'ring-2 ring-primary bg-primary/5' : ''
                }`}
                onClick={() => toggle(r.id)}
              >
                <div className="flex items-start gap-2">
                  <Checkbox checked={isSelected} className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium flex items-center gap-1.5">
                      <Mail className="h-3 w-3 text-muted-foreground shrink-0" />
                      Req. {r.requerimento_number}
                      {r.benefit_number && (
                        <span className="text-xs text-muted-foreground">· NB {r.benefit_number}</span>
                      )}
                    </p>
                    {r.nome_segurado && (
                      <p className="text-xs text-muted-foreground mt-0.5 break-words">{r.nome_segurado}</p>
                    )}
                    {(r.servico || r.benefit_type) && (
                      <p className="text-xs text-muted-foreground">{r.servico || r.benefit_type}</p>
                    )}
                    {r.last_email_at && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        Último e-mail: {fmtDate(r.last_email_at)}
                      </p>
                    )}
                    {alreadyHere && (
                      <Badge variant="outline" className="text-[10px] mt-1">Já é deste caso</Badge>
                    )}
                    {linkedElsewhere && (
                      <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-1 flex items-start gap-1">
                        <Link2 className="h-3 w-3 shrink-0 mt-px" />
                        <span className="break-words">
                          Vinculado a: {r.linked_lead_name || 'lead sem nome'}
                          {r.linked_case_number ? ` (caso ${r.linked_case_number})` : ' — sem caso'}
                        </span>
                      </p>
                    )}
                  </div>
                  <Badge variant="secondary" className={`text-[10px] shrink-0 ${statusCls(r.current_status)}`}>
                    {r.current_status || '—'}
                  </Badge>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {results.length > 0 && !error && (
        <Button variant="ghost" size="sm" className="w-full h-8 text-xs" onClick={syncNow} disabled={syncing}>
          {syncing
            ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
            : <RefreshCw className="h-3.5 w-3.5 mr-2" />}
          Faltou algum? Procurar no Gmail agora
        </Button>
      )}

      {selectedRows.length > 0 && (
        <Button onClick={save} disabled={saving} className="w-full">
          {saving
            ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
            : <CheckCircle2 className="h-4 w-4 mr-2" />}
          Cadastrar {selectedRows.length} processo(s) no caso
          {movingRows.length > 0 && ` (${movingRows.length} será movido)`}
        </Button>
      )}
    </div>
  );
}
