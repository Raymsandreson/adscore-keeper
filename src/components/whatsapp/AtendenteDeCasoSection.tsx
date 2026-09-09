/**
 * "Atende grupo de caso" — o que antes era uma aba inteira chamada Atendente
 * Virtual.
 *
 * O atendente de casos fechados nunca foi outra espécie de agente: é uma linha
 * da MESMA tabela dos outros, com três chaves ligadas (contexto processual,
 * responder em grupo, e a lista de grupos do piloto). Ter duas telas para
 * configurar a mesma tabela é o que fazia ninguém saber onde mexer.
 *
 * Escreve DIRETO em wjia_command_shortcuts, não pelo payload do formulário do
 * agente. Motivo: `whatsapp_ai_agents` é uma view, e nela `contexto_processual`
 * é `COALESCE(...)` — coluna computada não aceita UPDATE, e o save do
 * formulário quebraria inteiro por causa de um campo.
 *
 * O acompanhamento (fila, enviadas, com humano, silenciadas) NÃO mora aqui:
 * está em Monitor de Agentes → Atendente Virtual. Configurar é raro, olhar o
 * que aconteceu é diário — misturar os dois foi o que inchou esta tela.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { supabase } from '@/integrations/supabase/client';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Trash2, ArrowUp, ArrowDown, Plus, Scale, Search, Loader2 } from 'lucide-react';

const dbAny = db as unknown as SupabaseClient;

interface Voz {
  id: string; name: string; genero: 'masculina' | 'feminina' | null;
  /** Voz clonada que ainda nao pode falar — e o motivo, para a lista dizer. */
  situacao?: string | null;
}
interface Grupo {
  group_jid: string; group_name: string | null; modo: string; ativo: boolean;
  /** true = ele só lê números de processo ali, não responde. Fora da lista da tela. */
  so_varredura?: boolean;
}
interface Atendente { id: string; nome: string; whatsapp: string; escopo: string; is_active: boolean; position: number }

/** Vozes prontas do ElevenLabs, com o gênero que a edge list_presets declara. */
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

/**
 * O QUE CADA PESSOA RECEBE.
 *
 * Até 09/09/2026 esta tela cadastrava todo mundo como 'geral', e o rodízio
 * pedia sempre 'reclamacao' — então dinheiro, prazo e desistência caíam na
 * mesma fila. Dinheiro é a família em que responder errado custa dinheiro de
 * verdade, e quem responde valor quase nunca é quem acompanha o cliente no
 * grupo: virou escopo próprio (migration 20260909230000).
 *
 * 'geral' é o fallback da `pick_dom_atendente`: quem está aqui pega o que
 * sobrar dos escopos vazios. Deixar pelo menos uma pessoa em 'geral' é o que
 * garante que nenhuma pendência fique sem dono.
 */
const ESCOPOS: { valor: string; rotulo: string; ajuda: string }[] = [
  { valor: 'geral', rotulo: 'Tudo o que sobrar', ajuda: 'pega o que os outros escopos não cobrirem — deixe pelo menos uma pessoa aqui' },
  { valor: 'financeiro', rotulo: 'Dinheiro e cobrança', ajuda: 'valor, parcela, cobrança e pedido de adiantamento' },
  { valor: 'reclamacao', rotulo: 'Reclamação e desistência', ajuda: 'quem reclamou, quem falou em desistir, quem quer falar com gente' },
  { valor: 'saida_de_grupo', rotulo: 'Saiu do grupo', ajuda: 'cliente que saiu da conversa' },
];

const rotuloDoEscopo = (v: string) => ESCOPOS.find(e => e.valor === v)?.rotulo || v;

const MODOS: Record<string, string> = {
  rascunho: 'Rascunho — escreve e guarda. Nada chega ao cliente.',
  hibrido: 'Híbrido — envia o factual, guarda o sensível.',
  automatico: 'Automático — envia tudo, sem revisão.',
};

/** Voz masculina vira Dom, feminina vira Dora. Sem gênero, não chuta. */
const nomePeloGenero = (g: string | null | undefined) =>
  g === 'masculina' ? 'Dom' : g === 'feminina' ? 'Dora' : null;

