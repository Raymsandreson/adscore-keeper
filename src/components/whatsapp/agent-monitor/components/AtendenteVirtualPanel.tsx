/**
 * Atendente Virtual — o que ele fez, não como ele é configurado.
 *
 * Configuração é rara: mexe uma vez e esquece. Acompanhar é diário. Os dois
 * estavam amassados dentro de Configurações, e por isso a informação de
 * operação vivia escondida atrás de um lápis de edição. Aqui fica só o que
 * aconteceu.
 *
 * Quatro colunas, e a quarta é a que ninguém pensa em pedir:
 *   Na fila     — escreveu e está esperando alguém olhar
 *   Enviadas    — chegou ao cliente, com data e hora
 *   Com humano  — virou reclamação/dinheiro/prazo e foi para um atendente
 *   Silenciadas — decidiu NÃO responder, e por quê
 *
 * A última existe porque um atendente que nunca fala parece estar funcionando.
 * Sem ver o silêncio, não dá para saber se ele está calando demais ou de menos.
 */
import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Inbox, Send, UserCheck, VolumeX, RefreshCw, Check, X, Loader2, MessagesSquare, SendHorizonal } from 'lucide-react';
import { openWhatsAppChatSheet } from '@/lib/whatsappChatSheet';

const dbAny = db as unknown as SupabaseClient;

interface Pendente {
  id: string; group_jid: string; instance_name: string | null; agendamento_id: string | null;
  group_name: string | null; pergunta: string | null; pergunta_autor: string | null;
  resposta_sugerida: string; resposta_final: string | null; intencao: string | null;
  motivo_revisao: string | null; status: string; criado_em: string; enviado_em: string | null;
  atendente_id: string | null;
  /**
   * O PostgREST devolve relação embutida como ARRAY, mesmo sendo um-para-um.
   * Aceito os dois formatos porque depender do formato de hoje é o tipo de coisa
   * que quebra calada numa atualização de biblioteca.
   */
  dom_atendentes?: { nome: string }[] | { nome: string } | null;
}
interface GrupoPiloto {
  group_jid: string; group_name: string | null; modo: string; ativo: boolean;
}
interface Decisao {
  id: string; group_name: string | null; group_jid: string; intencao: string | null;
  decisao: string; motivo: string | null; pergunta: string | null; criado_em: string;
}

/** Lê o nome do atendente venha ele como objeto ou como array de um item. */
function nomeDoAtendente(p: Pendente): string | null {
  const r = p.dom_atendentes;
  if (!r) return null;
  return Array.isArray(r) ? (r[0]?.nome ?? null) : (r.nome ?? null);
}

const quando = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * As 19 intenções em cinco famílias, que é como a decisão de fato é tomada:
 * a letra manda, o número é detalhe. Filtrar por "E16" obrigaria a pessoa a
 * decorar códigos; filtrar por "Precisa de gente" é a pergunta que ela faz.
 */
const FAMILIAS: { chave: string; rotulo: string; casa: (i: string | null) => boolean }[] = [
  { chave: 'todas', rotulo: 'Todas', casa: () => true },
  { chave: 'A', rotulo: 'Perguntou algo', casa: (i) => (i || '').startsWith('A') },
  { chave: 'B', rotulo: 'Desabafo', casa: (i) => (i || '').startsWith('B') },
  { chave: 'C', rotulo: 'Entregou algo', casa: (i) => (i || '').startsWith('C') },
  { chave: 'D', rotulo: 'Não pede resposta', casa: (i) => (i || '').startsWith('D') },
  { chave: 'E', rotulo: 'Precisa de gente', casa: (i) => (i || '').startsWith('E') },
  { chave: 'COBRANCA', rotulo: 'Cobrança', casa: (i) => i === 'COBRANCA' },
];

/**
 * Abre a conversa do grupo no painel de baixo pra cima — o mesmo drawer do
 * resto do sistema, com histórico ao vivo, mídia e resposta. Nunca redireciona.
 */
