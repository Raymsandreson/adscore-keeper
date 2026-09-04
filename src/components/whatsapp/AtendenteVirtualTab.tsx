/**
 * Atendente Virtual — a aba que faltava.
 *
 * Até aqui, piloto, atendentes, rodízio e fila de rascunhos só existiam no
 * banco: para saber o que o atendente responderia era preciso rodar SQL. Esta
 * aba põe as quatro coisas na tela, no mesmo lugar onde os outros agentes já
 * são configurados.
 *
 * O NOME SAI DA VOZ
 * Voz masculina → Dom. Voz feminina → Dora. O campo continua editável, mas
 * muda sozinho ao trocar a voz enquanto ninguém tiver digitado outro nome —
 * assim não sobra "Dom" falando com voz de mulher.
 *
 * Tudo abre em painel lateral, nada redireciona (regra de interface do projeto).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Volume2, Users, MessageSquare, Inbox, Trash2, Check, X, ArrowUp, ArrowDown, Plus } from 'lucide-react';

/** O agente de contexto processual. Um só, por enquanto. */
const AGENT_ID = 'd6ad8eee-d6a3-452c-b852-b94ef8dd54bf';

const dbAny = db as unknown as SupabaseClient;

/** Voz pronta do ElevenLabs ou clonada. `genero` só existe nas prontas. */
interface Voz { id: string; name: string; genero: 'masculina' | 'feminina' | null }

/**
 * As vozes prontas do ElevenLabs, com o gênero que a própria edge
 * elevenlabs-voice-clone declara em `list_presets`. Voz clonada não tem gênero
 * declarado em lugar nenhum — para essa, quem diz é o usuário.
 */
