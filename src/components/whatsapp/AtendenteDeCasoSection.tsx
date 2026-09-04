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
import { Trash2, ArrowUp, ArrowDown, Plus, Scale } from 'lucide-react';

const dbAny = db as unknown as SupabaseClient;

interface Voz { id: string; name: string; genero: 'masculina' | 'feminina' | null }
interface Grupo { group_jid: string; group_name: string | null; modo: string; ativo: boolean }
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

  const vozes = useMemo(() => [...VOZES_PRONTAS, ...vozesClonadas], [vozesClonadas]);

  const carregar = useCallback(async () => {
    if (!agentId) return;
    await ensureExternalSession();
    const [a, v, g, at] = await Promise.all([
      dbAny.from('wjia_command_shortcuts')
        .select('contexto_processual, nome_atendente, genero_voz, reply_voice_id')
        .eq('id', agentId).maybeSingle(),
      // As vozes clonadas moram no CLOUD; no Externo a mesma tabela tem RLS
      // `user_id = auth.uid()` com uuid do Cloud gravado — nunca casa.
      supabase.from('custom_voices').select('id, name').eq('status', 'ready').order('name'),
      dbAny.from('dom_grupos_piloto').select('group_jid, group_name, modo, ativo').order('group_name'),
      dbAny.from('dom_atendentes').select('id, nome, whatsapp, escopo, is_active, position').order('position'),
    ]);
    const cfg = a.data as any;
    setLigado(!!cfg?.contexto_processual);
    setNome(cfg?.nome_atendente || '');
    setGenero(cfg?.genero_voz ?? null);
    setVozId(cfg?.reply_voice_id ?? null);
    setVozesClonadas(((v.data as any[]) || []).map(x => ({ id: x.id, name: `🎤 ${x.name}`, genero: null })));
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
      .insert({ nome: novoNome.trim(), whatsapp: zap, escopo: 'geral', position: atendentes.length } as never);
    if (error) { toast.error(error.message); return; }
    setNovoNome(''); setNovoZap('');
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
                  {vozes.map(v => (
                    <SelectItem key={v.id} value={v.id} className="text-xs">
                      {v.name}{v.genero ? ` — ${v.genero}` : ''}
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

          {/* Grupos */}
          <div className="space-y-2">
            <Label className="text-xs">Grupos que ele atende</Label>
            <p className="text-[10px] text-muted-foreground">
              Fora desta lista ele fica mudo, mesmo ligado. É o freio de mão.
            </p>
            {grupos.length === 0 && <p className="text-[11px] text-muted-foreground">Nenhum grupo escolhido.</p>}
            {grupos.map(g => (
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
              </div>
            ))}
          </div>

          {/* Atendentes */}
          <div className="space-y-2">
            <Label className="text-xs">Quem recebe quando precisa de humano</Label>
            <p className="text-[10px] text-muted-foreground">
              Reclamação, dinheiro, prazo ou pedido de falar com alguém. Com mais de um,
              o rodízio entrega para quem faz mais tempo que não pega.
            </p>
            {atendentes.map((a, i) => (
              <div key={a.id} className="flex items-center gap-1.5 border rounded p-2">
                <Badge variant="outline" className="text-[10px]">{i + 1}º</Badge>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium truncate">{a.nome}</p>
                  <p className="text-[10px] text-muted-foreground">{a.whatsapp}</p>
                </div>
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
              <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" onClick={addAtendente}>
                <Plus className="h-3 w-3" />Adicionar
              </Button>
            </div>
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
