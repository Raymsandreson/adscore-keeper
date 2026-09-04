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
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Inbox, Send, UserCheck, VolumeX, RefreshCw, Check, X, Loader2, MessagesSquare } from 'lucide-react';
import { openWhatsAppChatSheet } from '@/lib/whatsappChatSheet';

const dbAny = db as unknown as SupabaseClient;

interface Pendente {
  id: string; group_jid: string; instance_name: string | null;
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
function LinhaPendente({ p, onClick, rodape }: { p: Pendente; onClick?: () => void; rodape?: React.ReactNode }) {
  return (
    <Card className={onClick ? 'cursor-pointer hover:border-primary/40' : ''} onClick={onClick}>
      <CardContent className="p-3 space-y-1">
        <div className="flex items-center gap-2">
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
  const [carregando, setCarregando] = useState(false);
  const [aberto, setAberto] = useState<Pendente | null>(null);
  const [texto, setTexto] = useState('');

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      await ensureExternalSession();
      const sel = 'id, group_jid, instance_name, group_name, pergunta, pergunta_autor, resposta_sugerida, resposta_final, intencao, motivo_revisao, status, criado_em, enviado_em, atendente_id, dom_atendentes(nome)';
      const [f, e, h, s] = await Promise.all([
        dbAny.from('dom_respostas_pendentes').select(sel)
          .eq('status', 'pendente').is('atendente_id', null)
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
      ]);
      setFila((f.data as unknown as Pendente[]) || []);
      setEnviadas((e.data as unknown as Pendente[]) || []);
      setComHumano((h.data as unknown as Pendente[]) || []);
      setSilenciadas((s.data as unknown as Decisao[]) || []);
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

  const vazio = (txt: string) => <p className="text-xs text-muted-foreground py-6 text-center">{txt}</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-[11px] text-muted-foreground flex-1">
          O que o atendente virtual fez. Enquanto os grupos estiverem em modo Rascunho,
          nada sai para o cliente — a coluna Enviadas fica vazia de propósito.
        </p>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={carregar} disabled={carregando}>
          {carregando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Atualizar
        </Button>
      </div>

      <Tabs defaultValue="fila">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="fila" className="text-xs gap-1">
            <Inbox className="h-3.5 w-3.5" />Na fila
            {fila.length > 0 && <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{fila.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="enviadas" className="text-xs gap-1">
            <Send className="h-3.5 w-3.5" />Enviadas
            {enviadas.length > 0 && <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{enviadas.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="humano" className="text-xs gap-1">
            <UserCheck className="h-3.5 w-3.5" />Com humano
            {comHumano.length > 0 && <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{comHumano.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="silencio" className="text-xs gap-1">
            <VolumeX className="h-3.5 w-3.5" />Silenciadas
            {silenciadas.length > 0 && <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{silenciadas.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="fila" className="space-y-2 pt-3">
          {fila.length === 0 && vazio('Nada esperando revisão.')}
          {fila.map(p => (
            <LinhaPendente key={p.id} p={p}
              onClick={() => { setAberto(p); setTexto(p.resposta_sugerida); }}
              rodape={p.motivo_revisao
                ? <p className="text-[10px] text-amber-700 truncate">{p.motivo_revisao}</p>
                : null} />
          ))}
        </TabsContent>

        <TabsContent value="enviadas" className="space-y-2 pt-3">
          {enviadas.length === 0 && vazio('Nenhuma mensagem chegou ao cliente ainda.')}
          {enviadas.map(p => (
            <LinhaPendente key={p.id} p={p}
              rodape={<p className="text-[10px] text-emerald-700">
                Enviada em {p.enviado_em ? quando(p.enviado_em) : '—'}
              </p>} />
          ))}
        </TabsContent>

        <TabsContent value="humano" className="space-y-2 pt-3">
          {comHumano.length === 0 && vazio('Nada foi encaminhado para atendente.')}
          {comHumano.map(p => (
            <LinhaPendente key={p.id} p={p}
              onClick={() => { setAberto(p); setTexto(p.resposta_sugerida); }}
              rodape={<p className="text-[10px] text-blue-700">
                Para {nomeDoAtendente(p) || 'atendente'} · {p.motivo_revisao}
              </p>} />
          ))}
        </TabsContent>

        <TabsContent value="silencio" className="space-y-2 pt-3">
          {silenciadas.length === 0 && vazio('Ele ainda não decidiu calar em nenhuma conversa.')}
          {silenciadas.map(d => (
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
              <div className="flex gap-2">
                <Button size="sm" className="text-xs gap-1 flex-1"
                  onClick={() => decidir(aberto, texto === aberto.resposta_sugerida ? 'aprovada' : 'editada')}>
                  <Check className="h-3.5 w-3.5" />Marcar como boa
                </Button>
                <Button size="sm" variant="outline" className="text-xs gap-1"
                  onClick={() => decidir(aberto, 'descartada')}>
                  <X className="h-3.5 w-3.5" />Descartar
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Marcar como boa não envia nada ao cliente enquanto o grupo estiver em modo
                Rascunho — serve para o atendente aprender com a correção antes de falar sozinho.
              </p>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
