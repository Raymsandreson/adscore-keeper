// =============================================================================
// TRANSFORMA UM PROCESSO ÓRFÃO EM CASO COM DONO — lead, caso, contato e grupo.
//
// Pedido do Raym (26/08/2026), com o 0017007-20.2016.5.16.0019 aberto: o
// inventário por OAB cria a ficha do processo e para aí. O processo existe, é do
// escritório, e mesmo assim não aparece no funil, não tem caso, não tem conversa
// com o cliente. Fazer isso à mão são cinco telas diferentes.
//
// A ordem dos passos é a ordem em que dá para parar no meio sem estrago:
//   1. lead ....... nasce na primeira fase do funil escolhido
//   2. caso ....... número gerado pela mesma RPC do fechamento de lead
//   3. vínculo .... o processo passa a apontar para os dois (é o que conserta a ficha)
//   4. contato .... a parte que representamos vira contato, reaproveitando quem já existe
//   5. grupo ...... opcional, e só com telefone: grupo sem cliente dentro não serve
//
// Se um passo falha, os anteriores continuam de pé e a tela DIZ até onde foi.
// Desfazer no meio seria pior: apagar lead e caso recém-criados é destrutivo e
// não é o que quem clicou pediu.
// =============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  CheckCircle2, IdCard, Loader2, MessageSquare, Scale, UserPlus, Users, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { authClient, db, ensureExternalSession } from '@/integrations/supabase';
import { remapToExternal } from '@/integrations/supabase/uuid-remap';
import { useKanbanBoards, isBoardArchived } from '@/hooks/useKanbanBoards';
import { TRABALHISTA_BOARD_ID } from '@/lib/trabalhistaAcolhedores';
import {
  createLeadWhatsappGroup, DEFAULT_GROUP_AUTHOR_INSTANCE_ID, GROUP_AUTHOR_OPTIONS,
} from '@/lib/leadWhatsappGroupFlow';
import {
  buscarSugestoesParaParte, marcarConversasDeWhatsApp, ordenarSugestoes,
  soDigitos, vincularParteAContato, type SugestaoDeContato,
} from '@/lib/parteContato';
import {
  nomeDoLead, notaDoLeadCriado, parteDoCliente, tituloDoCaso, type ProcessoParaCaso,
} from '@/lib/casoDoProcesso';

type EstadoPasso = 'idle' | 'running' | 'done' | 'error' | 'skip';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  processo: ProcessoParaCaso & { id: string };
  /** Chamado depois de gravar, para a ficha reler lead_id/case_id. */
  onCriado?: (r: { leadId: string; caseId: string | null }) => void;
}

const PASSOS = [
  { chave: 'lead', rotulo: 'Lead', icone: <Users className="mr-1 h-3 w-3" /> },
  { chave: 'caso', rotulo: 'Caso', icone: <Scale className="mr-1 h-3 w-3" /> },
  { chave: 'vinculo', rotulo: 'Processo vinculado', icone: <CheckCircle2 className="mr-1 h-3 w-3" /> },
  { chave: 'contato', rotulo: 'Contato do cliente', icone: <IdCard className="mr-1 h-3 w-3" /> },
  { chave: 'grupo', rotulo: 'Grupo no WhatsApp', icone: <MessageSquare className="mr-1 h-3 w-3" /> },
] as const;

type ChavePasso = typeof PASSOS[number]['chave'];

/** (85) 99999-9999 — o número volta cru do banco, em grafias variadas. */
function formatarTelefone(raw?: string | null): string {
  let d = soDigitos(raw);
  if (!d) return '';
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  if (d.length < 10) return String(raw || '');
  return `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}`;
}