const VOZES_PRONTAS: Voz[] = [
  { id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura (padrão pt-BR)', genero: 'feminina' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', genero: 'feminina' },
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', genero: 'masculina' },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', genero: 'masculina' },
  { id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica', genero: 'feminina' },
  { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', genero: 'feminina' },
  { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', genero: 'masculina' },
  { id: 'nPczCjzI2devNBz1zQrb', name: 'Brian', genero: 'masculina' },
  { id: 'CwhRBWXzGAHq8TQ4Fs17', name: 'Roger', genero: 'masculina' },
  { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', genero: 'feminina' },
];
interface Config {
  nome_atendente: string | null;
  reply_voice_id: string | null;
  genero_voz: 'masculina' | 'feminina' | null;
  reply_with_audio: boolean;
  split_messages: boolean;
  split_delay_seconds: number;
  human_reply_pause_minutes: number;
  max_tts_chars: number;
  is_active: boolean;
  contexto_processual: boolean;
}
interface Grupo { group_jid: string; group_name: string | null; modo: string; ativo: boolean }
interface Atendente { id: string; nome: string; whatsapp: string; escopo: string; is_active: boolean; position: number }
interface Rascunho {
  id: string; group_name: string | null; pergunta: string | null; pergunta_autor: string | null;
  resposta_sugerida: string; intencao: string | null; motivo_revisao: string | null;
  status: string; criado_em: string;
}

/** Voz masculina vira Dom, feminina vira Dora. Sem gênero, não chuta. */
function nomePelaVoz(genero: string | null | undefined): string | null {
  if (genero === 'masculina') return 'Dom';
  if (genero === 'feminina') return 'Dora';
  return null;
}

const MODOS: Record<string, { rotulo: string; ajuda: string }> = {
  rascunho: { rotulo: 'Rascunho', ajuda: 'Escreve e guarda na fila. Nada chega ao cliente.' },
  hibrido: { rotulo: 'Híbrido', ajuda: 'Envia o factual; o sensível vai para a fila.' },
  automatico: { rotulo: 'Automático', ajuda: 'Envia tudo, sem revisão.' },
};

export function AtendenteVirtualTab() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [vozes, setVozes] = useState<Voz[]>([]);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [atendentes, setAtendentes] = useState<Atendente[]>([]);
  const [fila, setFila] = useState<Rascunho[]>([]);
  const [aberto, setAberto] = useState<Rascunho | null>(null);
  const [textoEditado, setTextoEditado] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [novoNome, setNovoNome] = useState('');
  const [novoZap, setNovoZap] = useState('');

  const carregar = useCallback(async () => {
    await ensureExternalSession();
    const [c, v, g, a, f] = await Promise.all([
      dbAny.from('wjia_command_shortcuts')
        .select('nome_atendente, reply_voice_id, genero_voz, reply_with_audio, split_messages, split_delay_seconds, human_reply_pause_minutes, max_tts_chars, is_active, contexto_processual')
        .eq('id', AGENT_ID).maybeSingle(),
      // As vozes clonadas moram no CLOUD, não no Externo: é de lá que a tela de
      // Agentes IA sempre leu. No Externo a mesma tabela tem RLS
      // `user_id = auth.uid()`, e o user_id guardado lá é uuid do Cloud — não
      // casa com ninguém, e a lista volta vazia.
      supabase.from('custom_voices').select('id, name').eq('status', 'ready').order('name'),
      dbAny.from('dom_grupos_piloto').select('group_jid, group_name, modo, ativo').order('group_name'),
      dbAny.from('dom_atendentes').select('id, nome, whatsapp, escopo, is_active, position').order('position'),
      dbAny.from('dom_respostas_pendentes')
        .select('id, group_name, pergunta, pergunta_autor, resposta_sugerida, intencao, motivo_revisao, status, criado_em')
        .eq('status', 'pendente').order('criado_em', { ascending: false }).limit(50),
    ]);
    if (c.data) setCfg(c.data as Config);
    const clonadas: Voz[] = ((v.data as any[]) || []).map(x => ({ id: x.id, name: `🎤 ${x.name}`, genero: null }));
    setVozes([...VOZES_PRONTAS, ...clonadas]);
    setGrupos((g.data as Grupo[]) || []);
    setAtendentes((a.data as Atendente[]) || []);
    setFila((f.data as Rascunho[]) || []);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const vozEscolhida = useMemo(
    () => vozes.find(v => v.id === cfg?.reply_voice_id) || null,
    [vozes, cfg?.reply_voice_id],
  );
  const nomeSugerido = nomePelaVoz(cfg?.genero_voz);
  /** Voz clonada não declara gênero — aí a escolha aparece na tela. */
  const precisaEscolherGenero = !!vozEscolhida && vozEscolhida.genero === null;

  const salvarConfig = async (patch: Partial<Config>) => {
    if (!cfg) return;
    setSalvando(true);
    const novo = { ...cfg, ...patch };
    setCfg(novo);
    const { error } = await dbAny.from('wjia_command_shortcuts').update(patch as never).eq('id', AGENT_ID);
    setSalvando(false);
    if (error) { toast.error('Não salvou: ' + error.message); carregar(); return; }
    toast.success('Salvo');
  };

  /** Trocar a voz reescreve o nome, a menos que já exista um nome escolhido à mão. */
  const trocarVoz = async (voiceId: string) => {
    const voz = vozes.find(v => v.id === voiceId);
    // Voz pronta já traz o gênero; clonada fica null e a tela pergunta.
    await aplicarGenero(voz?.genero ?? null, { reply_voice_id: voiceId });
  };

  /**
   * Grava o gênero e, com ele, o nome. O nome só é reescrito enquanto for um dos
   * dois automáticos — nome digitado à mão sobrevive à troca de voz.
   */
  const aplicarGenero = async (genero: 'masculina' | 'feminina' | null, extra: Partial<Config> = {}) => {
    const sugerido = nomePelaVoz(genero);
    const nomeAtual = cfg?.nome_atendente;
    const nomeEraAutomatico = !nomeAtual || nomeAtual === 'Dom' || nomeAtual === 'Dora';
    await salvarConfig({
      ...extra,
      genero_voz: genero,
      ...(sugerido && nomeEraAutomatico ? { nome_atendente: sugerido } : {}),
    });
  };

  const decidirRascunho = async (r: Rascunho, status: 'aprovada' | 'editada' | 'descartada', texto?: string) => {
    const { error } = await dbAny.from('dom_respostas_pendentes')
      .update({ status, resposta_final: texto ?? r.resposta_sugerida, revisado_em: new Date().toISOString() } as never)
      .eq('id', r.id);
    if (error) { toast.error('Não salvou: ' + error.message); return; }
    setAberto(null);
    toast.success(status === 'descartada' ? 'Descartada' : 'Marcada como boa');
    carregar();
  };

  const moverAtendente = async (a: Atendente, delta: number) => {
    const ordenados = atendentes.filter(x => x.escopo === a.escopo);
    const i = ordenados.findIndex(x => x.id === a.id);
    const troca = ordenados[i + delta];
    if (!troca) return;
    await Promise.all([
      dbAny.from('dom_atendentes').update({ position: troca.position } as never).eq('id', a.id),
      dbAny.from('dom_atendentes').update({ position: a.position } as never).eq('id', troca.id),
    ]);
    carregar();
  };

  const addAtendente = async () => {
    const zap = novoZap.replace(/\D/g, '');
    if (!novoNome.trim() || zap.length < 12) {
      toast.error('Precisa de nome e WhatsApp com DDI (ex: 5586999998888)');
      return;
    }
    const { error } = await dbAny.from('dom_atendentes').insert({
      nome: novoNome.trim(), whatsapp: zap, escopo: 'geral',
      position: atendentes.length,
    } as never);
    if (error) { toast.error(error.message); return; }
    setNovoNome(''); setNovoZap('');
    carregar();
  };

  if (!cfg) return <p className="text-xs text-muted-foreground p-4">Carregando…</p>;

  return (
    <div className="space-y-4">
      {!cfg.is_active && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-3 text-xs">
            <strong>Atendente desligado.</strong> Nenhuma mensagem chega ao cliente. Os grupos em
            modo <em>Rascunho</em> continuam gerando resposta para a fila abaixo.
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="identidade">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="identidade" className="text-xs gap-1"><Volume2 className="h-3.5 w-3.5" />Identidade</TabsTrigger>
          <TabsTrigger value="grupos" className="text-xs gap-1"><MessageSquare className="h-3.5 w-3.5" />Grupos</TabsTrigger>
          <TabsTrigger value="atendentes" className="text-xs gap-1"><Users className="h-3.5 w-3.5" />Atendentes</TabsTrigger>
          <TabsTrigger value="fila" className="text-xs gap-1">
            <Inbox className="h-3.5 w-3.5" />Fila
            {fila.length > 0 && <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{fila.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        {/* ---------------- IDENTIDADE ---------------- */}
        <TabsContent value="identidade" className="space-y-3 pt-3">
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Voz</Label>
                  <Select value={cfg.reply_voice_id || ''} onValueChange={trocarVoz}>
                    <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Escolha a voz" /></SelectTrigger>
                    <SelectContent>
                      {vozes.map(v => (
                        <SelectItem key={v.id} value={v.id} className="text-xs">
                          {v.name}{v.genero ? ` — ${v.genero}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {precisaEscolherGenero && (
                    <div className="pt-1 space-y-1">
                      <Label className="text-[10px] text-amber-700">
                        Voz clonada não diz o gênero. Qual é?
                      </Label>
                      <Select value={cfg.genero_voz || ''}
                        onValueChange={v => aplicarGenero(v as 'masculina' | 'feminina')}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Escolha" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="masculina" className="text-xs">Masculina → Dom</SelectItem>
                          <SelectItem value="feminina" className="text-xs">Feminina → Dora</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Nome do atendente</Label>
                  <Input
                    className="h-9 text-xs"
                    value={cfg.nome_atendente || ''}
                    placeholder={nomeSugerido || 'Dom ou Dora'}
                    onChange={e => setCfg({ ...cfg, nome_atendente: e.target.value })}
                    onBlur={e => salvarConfig({ nome_atendente: e.target.value.trim() || null })}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Voz masculina vira <strong>Dom</strong>, feminina vira <strong>Dora</strong>. Dá para trocar.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between border rounded-lg p-3">
                <div>
                  <Label className="text-xs">🔊 Responder em áudio quando o cliente mandar áudio</Label>
                  <p className="text-[10px] text-muted-foreground">Texto continua sendo respondido por texto.</p>
                </div>
                <Switch checked={cfg.reply_with_audio}
                  onCheckedChange={v => salvarConfig({ reply_with_audio: v })} />
              </div>

              <div className="flex items-center justify-between border rounded-lg p-3">
                <div>
                  <Label className="text-xs">Quebrar mensagem longa em partes</Label>
                  <p className="text-[10px] text-muted-foreground">Sai em pedaços, com pausa entre eles.</p>
                </div>
                <Switch checked={cfg.split_messages}
                  onCheckedChange={v => salvarConfig({ split_messages: v })} />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-xs">Pausa entre as partes (s)</Label>
                  <Input type="number" className="h-9 text-xs" defaultValue={cfg.split_delay_seconds}
                    onBlur={e => salvarConfig({ split_delay_seconds: Number(e.target.value) || 0 })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Cala por quanto tempo se um humano responder (min)</Label>
                  <Input type="number" className="h-9 text-xs" defaultValue={cfg.human_reply_pause_minutes}
                    onBlur={e => salvarConfig({ human_reply_pause_minutes: Number(e.target.value) || 0 })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Tamanho máximo do áudio (caracteres)</Label>
                  <Input type="number" className="h-9 text-xs" defaultValue={cfg.max_tts_chars}
                    onBlur={e => salvarConfig({ max_tts_chars: Number(e.target.value) || 500 })} />
                </div>
              </div>
              {salvando && <p className="text-[10px] text-muted-foreground">salvando…</p>}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- GRUPOS ---------------- */}
        <TabsContent value="grupos" className="space-y-2 pt-3">
          <p className="text-[11px] text-muted-foreground">
            Só nestes grupos o atendente abre a boca. Fora da lista ele fica mudo, mesmo ligado.
          </p>
          {grupos.length === 0 && <p className="text-xs text-muted-foreground">Nenhum grupo no piloto.</p>}
          {grupos.map(g => (
            <Card key={g.group_jid}>
              <CardContent className="p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{g.group_name || g.group_jid}</p>
                  <p className="text-[10px] text-muted-foreground">{MODOS[g.modo]?.ajuda}</p>
                </div>
                <Select value={g.modo} onValueChange={async v => {
                  await dbAny.from('dom_grupos_piloto').update({ modo: v } as never).eq('group_jid', g.group_jid);
                  carregar();
                }}>
                  <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(MODOS).map(([k, m]) => (
                      <SelectItem key={k} value={k} className="text-xs">{m.rotulo}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Switch checked={g.ativo} onCheckedChange={async v => {
                  await dbAny.from('dom_grupos_piloto').update({ ativo: v } as never).eq('group_jid', g.group_jid);
                  carregar();
                }} />
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* ---------------- ATENDENTES ---------------- */}
        <TabsContent value="atendentes" className="space-y-2 pt-3">
          <p className="text-[11px] text-muted-foreground">
            Quem recebe o aviso quando o cliente reclama, fala de dinheiro ou pede uma pessoa.
            Com mais de um, o rodízio entrega para quem faz mais tempo que não pega.
          </p>
          {atendentes.map((a, i) => (
            <Card key={a.id}>
              <CardContent className="p-3 flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">{i + 1}º</Badge>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{a.nome}</p>
                  <p className="text-[10px] text-muted-foreground">{a.whatsapp} · {a.escopo}</p>
                </div>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => moverAtendente(a, -1)}>
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => moverAtendente(a, 1)}>
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Switch checked={a.is_active} onCheckedChange={async v => {
                  await dbAny.from('dom_atendentes').update({ is_active: v } as never).eq('id', a.id);
                  carregar();
                }} />
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={async () => {
                  await dbAny.from('dom_atendentes').delete().eq('id', a.id);
                  carregar();
                }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </CardContent>
            </Card>
          ))}
          <Card>
            <CardContent className="p-3 flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <Label className="text-xs">Nome</Label>
                <Input className="h-8 text-xs" value={novoNome} onChange={e => setNovoNome(e.target.value)} />
              </div>
              <div className="flex-1 space-y-1">
                <Label className="text-xs">WhatsApp (com DDI)</Label>
                <Input className="h-8 text-xs" placeholder="5586999998888" value={novoZap}
                  onChange={e => setNovoZap(e.target.value)} />
              </div>
              <Button size="sm" className="h-8 text-xs gap-1" onClick={addAtendente}>
                <Plus className="h-3.5 w-3.5" />Adicionar
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- FILA ---------------- */}
        <TabsContent value="fila" className="space-y-2 pt-3">
          <p className="text-[11px] text-muted-foreground">
            O que o atendente escreveu e ainda não foi ao cliente. Clique para ler inteiro.
          </p>
          {fila.length === 0 && (
            <p className="text-xs text-muted-foreground">Nada na fila.</p>
          )}
          {fila.map(r => (
            <Card key={r.id} className="cursor-pointer hover:border-primary/40" onClick={() => {
              setAberto(r); setTextoEditado(r.resposta_sugerida);
            }}>
              <CardContent className="p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-medium flex-1 truncate">{r.group_name || '—'}</p>
                  {r.intencao && <Badge variant="outline" className="text-[10px]">{r.intencao}</Badge>}
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(r.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground truncate">
                  <strong>{r.pergunta_autor || 'Cliente'}:</strong> {r.pergunta}
                </p>
                <p className="text-[11px] truncate">{r.resposta_sugerida}</p>
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
                  {aberto.pergunta_autor} · intenção {aberto.intencao || '—'}
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
                <Textarea className="text-xs min-h-[180px]" value={textoEditado}
                  onChange={e => setTextoEditado(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="text-xs gap-1 flex-1"
                  onClick={() => decidirRascunho(aberto, textoEditado === aberto.resposta_sugerida ? 'aprovada' : 'editada', textoEditado)}>
                  <Check className="h-3.5 w-3.5" />Marcar como boa
                </Button>
                <Button size="sm" variant="outline" className="text-xs gap-1"
                  onClick={() => decidirRascunho(aberto, 'descartada')}>
                  <X className="h-3.5 w-3.5" />Descartar
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Marcar como boa não envia nada ao cliente — serve para o atendente aprender com a
                correção antes de sair do modo rascunho.
              </p>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