export function AtendenteDeCasoSection({ agentId }: { agentId: string | null | undefined }) {
  const [ligado, setLigado] = useState(false);
  const [nome, setNome] = useState('');
  const [genero, setGenero] = useState<'masculina' | 'feminina' | null>(null);
  const [vozId, setVozId] = useState<string | null>(null);
  const [vozesClonadas, setVozesClonadas] = useState<Voz[]>([]);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [atendentes, setAtendentes] = useState<Atendente[]>([]);
  const [novoNome, setNovoNome] = useState('');
  const [novoZap, setNovoZap] = useState('');
  const [novoEscopo, setNovoEscopo] = useState('geral');
  const [buscaGrupo, setBuscaGrupo] = useState('');
  const [achadosGrupo, setAchadosGrupo] = useState<Grupo[]>([]);
  const [buscandoGrupo, setBuscandoGrupo] = useState(false);

  const vozes = useMemo(() => [...VOZES_PRONTAS, ...vozesClonadas], [vozesClonadas]);

  /**
   * Os que FOGEM do padrão — e é só isso que a tela desenha de saída.
   *
   * Medido em 09/09/2026: 1.149 grupos na lista, os 1.149 em rascunho e
   * ligados. Desenhar mil e cento e quarenta e nove linhas idênticas custa a
   * rolagem inteira e não diz nada; o que merece a tela é a exceção. Para
   * achar um grupo específico existe a busca logo acima.
   *
   * useMemo porque a lista passa de cem itens e o componente redesenha a cada
   * troca de voz, nome ou atendente.
   */
  const foraDoPadrao = useMemo(
    () => grupos.filter(g => g.modo !== 'rascunho' || !g.ativo),
    [grupos],
  );

  /**
   * A busca vai ao BANCO, e não à lista carregada.
   *
   * Filtrar em memória só acharia os 1.149 que já atende — e metade do pedido
   * é incluir um grupo NOVO, que hoje está entre os 1.335 de só varredura e
   * por isso nem foi carregado. Uma consulta por termo, com teto de 30: é a
   * mesma forma da busca de grupos do painel do atendente.
   */
  useEffect(() => {
    const termo = buscaGrupo.trim();
    if (termo.length < 2) { setAchadosGrupo([]); setBuscandoGrupo(false); return; }
    setBuscandoGrupo(true);
    // Espera a pessoa parar de digitar: sem isto sai uma consulta por tecla.
    const t = setTimeout(async () => {
      const { data } = await dbAny.from('dom_grupos_piloto')
        .select('group_jid, group_name, modo, ativo, so_varredura')
        .ilike('group_name', `%${termo}%`)
        .order('group_name')
        .limit(30);
      setAchadosGrupo((data as unknown as Grupo[]) || []);
      setBuscandoGrupo(false);
    }, 350);
    return () => clearTimeout(t);
  }, [buscaGrupo]);

  /** Trocar o modo de um grupo, venha ele da lista ou da busca. */
  const trocarModoGrupo = async (g: Grupo, modo: string) => {
    const { error } = await dbAny.from('dom_grupos_piloto')
      .update({ modo } as never).eq('group_jid', g.group_jid);
    if (error) { toast.error(error.message); return; }
    setAchadosGrupo(a => a.map(x => (x.group_jid === g.group_jid ? { ...x, modo } : x)));
    carregar();
  };

  /**
   * Tirar da lista, ou trazer para ela.
   *
   * "Tirar" NÃO apaga: vira `so_varredura`, que é o estado em que ele continua
   * lendo número de processo naquele grupo e para de falar lá. Apagar a linha
   * perderia a varredura junto, e a varredura é o que faz processo citado pela
   * equipe entrar sozinho na ficha. Reversível pelo mesmo botão.
   */
  const mudarVarredura = async (g: Grupo, so: boolean) => {
    const { error } = await dbAny.from('dom_grupos_piloto')
      .update({ so_varredura: so, ativo: !so } as never).eq('group_jid', g.group_jid);
    if (error) { toast.error(error.message); return; }
    toast.success(so
      ? `${g.group_name || 'Grupo'} saiu da lista — continua só na varredura`
      : `${g.group_name || 'Grupo'} entrou na lista, em rascunho`);
    setAchadosGrupo(a => a.map(x => (
      x.group_jid === g.group_jid ? { ...x, so_varredura: so, ativo: !so } : x)));
    carregar();
  };

  const carregar = useCallback(async () => {
    if (!agentId) return;
    await ensureExternalSession();
    const [a, v, g, at] = await Promise.all([
      dbAny.from('wjia_command_shortcuts')
        .select('contexto_processual, nome_atendente, genero_voz, reply_voice_id')
        .eq('id', agentId).maybeSingle(),
      // As vozes clonadas moram no CLOUD; no Externo a mesma tabela tem RLS
      // `user_id = auth.uid()` com uuid do Cloud gravado — nunca casa.
      // TODAS as vozes clonadas, e nao so as prontas. Filtrar aqui fazia a voz
      // que ainda esta sendo preparada sumir da lista sem uma palavra — e quem
      // acabou de mandar clonar procura por ela, nao acha, e conclui que a
      // clonagem falhou. Ela aparece, desabilitada, dizendo em que pe esta.
      supabase.from('custom_voices').select('id, name, status').order('name'),
      // `so_varredura = false`: desde 08/09/2026 a tabela também guarda os
      // grupos de caso onde o Dom NÃO fala, só para a varredura de processos
      // citados. São 1.331 — aqui é a lista de onde o Dom responde, não a
      // lista de tudo que o sistema lê.
      dbAny.from('dom_grupos_piloto').select('group_jid, group_name, modo, ativo, so_varredura').eq('so_varredura', false).order('group_name'),
      dbAny.from('dom_atendentes').select('id, nome, whatsapp, escopo, is_active, position').order('position'),
    ]);
    const cfg = a.data as any;
    setLigado(!!cfg?.contexto_processual);
    setNome(cfg?.nome_atendente || '');
    setGenero(cfg?.genero_voz ?? null);
    setVozId(cfg?.reply_voice_id ?? null);
    setVozesClonadas(((v.data as any[]) || []).map(x => ({
      id: x.id,
      name: `🎤 ${x.name}`,
      genero: null,
      situacao: x.status === 'ready' ? null : (x.status || 'sem status'),
    })));
    setGrupos((g.data as Grupo[]) || []);
    setAtendentes((at.data as Atendente[]) || []);
  }, [agentId]);

  useEffect(() => { carregar(); }, [carregar]);

  const salvar = async (patch: Record<string, unknown>) => {
    if (!agentId) return;
    const { error } = await dbAny.from('wjia_command_shortcuts').update(patch as never).eq('id', agentId);
    if (error) { toast.error('Não salvou: ' + error.message); carregar(); return; }
    toast.success('Salvo');
  };

  /** Trocar a voz reescreve o nome, mas nome digitado à mão sobrevive. */
  const aplicarGenero = async (g: 'masculina' | 'feminina' | null, extra: Record<string, unknown> = {}) => {
    const sugerido = nomePeloGenero(g);
    const eraAutomatico = !nome || nome === 'Dom' || nome === 'Dora';
    setGenero(g);
    if (sugerido && eraAutomatico) setNome(sugerido);
    await salvar({ ...extra, genero_voz: g, ...(sugerido && eraAutomatico ? { nome_atendente: sugerido } : {}) });
  };

  const trocarVoz = async (id: string) => {
    setVozId(id);
    await aplicarGenero(vozes.find(v => v.id === id)?.genero ?? null, { reply_voice_id: id });
  };

  const moverAtendente = async (a: Atendente, delta: number) => {
    const mesmos = atendentes.filter(x => x.escopo === a.escopo);
    const troca = mesmos[mesmos.findIndex(x => x.id === a.id) + delta];
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
    const { error } = await dbAny.from('dom_atendentes')
      .insert({ nome: novoNome.trim(), whatsapp: zap, escopo: novoEscopo, position: atendentes.length } as never);
    if (error) { toast.error(error.message); return; }
    setNovoNome(''); setNovoZap(''); setNovoEscopo('geral');
    carregar();
  };

  if (!agentId) {
    return (
      <div className="border rounded-lg p-3">
        <Label className="text-xs flex items-center gap-1.5"><Scale className="h-3.5 w-3.5" />Atende grupo de caso</Label>
        <p className="text-[10px] text-muted-foreground mt-1">Salve o agente primeiro para configurar isto.</p>
      </div>
    );
  }

  const precisaGenero = !!vozId && vozes.find(v => v.id === vozId)?.genero == null;

  return (
    <div className="border rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <Label className="text-xs flex items-center gap-1.5"><Scale className="h-3.5 w-3.5" />Atende grupo de caso</Label>
          <p className="text-[10px] text-muted-foreground">
            O agente passa a receber o andamento real dos processos daquele cliente e só
            fala nos grupos escolhidos abaixo. Para caso fechado, não para lead novo.
          </p>
        </div>
        <Switch checked={ligado} onCheckedChange={v => { setLigado(v); salvar({ contexto_processual: v }); }} />
      </div>

      {ligado && (
        <div className="pl-2 border-l-2 border-primary/20 space-y-4">
          {/* Identidade */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Voz</Label>
              <Select value={vozId || ''} onValueChange={trocarVoz}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Escolha a voz" /></SelectTrigger>
                <SelectContent>
                  {vozes.length === VOZES_PRONTAS.length && (
                    <p className="px-2 py-1.5 text-[10px] text-muted-foreground">
                      Nenhuma voz clonada chegou aqui. Clonagem que existe mas não aparece
                      quase sempre é sessão sem permissão de leitura em custom_voices.
                    </p>
                  )}
                  {vozes.map(v => (
                    <SelectItem key={v.id} value={v.id} className="text-xs" disabled={!!v.situacao}>
                      {v.name}{v.genero ? ` — ${v.genero}` : ''}
                      {v.situacao && (
                        <span className="text-[10px] text-amber-700"> — ainda não dá para usar ({v.situacao})</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {precisaGenero && (
                <div className="pt-1 space-y-1">
                  <Label className="text-[10px] text-amber-700">Voz clonada não diz o gênero. Qual é?</Label>
                  <Select value={genero || ''} onValueChange={v => aplicarGenero(v as 'masculina' | 'feminina')}>
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
              <Input className="h-8 text-xs" value={nome} placeholder={nomePeloGenero(genero) || 'Dom ou Dora'}
                onChange={e => setNome(e.target.value)}
                onBlur={e => salvar({ nome_atendente: e.target.value.trim() || null })} />
              <p className="text-[10px] text-muted-foreground">
                Voz masculina vira <strong>Dom</strong>, feminina vira <strong>Dora</strong>. Dá para trocar.
              </p>
            </div>
          </div>

          {/* Atendentes */}
          <div className="space-y-2">
            <Label className="text-xs">Quem recebe quando precisa de humano</Label>
            <p className="text-[10px] text-muted-foreground">
              Cada pessoa recebe o que o escopo dela diz. Com mais de uma no mesmo escopo,
              o rodízio entrega para quem faz mais tempo que não pega. Escopo sem ninguém
              cai em <strong>Tudo o que sobrar</strong> — por isso nenhuma pendência fica
              sem dono, mesmo com um escopo vazio.
            </p>
            {atendentes.map((a, i) => (
              <div key={a.id} className="flex items-center gap-1.5 border rounded p-2">
                <Badge variant="outline" className="text-[10px]">{i + 1}º</Badge>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium truncate">{a.nome}</p>
                  <p className="text-[10px] text-muted-foreground">{a.whatsapp}</p>
                </div>
                {/* O escopo é editável na própria linha: trocar quem cuida do
                    dinheiro não pode exigir apagar e cadastrar de novo. */}
                <Select value={a.escopo} onValueChange={async v => {
                  const { error } = await dbAny.from('dom_atendentes')
                    .update({ escopo: v } as never).eq('id', a.id);
                  if (error) { toast.error(error.message); return; }
                  toast.success(`${a.nome} passa a receber: ${rotuloDoEscopo(v).toLowerCase()}`);
                  carregar();
                }}>
                  <SelectTrigger className="h-7 w-[150px] text-[10px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ESCOPOS.map(e => (
                      <SelectItem key={e.valor} value={e.valor} className="text-[11px]">{e.rotulo}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => moverAtendente(a, -1)}>
                  <ArrowUp className="h-3 w-3" />
                </Button>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => moverAtendente(a, 1)}>
                  <ArrowDown className="h-3 w-3" />
                </Button>
                <Switch checked={a.is_active} onCheckedChange={async v => {
                  await dbAny.from('dom_atendentes').update({ is_active: v } as never).eq('id', a.id);
                  carregar();
                }} />
                <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={async () => {
                  await dbAny.from('dom_atendentes').delete().eq('id', a.id);
                  carregar();
                }}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <Label className="text-[10px]">Nome</Label>
                <Input className="h-7 text-[11px]" value={novoNome} onChange={e => setNovoNome(e.target.value)} />
              </div>
              <div className="flex-1 space-y-1">
                <Label className="text-[10px]">WhatsApp (com DDI)</Label>
                <Input className="h-7 text-[11px]" placeholder="5586999998888" value={novoZap}
                  onChange={e => setNovoZap(e.target.value)} />
              </div>
              <div className="flex-1 space-y-1">
                <Label className="text-[10px]">Recebe o quê</Label>
                <Select value={novoEscopo} onValueChange={setNovoEscopo}>
                  <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ESCOPOS.map(e => (
                      <SelectItem key={e.valor} value={e.valor} className="text-[11px]">{e.rotulo}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" onClick={addAtendente}>
                <Plus className="h-3 w-3" />Adicionar
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {ESCOPOS.map(e => `${e.rotulo}: ${e.ajuda}`).join(' · ')}
            </p>
          </div>

          {/* Grupos */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs">Grupos que ele atende</Label>
              <Badge variant="outline" className="text-[10px]">{grupos.length}</Badge>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Fora desta lista ele fica mudo, mesmo ligado. É o freio de mão.
            </p>

            {/* A BUSCA VEM ANTES DA LISTA, E A LISTA ENCOLHEU.
                Eram 1.149 linhas desenhadas de uma vez — e as 1.149 diziam a
                MESMA coisa (rascunho, ligado). Uma lista em que toda linha é
                igual não informa nada e ainda enterra tudo o que vem depois:
                para chegar em "quem recebe as pendências" era preciso rolar os
                mil e cento e quarenta e nove.

                Então o padrão passou a ser o contrário: aparecem só os que
                FOGEM do padrão, mais o que a busca achar. A busca vai ao banco
                e alcança também os 1.335 que hoje são só varredura — é assim
                que dá para INCLUIR um grupo, e não só mexer nos que já estão. */}
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input
                className="h-8 pl-7 text-[11px]"
                placeholder="Procurar grupo pelo nome — inclusive os que ainda não atende"
                value={buscaGrupo}
                onChange={e => setBuscaGrupo(e.target.value)}
              />
              {buscandoGrupo && (
                <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin text-muted-foreground" />
              )}
            </div>

            {buscaGrupo.trim().length >= 2 ? (
              achadosGrupo.length === 0 && !buscandoGrupo ? (
                <p className="text-[11px] text-muted-foreground">Nenhum grupo com esse nome.</p>
              ) : (
                achadosGrupo.map(g => (
                  <div key={g.group_jid} className="flex items-center gap-2 border rounded p-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium truncate">{g.group_name || g.group_jid}</p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {g.so_varredura
                          ? 'Só varredura — ele lê os números de processo, mas não fala aqui.'
                          : MODOS[g.modo]}
                      </p>
                    </div>
                    {g.so_varredura ? (
                      <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1"
                        onClick={() => mudarVarredura(g, false)}>
                        <Plus className="h-3 w-3" />Passar a atender
                      </Button>
                    ) : (
                      <>
                        <Select value={g.modo} onValueChange={v => trocarModoGrupo(g, v)}>
                          <SelectTrigger className="h-7 w-28 text-[11px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {Object.keys(MODOS).map(k => (
                              <SelectItem key={k} value={k} className="text-xs">{k}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button size="sm" variant="ghost" className="h-7 text-[11px] text-destructive"
                          onClick={() => mudarVarredura(g, true)}>
                          Tirar
                        </Button>
                      </>
                    )}
                  </div>
                ))
              )
            ) : (
              <>
                <p className="text-[10px] text-muted-foreground">
                  {foraDoPadrao.length === 0
                    ? `Os ${grupos.length} estão no padrão: rascunho e ligados. Procure pelo nome para mexer num deles.`
                    : `Fora do padrão (${foraDoPadrao.length} de ${grupos.length}). O resto está em rascunho e ligado — procure pelo nome para achar um específico.`}
                </p>
                {foraDoPadrao.map(g => (
              <div key={g.group_jid} className="flex items-center gap-2 border rounded p-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium truncate">{g.group_name || g.group_jid}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{MODOS[g.modo]}</p>
                </div>
                <Select value={g.modo} onValueChange={async v => {
                  await dbAny.from('dom_grupos_piloto').update({ modo: v } as never).eq('group_jid', g.group_jid);
                  carregar();
                }}>
                  <SelectTrigger className="h-7 w-28 text-[11px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.keys(MODOS).map(k => (
                      <SelectItem key={k} value={k} className="text-xs">{k}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Switch checked={g.ativo} onCheckedChange={async v => {
                  await dbAny.from('dom_grupos_piloto').update({ ativo: v } as never).eq('group_jid', g.group_jid);
                  carregar();
                }} />
                <Button size="sm" variant="ghost" className="h-7 text-[11px] text-destructive"
                  onClick={() => mudarVarredura(g, true)}>
                  Tirar
                </Button>
              </div>
                ))}
              </>
            )}
          </div>

          <p className="text-[10px] text-muted-foreground">
            Para ver o que ele escreveu, o que foi enviado e o que ele decidiu não responder:
            <strong> Monitor de Agentes → Atendente Virtual</strong>.
          </p>
        </div>
      )}
    </div>
  );
}