export function CriarCasoDoProcessoDialog({ open, onOpenChange, processo, onCriado }: Props) {
  const { boards } = useKanbanBoards();

  const clienteDetectado = useMemo(() => parteDoCliente(processo), [processo]);
  const [polo, setPolo] = useState<'ATIVO' | 'PASSIVO'>(clienteDetectado?.polo || 'ATIVO');
  const nomeDoCliente = polo === 'ATIVO'
    ? (processo.poloAtivo || processo.titulo || '')
    : (processo.poloPassivo || '');
  const [nomeLead, setNomeLead] = useState('');
  const [boardId, setBoardId] = useState<string>(TRABALHISTA_BOARD_ID);
  const [criarGrupo, setCriarGrupo] = useState(false);
  const [instanciaAutora, setInstanciaAutora] = useState(DEFAULT_GROUP_AUTHOR_INSTANCE_ID);
  const [telefone, setTelefone] = useState('');
  const [sugestoes, setSugestoes] = useState<SugestaoDeContato[]>([]);
  const [escolha, setEscolha] = useState<SugestaoDeContato | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [passos, setPassos] = useState<Record<ChavePasso, EstadoPasso>>({
    lead: 'idle', caso: 'idle', vinculo: 'idle', contato: 'idle', grupo: 'idle',
  });
  const [concluido, setConcluido] = useState(false);

  // Nome do lead segue o polo enquanto ninguém digitar: trocar o lado que
  // representamos inverte "cliente x adversário", e o campo tem que acompanhar.
  const [nomeTocado, setNomeTocado] = useState(false);
  useEffect(() => {
    if (!open) return;
    if (!nomeTocado) setNomeLead(nomeDoLead({ ...processo, clientePolo: polo }));
  }, [open, polo, processo, nomeTocado]);

  // Estado zerado a cada abertura: um diálogo que reabre mostrando o resultado
  // da vez passada faz a pessoa achar que já criou.
  useEffect(() => {
    if (open) return;
    setPassos({ lead: 'idle', caso: 'idle', vinculo: 'idle', contato: 'idle', grupo: 'idle' });
    setConcluido(false);
    setNomeTocado(false);
    setEscolha(null);
    setSugestoes([]);
  }, [open]);

  // Quem já está na base com esse nome — para não criar o quinto "Airton".
  const buscarContatos = useCallback(async () => {
    if (!nomeDoCliente.trim()) { setSugestoes([]); return; }
    setBuscando(true);
    try {
      const achados = await buscarSugestoesParaParte({ nome: nomeDoCliente, polo });
      const comConversa = await marcarConversasDeWhatsApp(ordenarSugestoes(achados));
      setSugestoes(comConversa);
      const melhor = comConversa[0];
      if (melhor && !escolha) {
        setEscolha(melhor);
        if (melhor.telefone) setTelefone(melhor.telefone);
      }
    } catch (e) {
      console.warn('[CriarCasoDoProcesso] busca de contatos falhou:', e);
      setSugestoes([]);
    } finally {
      setBuscando(false);
    }
    // `escolha` de propósito fora das deps: rebuscar não pode desfazer a escolha.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nomeDoCliente, polo]);

  useEffect(() => {
    if (open) void buscarContatos();
  }, [open, buscarContatos]);

  const marcar = (chave: ChavePasso, estado: EstadoPasso) =>
    setPassos((p) => ({ ...p, [chave]: estado }));

  const funis = useMemo(
    () => boards.filter((b) => b.board_type === 'funnel' && !isBoardArchived(b)),
    [boards],
  );

  const telefoneDigitado = soDigitos(telefone);
  const podeCriarGrupo = telefoneDigitado.length >= 10;

  const criar = async () => {
    if (!nomeLead.trim()) { toast.error('Dê um nome ao lead'); return; }
    setGravando(true);
    marcar('lead', 'running');

    const hoje = new Date().toISOString().slice(0, 10);
    let leadId: string | null = null;
    let caseId: string | null = null;

    try {
      await ensureExternalSession();
      const { data: { user } } = await authClient.auth.getUser();
      const criadoPor = user?.id ? await remapToExternal(user.id) : null;

      // 1. Lead — primeira fase do funil escolhido.
      const funil = funis.find((b) => b.id === boardId);
      const primeiraFase = funil?.stages?.[0]?.id || 'recepcao';
      const { data: lead, error: leadErr } = await db
        .from('leads')
        .insert({
          lead_name: nomeLead.trim(),
          board_id: boardId,
          status: primeiraFase,
          source: 'Processo',
          lead_phone: telefoneDigitado || null,
          city: processo.cidade || null,
          state: processo.uf || null,
          case_number: processo.numero || null,
          notes: notaDoLeadCriado(processo, hoje),
          created_by: criadoPor,
        } as never)
        .select('id')
        .single();
      if (leadErr || !lead) throw leadErr || new Error('Lead não foi criado');
      leadId = (lead as { id: string }).id;
      marcar('lead', 'done');

      // 2. Caso — mesma RPC de numeração usada ao fechar lead no funil.
      marcar('caso', 'running');
      try {
        const { data: numero } = await db.rpc('generate_case_number', { p_product_id: null } as never);
        const { data: caso, error: casoErr } = await db
          .from('legal_cases')
          .insert({
            lead_id: leadId,
            case_number: (numero as string) || `CASO-${hoje.replace(/-/g, '')}`,
            title: tituloDoCaso({ ...processo, clientePolo: polo }),
            status: 'em_andamento',
            created_by: criadoPor,
          } as never)
          .select('id')
          .single();
        if (casoErr || !caso) throw casoErr || new Error('Caso não foi criado');
        caseId = (caso as { id: string }).id;
        marcar('caso', 'done');
      } catch (e) {
        marcar('caso', 'error');
        toast.warning('Lead criado, mas o caso falhou', { description: String((e as Error)?.message || e) });
      }

      // 3. Vínculo — é o passo que conserta a ficha do processo.
      marcar('vinculo', 'running');
      const { error: vincErr } = await db
        .from('lead_processes')
        .update({ lead_id: leadId, ...(caseId ? { case_id: caseId } : {}), cliente_polo: polo } as never)
        .eq('id', processo.id);
      if (vincErr) {
        marcar('vinculo', 'error');
        toast.warning('Lead e caso criados, mas o processo não ficou vinculado', { description: vincErr.message });
      } else {
        marcar('vinculo', 'done');
      }

      // 4. Contato do cliente — reaproveita quem já está na base.
      if (nomeDoCliente.trim()) {
        marcar('contato', 'running');
        try {
          await vincularParteAContato({
            parte: { nome: nomeDoCliente.trim(), polo },
            processoNumero: processo.numero || null,
            leadId,
            escolha,
            telefone: telefoneDigitado || null,
            criadoPor,
          });
          marcar('contato', 'done');
        } catch (e) {
          marcar('contato', 'error');
          toast.warning('Contato do cliente não foi vinculado', { description: String((e as Error)?.message || e) });
        }
      } else {
        marcar('contato', 'skip');
      }

      // 5. Grupo — só com telefone. Grupo sem o cliente dentro não serve a nada.
      if (criarGrupo && podeCriarGrupo) {
        marcar('grupo', 'running');
        const saida = await createLeadWhatsappGroup({
          leadId,
          leadName: nomeLead.trim(),
          boardId,
          creationOrigin: 'processo_sem_lead',
          creatorInstanceId: instanciaAutora,
          phone: telefoneDigitado,
        });
        if (saida.queued) {
          marcar('grupo', 'done');
          toast.info('Instâncias offline: o grupo entrou na fila e será criado automaticamente.');
        } else if (saida.groupError) {
          marcar('grupo', 'error');
          toast.warning('Grupo não foi criado', { description: saida.groupError });
        } else {
          marcar('grupo', 'done');
        }
      } else {
        marcar('grupo', 'skip');
      }

      setConcluido(true);
      toast.success('Processo virou caso', {
        description: `${nomeLead.trim()} — lead na ${funil?.name || 'primeira fase'}${caseId ? ' e caso criado' : ''}.`,
        duration: 7000,
      });
      onCriado?.({ leadId, caseId });
    } catch (e) {
      marcar('lead', 'error');
      toast.error('Não consegui criar o lead', { description: String((e as Error)?.message || e) });
    } finally {
      setGravando(false);
    }
  };

  const selo = (estado: EstadoPasso, rotulo: string, icone: React.ReactNode) => (
    <Badge
      variant="outline"
      className={
        estado === 'done' ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30'
          : estado === 'running' ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30'
            : estado === 'error' ? 'border-red-500 bg-red-50 text-red-700 dark:bg-red-900/30'
              : estado === 'skip' ? 'text-muted-foreground/60 line-through'
                : 'text-muted-foreground'
      }
    >
      {estado === 'running' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        : estado === 'error' ? <XCircle className="mr-1 h-3 w-3" /> : icone}
      {rotulo}
    </Badge>
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !gravando && onOpenChange(v)}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            Criar caso, lead e grupo deste processo
          </DialogTitle>
          <DialogDescription>
            O processo {processo.numero || 'sem número'} está sem lead e sem caso. Isto cria os dois,
            vincula o processo e liga o contato do cliente — o grupo do WhatsApp é opcional.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Quem representamos</Label>
            <Select value={polo} onValueChange={(v) => setPolo(v as 'ATIVO' | 'PASSIVO')} disabled={gravando}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ATIVO">
                  Polo Ativo (Autor){processo.poloAtivo ? ` — ${processo.poloAtivo}` : ''}
                </SelectItem>
                <SelectItem value="PASSIVO">
                  Polo Passivo (Réu){processo.poloPassivo ? ` — ${processo.poloPassivo}` : ''}
                </SelectItem>
              </SelectContent>
            </Select>
            {clienteDetectado && (
              <p className="text-[10px] text-emerald-600 dark:text-emerald-400">
                ✓ Detectado pelo título da ficha: {clienteDetectado.nome} (polo {clienteDetectado.polo}).
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Nome do lead</Label>
            <Input
              value={nomeLead}
              onChange={(e) => { setNomeLead(e.target.value); setNomeTocado(true); }}
              disabled={gravando}
              className="h-9 text-sm"
            />
            <p className="text-[10px] text-muted-foreground">
              É o nome que aparece no card do funil e nomeia o grupo. O caso nasce como
              "{tituloDoCaso({ ...processo, clientePolo: polo })}".
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Funil</Label>
            <Select value={boardId} onValueChange={setBoardId} disabled={gravando}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Escolha o funil" /></SelectTrigger>
              <SelectContent>
                {funis.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Contato do cliente */}
          <div className="space-y-1.5 rounded-lg border p-2.5">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs">Contato do cliente {nomeDoCliente ? `— ${nomeDoCliente}` : ''}</Label>
              {buscando && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
            </div>

            {sugestoes.length > 0 ? (
              <div className="space-y-1">
                {sugestoes.slice(0, 4).map((s) => {
                  const ativo = escolha?.id === s.id && escolha?.origem === s.origem;
                  return (
                    <button
                      key={`${s.origem}-${s.id}`}
                      type="button"
                      disabled={gravando}
                      onClick={() => { setEscolha(ativo ? null : s); if (!ativo && s.telefone) setTelefone(s.telefone); }}
                      className={`flex w-full items-center justify-between gap-2 rounded border px-2 py-1.5 text-left text-xs ${ativo ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{s.nome}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {s.origem === 'lead' ? 'lead' : 'contato'}
                          {s.telefone ? ` · ${formatarTelefone(s.telefone)}` : ' · sem telefone'}
                          {s.temConversa ? ' · já conversou' : ''}
                        </span>
                      </span>
                      {ativo && <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />}
                    </button>
                  );
                })}
                <p className="text-[10px] text-muted-foreground">
                  Nenhum selecionado = cria um contato novo com o nome da parte.
                </p>
              </div>
            ) : (
              <p className="text-[10px] text-muted-foreground">
                {buscando ? 'Procurando quem já está na base…' : 'Ninguém parecido na base — será criado um contato novo.'}
              </p>
            )}

            <div className="space-y-1 pt-1">
              <Label className="text-[10px] text-muted-foreground">Telefone (WhatsApp)</Label>
              <Input
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
                placeholder="(86) 99999-9999"
                disabled={gravando}
                className="h-8 text-sm"
              />
            </div>
          </div>

          {/* Grupo */}
          <div className="space-y-1.5 rounded-lg border p-2.5">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs">Criar grupo no WhatsApp</Label>
              <Switch
                checked={criarGrupo && podeCriarGrupo}
                disabled={gravando || !podeCriarGrupo}
                onCheckedChange={setCriarGrupo}
              />
            </div>
            {podeCriarGrupo ? (
              <Select value={instanciaAutora} onValueChange={setInstanciaAutora} disabled={gravando || !criarGrupo}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Quem cria o grupo" /></SelectTrigger>
                <SelectContent>
                  {GROUP_AUTHOR_OPTIONS.map((a) => (
                    <SelectItem key={a.instanceId} value={a.instanceId}>{a.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-[10px] text-amber-600 dark:text-amber-400">
                Sem telefone não dá para criar o grupo — o cliente ficaria de fora dele.
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {PASSOS.map((p) => selo(passos[p.chave], p.rotulo, p.icone))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={gravando}>
            {concluido ? 'Fechar' : 'Cancelar'}
          </Button>
          <Button onClick={criar} disabled={gravando || concluido} className="gap-1.5">
            {gravando ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            {concluido ? 'Criado' : 'Criar caso e lead'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