function abrirConversa(groupJid: string, instanceName: string | null, groupName: string | null) {
  openWhatsAppChatSheet({
    phone: groupJid,
    instanceName,
    contactName: groupName,
    direction: 'bottom',
    forceSheet: true,
  });
}

/** Linha comum das três listas que saem de dom_respostas_pendentes. */
function LinhaPendente({ p, onClick, rodape, marcada, onMarcar }: {
  p: Pendente; onClick?: () => void; rodape?: React.ReactNode;
  marcada?: boolean; onMarcar?: (v: boolean) => void;
}) {
  return (
    <Card className={onClick ? 'cursor-pointer hover:border-primary/40' : ''} onClick={onClick}>
      <CardContent className="p-3 space-y-1">
        <div className="flex items-center gap-2">
          {onMarcar && (
            <span onClick={(e) => e.stopPropagation()} className="shrink-0">
              <Checkbox checked={!!marcada} onCheckedChange={(v) => onMarcar(v === true)} />
            </span>
          )}
          <p className="text-xs font-medium flex-1 truncate">{p.group_name || '—'}</p>
          {p.intencao && <Badge variant="outline" className="text-[10px]">{p.intencao}</Badge>}
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">{quando(p.criado_em)}</span>
          <Button
            size="icon" variant="ghost" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-primary"
            title="Abrir a conversa do grupo"
            onClick={(e) => { e.stopPropagation(); abrirConversa(p.group_jid, p.instance_name, p.group_name); }}
          >
            <MessagesSquare className="h-3.5 w-3.5" />
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground truncate">
          <strong>{p.pergunta_autor || 'Cliente'}:</strong> {p.pergunta}
        </p>
        <p className="text-[11px] truncate">{p.resposta_final || p.resposta_sugerida}</p>
        {rodape}
      </CardContent>
    </Card>
  );
}

export function AtendenteVirtualPanel() {
  const [fila, setFila] = useState<Pendente[]>([]);
  const [enviadas, setEnviadas] = useState<Pendente[]>([]);
  const [comHumano, setComHumano] = useState<Pendente[]>([]);
  const [silenciadas, setSilenciadas] = useState<Decisao[]>([]);
  const [grupos, setGrupos] = useState<GrupoPiloto[]>([]);
  const [trocandoModo, setTrocandoModo] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [familia, setFamilia] = useState('todas');
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [carregando, setCarregando] = useState(false);
  const [aberto, setAberto] = useState<Pendente | null>(null);
  const [texto, setTexto] = useState('');

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      await ensureExternalSession();
      const sel = 'id, group_jid, instance_name, agendamento_id, group_name, pergunta, pergunta_autor, resposta_sugerida, resposta_final, intencao, motivo_revisao, status, criado_em, enviado_em, atendente_id, dom_atendentes(nome)';
      const [f, e, h, s, gp] = await Promise.all([
        // "Na fila" é tudo que AINDA NÃO SAIU — inclusive o que alguém já
        // aprovou. Filtrar só por 'pendente' fazia a resposta aprovada sumir
        // das quatro abas: não estava mais na fila, nunca chegou em enviadas,
        // e ficava parada para sempre sem ninguém ver.
        dbAny.from('dom_respostas_pendentes').select(sel)
          .in('status', ['pendente', 'aprovada', 'editada']).is('atendente_id', null)
          .order('criado_em', { ascending: false }).limit(100),
        dbAny.from('dom_respostas_pendentes').select(sel)
          .eq('status', 'enviada')
          .order('enviado_em', { ascending: false }).limit(100),
        dbAny.from('dom_respostas_pendentes').select(sel)
          .not('atendente_id', 'is', null)
          .order('criado_em', { ascending: false }).limit(100),
        dbAny.from('dom_decisoes')
          .select('id, group_name, group_jid, intencao, decisao, motivo, pergunta, criado_em')
          .eq('decisao', 'silencio')
          .order('criado_em', { ascending: false }).limit(100),
        dbAny.from('dom_grupos_piloto')
          .select('group_jid, group_name, modo, ativo')
          .eq('ativo', true).order('group_name'),
      ]);
      setFila((f.data as unknown as Pendente[]) || []);
      setEnviadas((e.data as unknown as Pendente[]) || []);
      setComHumano((h.data as unknown as Pendente[]) || []);
      setSilenciadas((s.data as unknown as Decisao[]) || []);
      setGrupos((gp.data as unknown as GrupoPiloto[]) || []);
    } catch (err) {
      console.error('[AtendenteVirtualPanel]', err);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const decidir = async (p: Pendente, status: 'aprovada' | 'editada' | 'descartada') => {
    const { error } = await dbAny.from('dom_respostas_pendentes')
      .update({
        status,
        resposta_final: status === 'descartada' ? null : texto,
        revisado_em: new Date().toISOString(),
      } as never)
      .eq('id', p.id);
    if (error) { toast.error('Não salvou: ' + error.message); return; }
    setAberto(null);
    toast.success(status === 'descartada' ? 'Descartada' : 'Marcada como boa');
    carregar();
  };

  /**
   * Liga/desliga o "responde sozinho" de um grupo.
   *
   * `rascunho` → escreve e espera alguém aprovar (nada sai).
   * `automatico` → entra na fila de envio com 5 minutos de atraso; a janela é a
   * revisão, e a bolha tracejada na conversa deixa cancelar ou mandar na hora.
   */
  const trocarModo = async (g: GrupoPiloto, sozinho: boolean) => {
    setTrocandoModo(g.group_jid);
    const modo = sozinho ? 'automatico' : 'rascunho';
    const { error } = await dbAny.from('dom_grupos_piloto')
      .update({ modo } as never).eq('group_jid', g.group_jid);
    setTrocandoModo(null);
    if (error) { toast.error('Não salvou: ' + error.message); return; }
    setGrupos(atual => atual.map(x => (x.group_jid === g.group_jid ? { ...x, modo } : x)));
    toast.success(sozinho
      ? `${g.group_name}: responde sozinho, 5 min depois de o cliente escrever`
      : `${g.group_name}: volta a só rascunhar`);
  };

  const automaticos = grupos.filter(g => g.modo === 'automatico').length;

  /**
   * Aprovar E mandar — o botão que faltava.
   *
   * "Marcar como boa" só marca: um rascunho de grupo em modo Rascunho não tinha
   * NENHUM caminho para chegar ao cliente, e ficava preso no painel para sempre.
   * Aqui ele entra na mesma fila de agendamento do resto, com os mesmos 5
   * minutos — então ainda dá para desistir pela bolha na conversa, e quem
   * escreveu no grupo nesse meio-tempo cancela o envio sozinho.
   */
  const porNaFilaDeEnvio = async (p: Pendente, corpo: string) => {
    const quando = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const { data: ag, error: errAg } = await dbAny.from('whatsapp_mensagens_agendadas').insert({
      phone: p.group_jid,
      instance_name: p.instance_name,
      contact_name: p.group_name,
      mensagem: corpo,
      mensagem_original: corpo,
      proximo_envio_at: quando,
      repeticao: 'nenhuma',
      intervalo: 1,
      unidade: 'dias',
      pular_se_responder: true,
      criado_por_nome: 'Atendente virtual (aprovado à mão)',
    } as never).select('id').maybeSingle();
    if (errAg) throw errAg;

    const { error } = await dbAny.from('dom_respostas_pendentes')
      .update({
        resposta_final: corpo,
        agendamento_id: (ag as { id: string }).id,
        revisado_em: new Date().toISOString(),
        motivo_revisao: 'aprovado à mão — sai em 5 min',
      } as never)
      .eq('id', p.id);
    if (error) throw error;
  };

  const aprovarEEnviar = async (p: Pendente) => {
    setEnviando(true);
    try {
      await porNaFilaDeEnvio(p, texto);
      setAberto(null);
      toast.success('Na fila — sai em 5 minutos, dá para cancelar pela conversa');
      carregar();
    } catch (e) {
      toast.error('Não consegui pôr na fila: ' + ((e as Error)?.message || 'erro'));
    } finally {
      setEnviando(false);
    }
  };

  /**
   * Ação em lote sobre o que estiver marcado. Uma fila de trinta rascunhos não
   * se resolve abrindo trinta painéis.
   */
  const emLote = async (acao: 'enviar' | 'descartar') => {
    const alvos = fila.filter(p => marcadas.has(p.id));
    if (alvos.length === 0) return;
    setEnviando(true);
    let ok = 0;
    const falhas: string[] = [];
    for (const p of alvos) {
      try {
        if (acao === 'enviar') {
          await porNaFilaDeEnvio(p, p.resposta_final || p.resposta_sugerida);
        } else {
          const { error } = await dbAny.from('dom_respostas_pendentes')
            .update({ status: 'descartada', revisado_em: new Date().toISOString() } as never)
            .eq('id', p.id);
          if (error) throw error;
        }
        ok++;
      } catch (e) {
        falhas.push(`${p.group_name}: ${(e as Error)?.message || 'erro'}`);
      }
    }
    setEnviando(false);
    setMarcadas(new Set());
    if (ok) {
      toast.success(acao === 'enviar'
        ? `${ok} na fila — saem em 5 minutos`
        : `${ok} descartada(s)`);
    }
    // Falha silenciosa em lote é o pior tipo: a pessoa acha que mandou tudo.
    if (falhas.length) toast.error(`${falhas.length} não deu: ${falhas[0]}`);
    carregar();
  };

  const marcar = (id: string, v: boolean) => {
    setMarcadas(atual => {
      const novo = new Set(atual);
      if (v) novo.add(id); else novo.delete(id);
      return novo;
    });
  };

  /** O filtro de intenção vale para as três listas que têm intenção. */
  const casa = FAMILIAS.find(f => f.chave === familia) ?? FAMILIAS[0];
  const filaF = fila.filter(p => casa.casa(p.intencao));
  const enviadasF = enviadas.filter(p => casa.casa(p.intencao));
  const comHumanoF = comHumano.filter(p => casa.casa(p.intencao));
  const silenciadasF = silenciadas.filter(d => casa.casa(d.intencao));

  const vazio = (txt: string) => <p className="text-xs text-muted-foreground py-6 text-center">{txt}</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-[11px] text-muted-foreground flex-1">
          O que o atendente virtual fez.{' '}
          {automaticos === 0
            ? 'Nenhum grupo responde sozinho ainda — tudo fica esperando revisão e nada sai para o cliente.'
            : `${automaticos} de ${grupos.length} grupos respondem sozinhos: a resposta entra na fila e sai 5 minutos depois, se ninguém escrever antes.`}
        </p>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={carregar} disabled={carregando}>
          {carregando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Atualizar
        </Button>
      </div>

      {grupos.length > 0 && (
        <Card>
          <CardContent className="p-3 space-y-2">
            <p className="text-[11px] font-medium">Quem ele acompanha</p>
            <p className="text-[10px] text-muted-foreground">
              Ligado, ele responde sozinho 5 minutos depois de o cliente escrever. A mensagem
              aparece na conversa como bolha tracejada com cronômetro — dá para tirar da fila
              ou mandar na hora. Se alguém escrever no grupo antes, ela não sai.
            </p>
            <div className="space-y-1 pt-1">
              {grupos.map(g => (
                <div key={g.group_jid} className="flex items-center gap-2">
                  <span className="text-[11px] flex-1 truncate">{g.group_name || g.group_jid}</span>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                    {g.modo === 'automatico' ? 'responde sozinho' : 'só rascunha'}
                  </span>
                  <Switch
                    checked={g.modo === 'automatico'}
                    disabled={trocandoModo === g.group_jid}
                    onCheckedChange={(v) => trocarModo(g, v)}
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[10px] text-muted-foreground mr-1">Intenção:</span>
        {FAMILIAS.map(f => (
          <Button
            key={f.chave}
            size="sm"
            variant={familia === f.chave ? 'default' : 'outline'}
            className="h-6 px-2 text-[10px]"
            onClick={() => { setFamilia(f.chave); setMarcadas(new Set()); }}
          >
            {f.rotulo}
          </Button>
        ))}
      </div>

      <Tabs defaultValue="fila">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="fila" className="text-xs gap-1">
            <Inbox className="h-3.5 w-3.5" />Na fila
            {filaF.length > 0 && <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{filaF.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="enviadas" className="text-xs gap-1">
            <Send className="h-3.5 w-3.5" />Enviadas
            {enviadasF.length > 0 && <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{enviadasF.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="humano" className="text-xs gap-1">
            <UserCheck className="h-3.5 w-3.5" />Com humano
            {comHumanoF.length > 0 && <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{comHumanoF.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="silencio" className="text-xs gap-1">
            <VolumeX className="h-3.5 w-3.5" />Silenciadas
            {silenciadasF.length > 0 && <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{silenciadasF.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="fila" className="space-y-2 pt-3">
          {filaF.length > 0 && (
            <div className="flex items-center gap-2 pb-1">
              <Checkbox
                checked={marcadas.size > 0 && marcadas.size === filaF.length}
                onCheckedChange={(v) => setMarcadas(v === true ? new Set(filaF.map(p => p.id)) : new Set())}
              />
              <span className="text-[10px] text-muted-foreground flex-1">
                {marcadas.size > 0 ? `${marcadas.size} marcada(s)` : 'Marcar todas'}
              </span>
              {marcadas.size > 0 && (
                <>
                  <Button size="sm" className="h-6 px-2 text-[10px] gap-1"
                    disabled={enviando} onClick={() => emLote('enviar')}>
                    {enviando ? <Loader2 className="h-3 w-3 animate-spin" /> : <SendHorizonal className="h-3 w-3" />}
                    Enviar as marcadas
                  </Button>
                  <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] gap-1"
                    disabled={enviando} onClick={() => emLote('descartar')}>
                    <X className="h-3 w-3" />Descartar
                  </Button>
                </>
              )}
            </div>
          )}
          {filaF.length === 0 && vazio('Nada esperando revisão.')}
          {filaF.map(p => (
            <LinhaPendente key={p.id} p={p}
              marcada={marcadas.has(p.id)}
              onMarcar={(v) => marcar(p.id, v)}
              onClick={() => { setAberto(p); setTexto(p.resposta_final || p.resposta_sugerida); }}
              rodape={p.status !== 'pendente' && !p.agendamento_id
                ? <p className="text-[10px] text-amber-700">
                    Marcada como boa, mas ainda não saiu — abra e use "Aprovar e enviar".
                  </p>
                : p.motivo_revisao
                  ? <p className="text-[10px] text-amber-700 truncate">{p.motivo_revisao}</p>
                  : null} />
          ))}
        </TabsContent>

        <TabsContent value="enviadas" className="space-y-2 pt-3">
          {enviadasF.length === 0 && vazio('Nenhuma mensagem chegou ao cliente ainda.')}
          {enviadasF.map(p => (
            <LinhaPendente key={p.id} p={p}
              rodape={<p className="text-[10px] text-emerald-700">
                Enviada em {p.enviado_em ? quando(p.enviado_em) : '—'}
              </p>} />
          ))}
        </TabsContent>

        <TabsContent value="humano" className="space-y-2 pt-3">
          {comHumanoF.length === 0 && vazio('Nada foi encaminhado para atendente.')}
          {comHumanoF.map(p => (
            <LinhaPendente key={p.id} p={p}
              onClick={() => { setAberto(p); setTexto(p.resposta_final || p.resposta_sugerida); }}
              rodape={<p className="text-[10px] text-blue-700">
                Para {nomeDoAtendente(p) || 'atendente'} · {p.motivo_revisao}
              </p>} />
          ))}
        </TabsContent>

        <TabsContent value="silencio" className="space-y-2 pt-3">
          {silenciadasF.length === 0 && vazio('Ele ainda não decidiu calar em nenhuma conversa.')}
          {silenciadasF.map(d => (
            <Card key={d.id}>
              <CardContent className="p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-medium flex-1 truncate">{d.group_name || d.group_jid}</p>
                  {d.intencao && <Badge variant="outline" className="text-[10px]">{d.intencao}</Badge>}
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">{quando(d.criado_em)}</span>
                  <Button
                    size="icon" variant="ghost" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-primary"
                    title="Abrir a conversa do grupo"
                    onClick={() => abrirConversa(d.group_jid, null, d.group_name)}
                  >
                    <MessagesSquare className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground truncate">
                  <strong>Cliente:</strong> {d.pergunta}
                </p>
                <p className="text-[10px] text-muted-foreground italic">Não respondeu — {d.motivo}</p>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>

      {/* Detalhe em painel lateral — nunca redireciona, nunca abre aba nova. */}
      <Sheet open={!!aberto} onOpenChange={o => !o && setAberto(null)}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader><SheetTitle className="text-sm">{aberto?.group_name || 'Rascunho'}</SheetTitle></SheetHeader>
          {aberto && (
            <div className="space-y-3 mt-4">
              <div className="space-y-1">
                <Label className="text-xs">O cliente escreveu</Label>
                <p className="text-xs bg-muted rounded p-2 whitespace-pre-wrap">{aberto.pergunta}</p>
                <p className="text-[10px] text-muted-foreground">
                  {aberto.pergunta_autor} · intenção {aberto.intencao || '—'} · {quando(aberto.criado_em)}
                </p>
              </div>
              {aberto.motivo_revisao && (
                <div className="space-y-1">
                  <Label className="text-xs">Por que parou aqui</Label>
                  <p className="text-[11px] text-amber-700">{aberto.motivo_revisao}</p>
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-xs">Resposta sugerida (dá para editar)</Label>
                <Textarea className="text-xs min-h-[180px]" value={texto} onChange={e => setTexto(e.target.value)} />
              </div>
              <Button size="sm" variant="outline" className="w-full text-xs gap-1"
                onClick={() => abrirConversa(aberto.group_jid, aberto.instance_name, aberto.group_name)}>
                <MessagesSquare className="h-3.5 w-3.5" />Abrir a conversa do grupo
              </Button>
              <Button size="sm" className="w-full text-xs gap-1"
                disabled={enviando || !texto.trim()}
                onClick={() => aprovarEEnviar(aberto)}>
                {enviando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SendHorizonal className="h-3.5 w-3.5" />}
                Aprovar e enviar (sai em 5 min)
              </Button>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="text-xs gap-1 flex-1"
                  onClick={() => decidir(aberto, texto === aberto.resposta_sugerida ? 'aprovada' : 'editada')}>
                  <Check className="h-3.5 w-3.5" />Só marcar como boa
                </Button>
                <Button size="sm" variant="outline" className="text-xs gap-1"
                  onClick={() => decidir(aberto, 'descartada')}>
                  <X className="h-3.5 w-3.5" />Descartar
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                <strong>Aprovar e enviar</strong> põe na fila com 5 minutos de atraso — ainda dá
                para cancelar pela bolha tracejada na conversa, e o envio some sozinho se alguém
                escrever no grupo antes.{' '}
                <strong>Só marcar como boa</strong> não manda nada: serve para o atendente aprender
                com a correção antes de falar sozinho.
              </p>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
