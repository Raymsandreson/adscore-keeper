import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Loader2, Volume2, Send, MessageCircle, Sparkles, CheckCircle2, Play, Square, Mic, AlertTriangle } from 'lucide-react';
import { ensureExternalSession, externalSupabase } from '@/integrations/supabase/external-client';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { AUDIO_TONES, gerarTextoNarracao, gerarAudioNarracao } from '@/lib/activityAudioNarration';
import { toast } from 'sonner';

/**
 * Tela de voz do WhatsApp, carregada só quando alguém abre "Criar/trocar minha
 * voz". É pesada (AudioContext, gravação de mic e de tela) e a esmagadora
 * maioria das conclusões nunca a abre — import estático colocaria isso no
 * caminho de TODO "Concluir + próxima".
 */
const VoiceSettings = lazy(() =>
  import('@/components/voice/VoiceSettings').then(m => ({ default: m.VoiceSettings })),
);


export interface GroupOption {
  id: string;
  label: string;
  group_jid: string;
  group_name: string | null;
}

/**
 * Grupos do lead no formato do seletor deste dialog.
 *
 * Extraída do efeito abaixo para que a ficha da atividade possa pré-carregar os
 * grupos enquanto o usuário ainda preenche o formulário (ver `preloadedGroups`).
 * A busca é a mesma de sempre: `lead_whatsapp_groups` primeiro e o campo legado
 * `leads.whatsapp_group_id` só quando não há nenhum vinculado — o segundo
 * round-trip existe apenas nesse caso.
 *
 * Lista vazia aqui significa "este lead não tem grupo", e o dialog desliga a
 * notificação por causa dela. Então falha NÃO pode virar lista vazia:
 *  - a policy do `lead_whatsapp_groups` é `TO authenticated`; sem sessão o
 *    PostgREST devolve `[]` (zero linhas), não erro — daí o `ensureExternalSession`
 *    antes da query. Enquanto a busca só acontecia no clique o problema não
 *    aparecia (a sessão já estava de pé); com o pré-carregamento junto da ficha
 *    ela passou a correr com o bootstrap;
 *  - erro de rede/permissão sobe como exceção, e quem chamou trata (o preload
 *    guarda `null` e o dialog volta a buscar no clique).
 * Incidente 17/08/2026: "Concluir + próxima" parou de mandar áudio ao grupo em
 * silêncio — o dialog exibia "(nenhum grupo vinculado)" para lead com grupo.
 */
export async function fetchLeadGroupOptions(leadId: string): Promise<GroupOption[]> {
  await ensureExternalSession();

  const { data, error } = await externalSupabase
    .from('lead_whatsapp_groups')
    .select('id, label, group_jid, group_name')
    .eq('lead_id', leadId);
  if (error) throw error;

  const groupOptions: GroupOption[] = (data || [])
    .filter((g: any) => g.group_jid)
    .map((g: any) => ({
      id: g.id,
      label: g.label || g.group_name || g.group_jid,
      group_jid: g.group_jid,
      group_name: g.group_name,
    }));

  // Also check legacy whatsapp_group_id on leads table
  if (groupOptions.length === 0) {
    // Externo: é onde os leads vivem. Lendo o legado do Cloud, o texto podia
    // ir para um grupo diferente do que o áudio (que lê do externo) usa.
    const { data: lead, error: leadError } = await externalSupabase
      .from('leads')
      .select('whatsapp_group_id, lead_name')
      .eq('id', leadId)
      .maybeSingle();
    if (leadError) throw leadError;
    if (lead?.whatsapp_group_id) {
      groupOptions.push({
        id: 'legacy',
        label: `Grupo ${lead.lead_name || 'do Lead'}`,
        group_jid: lead.whatsapp_group_id,
        group_name: lead.lead_name,
      });
    }
  }

  return groupOptions;
}

/**
 * Quem o cliente vai ouvir.
 *
 * O `elevenlabs-tts` resolve a voz por `voice_preferences` do usuário
 * autenticado e, quando não acha nenhuma, cai numa voz de catálogo (Laura). Ou
 * seja: sem preferência gravada, o cliente ouve uma mulher genérica contando o
 * que o responsável pelo processo fez. Medido em 14/09/2026 no Externo: 10
 * vozes clonadas prontas em `custom_voices` e apenas 2 linhas em
 * `voice_preferences` — 8 pessoas clonaram a própria voz e nunca a
 * selecionaram, então o áudio delas sairia com a voz do catálogo.
 *
 * Por isso o dialog mostra a voz ANTES de enviar, e oferece o atalho de um
 * clique ("usar minha voz") ou a tela de criar.
 */
interface VozDoMembro {
  /** Preferência gravada, se houver. `cloned` = voz da própria pessoa. */
  preferencia: { voice_id: string; voice_name: string; voice_type: string } | null;
  /** Vozes clonadas da pessoa que já estão prontas para uso. */
  minhasVozes: { id: string; name: string; elevenlabs_voice_id: string | null; status: string }[];
}

/**
 * Áudio da prévia. Guarda a "chave" (mensagem + tom) que o gerou: se qualquer
 * uma mudar depois, a prévia não vale mais e o envio gera de novo — o cliente
 * nunca recebe um áudio diferente do que foi ouvido aqui.
 */
interface PreviaGerada {
  chave: string;
  /**
   * Mensagem que originou a narração. Enquanto o pop-up está aberto o
   * formulário atrás dele não muda, então a validade na TELA olha só a chave —
   * chamar `buildMsg()` a cada render recalcularia a mensagem inteira (incluindo
   * o progresso hierárquico dos checklists) a cada tecla do tom personalizado.
   * A mensagem é conferida uma vez, no confirmar, onde ela já é montada.
   */
  mensagem: string;
  texto: string;
  audioUrl: string;
  /** `false` = a IA falhou e o áudio é a leitura da mensagem, sem resumir. */
  resumido: boolean;
  /** Voz que o TTS de fato usou, quando a função informa. */
  voiceName?: string;
}

const chaveDaPrevia = (tone: string, customPrompt: string) =>
  `${tone}|${tone === 'custom' ? customPrompt.trim() : ''}`;

/**
 * Id do usuário logado, do jeito que a tela de voz do WhatsApp já faz
 * (`elevenlabs-voice-clone` exige `user_id` no corpo). Import dinâmico porque o
 * client do Cloud lê variáveis de ambiente na carga do módulo — estático,
 * entraria no grafo de todo teste que renderiza este dialog.
 */
async function idDoUsuarioLogado(): Promise<string | null> {
  try {
    const { authClient } = await import('@/integrations/supabase');
    const { data } = await authClient.auth.getSession();
    return data.session?.user?.id || null;
  } catch {
    return null;
  }
}

interface CompleteAndNotifyDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (notifyOptions?: { groupJid: string; message: string; sendAudio: boolean; audioText?: string; audioUrl?: string }) => Promise<void>;
  leadId: string | null;
  buildMsg: (() => string) | null;
  /**
   * Grupos já buscados pela ficha para ESTE lead. Quando vem preenchido, o
   * dialog abre sem round-trip e sem spinner. `null` mantém a busca no clique
   * (lead ainda carregando, preload falhou ou grupo vinculado agora há pouco).
   */
  preloadedGroups?: GroupOption[] | null;
}

export function CompleteAndNotifyDialog({ open, onClose, onConfirm, leadId, buildMsg, preloadedGroups = null }: CompleteAndNotifyDialogProps) {
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Choices
  const [notifyGroup, setNotifyGroup] = useState<'yes' | 'no'>('no');
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [sendAudio, setSendAudio] = useState(false);
  const [audioTone, setAudioTone] = useState('humanized');
  const [customPrompt, setCustomPrompt] = useState('');
  const [generatingAudioText, setGeneratingAudioText] = useState(false);

  // Voz de quem está concluindo, prévia e a tela de criar voz — ver VozDoMembro.
  const [voz, setVoz] = useState<VozDoMembro | null>(null);
  const [vozCarregando, setVozCarregando] = useState(false);
  /** A leitura da voz falhou — diferente de "esta pessoa não tem voz". */
  const [vozErro, setVozErro] = useState(false);
  const [vozSalvando, setVozSalvando] = useState(false);
  const [vozSheetOpen, setVozSheetOpen] = useState(false);
  const [previa, setPrevia] = useState<PreviaGerada | null>(null);
  const [previaGerando, setPreviaGerando] = useState(false);
  const [previaTocando, setPreviaTocando] = useState(false);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  /**
   * Guarda contra resposta que chega depois do dialog sair da tela: o
   * "Concluir + próxima" fecha assim que confirma, e a leitura da voz é uma ida
   * de rede que pode voltar depois. Sem isto, o setState órfão vira
   * "Unhandled Rejection" no teardown dos testes — o mesmo ruído que o
   * src/test/setup.ts documenta como fonte de falso positivo.
   */
  const vivoRef = useRef(true);
  useEffect(() => {
    vivoRef.current = true;
    return () => { vivoRef.current = false; };
  }, []);

  // Lido por ref, e não como dependência: se o preload chegasse com o dialog já
  // aberto, reexecutar o efeito apagaria a escolha que o usuário acabou de fazer.
  const preloadedRef = useRef(preloadedGroups);
  preloadedRef.current = preloadedGroups;

  // Fetch groups for the lead
  useEffect(() => {
    if (!open || !leadId) return;
    // Zera antes de buscar: sem isso, os grupos do lead ANTERIOR continuam em
    // memória enquanto a query está em voo (e ficam para sempre se ela falhar).
    // Foi assim que a notificação de um cliente foi parar no grupo de outro em
    // 13/07 e 30/07/2026.
    setGroups([]);
    setSelectedGroupId('');
    setNotifyGroup('no');
    setSendAudio(false);

    const aplicar = (groupOptions: GroupOption[]) => {
      setGroups(groupOptions);
      if (groupOptions.length === 1) setSelectedGroupId(groupOptions[0].id);
      if (groupOptions.length > 0) setNotifyGroup('yes');
      // Áudio JUNTO por padrão sempre que há grupo: era opt-in escondido atrás
      // de um checkbox, e quem concluía acabava gravando o áudio na mão depois
      // de mandar o texto — porque boa parte dos clientes não lê a mensagem.
      // Continua desmarcável, caso a caso.
      setSendAudio(groupOptions.length > 0);
      setLoading(false);
    };

    // Ficha já buscou os grupos deste lead: abre pronto, sem round-trip e sem
    // spinner. Buscar no clique era o gargalo do "Concluir + próxima" — 1 a 2
    // idas ao banco por atividade, multiplicadas pela fila do modo workflow.
    const preloaded = preloadedRef.current;
    if (preloaded) {
      aplicar(preloaded);
      return;
    }

    setLoading(true);
    let cancelado = false;
    (async () => {
      const groupOptions = await fetchLeadGroupOptions(leadId);
      // Resposta de um lead que não está mais aberto não pode virar destino.
      if (cancelado) return;
      aplicar(groupOptions);
    })().catch(() => {
      if (cancelado) return;
      setLoading(false);
      toast.error('Não foi possível carregar os grupos do lead. Notificação desativada.');
    });
    return () => { cancelado = true; };
  }, [open, leadId]);

  /**
   * Carrega a voz do membro quando o áudio está ligado. Só roda com o dialog
   * aberto e o áudio marcado: quem desmarca não paga nem uma ida de rede.
   */
  const carregarVoz = useCallback(async () => {
    setVozCarregando(true);
    setVozErro(false);
    try {
      if (!vivoRef.current) return;
      const uid = await idDoUsuarioLogado();
      const { data } = await cloudFunctions.invoke('elevenlabs-voice-clone', {
        body: { action: 'list_presets', user_id: uid },
      });
      const resposta = data as {
        preference?: VozDoMembro['preferencia'];
        custom_voices?: VozDoMembro['minhasVozes'];
      } | null;
      if (!vivoRef.current) return;
      setVoz({
        preferencia: resposta?.preference || null,
        minhasVozes: (resposta?.custom_voices || []).filter(v => v.status === 'ready' && v.elevenlabs_voice_id),
      });
    } catch (e) {
      console.warn('[CompleteAndNotifyDialog] não deu para ler a voz do membro:', e);
      // Erro NÃO pode virar "você não tem voz própria": seria o mesmo vício do
      // incidente 17/08/2026, em que falha na busca dos grupos chegava à tela
      // como "(nenhum grupo vinculado)" e desligava a notificação calada.
      if (vivoRef.current) { setVoz(null); setVozErro(true); }
    } finally {
      if (vivoRef.current) setVozCarregando(false);
    }
  }, []);

  /**
   * Uma tentativa por abertura. O controle é um ref, e não `voz`/`vozCarregando`
   * nas dependências: quando a leitura falha, `voz` continua `null` e o efeito
   * dispararia de novo a cada render — um laço infinito de chamadas de rede,
   * multiplicado pela fila do modo workflow.
   */
  const vozBuscadaRef = useRef(false);
  useEffect(() => {
    if (!open || !sendAudio || vozBuscadaRef.current) return;
    vozBuscadaRef.current = true;
    carregarVoz();
  }, [open, sendAudio, carregarVoz]);

  /** Passa a usar a voz clonada da própria pessoa (o clique que faltava). */
  const usarMinhaVoz = async (voiceId: string, voiceName: string) => {
    setVozSalvando(true);
    try {
      const uid = await idDoUsuarioLogado();
      const { error } = await cloudFunctions.invoke('elevenlabs-voice-clone', {
        body: { action: 'set_preference', voice_type: 'cloned', voice_id: voiceId, voice_name: voiceName, user_id: uid },
      });
      if (error) throw error;
      setVoz(v => (v ? { ...v, preferencia: { voice_id: voiceId, voice_name: voiceName, voice_type: 'cloned' } } : v));
      // A voz mudou: a prévia anterior é de outra pessoa.
      setPrevia(null);
      toast.success(`Pronto — o áudio vai sair com a voz "${voiceName}".`);
    } catch {
      toast.error('Não foi possível selecionar a voz.');
    } finally {
      setVozSalvando(false);
    }
  };

  const pararPrevia = useCallback(() => {
    audioElRef.current?.pause();
    setPreviaTocando(false);
  }, []);

  /**
   * Gera (ou retoca) o áudio que o cliente vai receber e toca aqui dentro.
   *
   * É o mesmo caminho do envio — `gerarTextoNarracao` + `gerarAudioNarracao` —
   * e o MP3 gerado aqui é o que segue para o grupo no confirmar. Ouvir custa
   * uma geração, não duas.
   */
  const ouvirPrevia = async () => {
    if (previaTocando) {
      pararPrevia();
      return;
    }

    const message = buildMsg ? buildMsg() : '';
    if (!message.trim()) {
      toast.error('A mensagem da atividade está vazia — não há o que narrar.');
      return;
    }

    const chave = chaveDaPrevia(audioTone, customPrompt);
    let atual = previa && previa.chave === chave && previa.mensagem === message ? previa : null;

    if (!atual) {
      setPreviaGerando(true);
      try {
        const { texto, resumido } = await gerarTextoNarracao(message, audioTone, customPrompt);
        const { audioUrl, voiceName } = await gerarAudioNarracao(texto);
        atual = { chave, mensagem: message, texto, audioUrl, resumido, voiceName };
        setPrevia(atual);
      } catch (e) {
        toast.error(`Prévia não gerada: ${(e instanceof Error && e.message) || 'falha na geração de voz'}`);
        return;
      } finally {
        setPreviaGerando(false);
      }
    }

    try {
      const el = audioElRef.current ?? new Audio();
      audioElRef.current = el;
      if (el.src !== atual.audioUrl) el.src = atual.audioUrl;
      el.onended = () => setPreviaTocando(false);
      el.onerror = () => { setPreviaTocando(false); toast.error('Não foi possível tocar a prévia.'); };
      await el.play();
      setPreviaTocando(true);
    } catch {
      setPreviaTocando(false);
      toast.error('Não foi possível tocar a prévia.');
    }
  };

  // Reset on close
  useEffect(() => {
    if (!open) {
      setGroups([]);
      setNotifyGroup('no');
      setSelectedGroupId('');
      setSendAudio(false);
      setAudioTone('humanized');
      setCustomPrompt('');
      setPrevia(null);
      setVoz(null);
      setVozErro(false);
      vozBuscadaRef.current = false;
      audioElRef.current?.pause();
      audioElRef.current = null;
      setPreviaTocando(false);
    }
  }, [open]);

  const handleConfirm = async () => {
    pararPrevia();
    setSubmitting(true);
    try {
      if (notifyGroup === 'yes' && selectedGroupId) {
        const group = groups.find(g => g.id === selectedGroupId);
        if (!group) {
          toast.error('Selecione um grupo');
          setSubmitting(false);
          return;
        }

        const message = buildMsg ? buildMsg() : '';
        let audioText: string | undefined;
        let audioUrl: string | undefined;

        if (sendAudio && message) {
          // Prévia ouvida agora há pouco para ESTA mensagem e ESTE tom: vai o
          // áudio que a pessoa ouviu, sem nova geração (e sem pagar de novo).
          const chave = chaveDaPrevia(audioTone, customPrompt);
          if (previa && previa.chave === chave && previa.mensagem === message) {
            audioText = previa.texto;
            audioUrl = previa.audioUrl;
          } else {
            setGeneratingAudioText(true);
            try {
              audioText = (await gerarTextoNarracao(message, audioTone, customPrompt)).texto;
            } finally {
              setGeneratingAudioText(false);
            }
          }
        }

        await onConfirm({
          groupJid: group.group_jid,
          message,
          sendAudio,
          audioText,
          audioUrl,
        });
      } else {
        await onConfirm();
      }
    } finally {
      setSubmitting(false);
      onClose();
    }
  };

  const hasGroups = groups.length > 0;
  const isProcessing = submitting || generatingAudioText;

  /** Preferência gravada apontando para uma voz clonada = é a voz da pessoa. */
  const vozPropria = voz?.preferencia?.voice_type === 'cloned' && !!voz?.preferencia?.voice_name;
  /** Voz clonada pronta, esperando um clique para virar a preferência. */
  const vozClonadaDisponivel = voz?.minhasVozes.find(v => v.elevenlabs_voice_id) || null;
  const previaValida = !!previa && previa.chave === chaveDaPrevia(audioTone, customPrompt);

  /*
   * NÃO voltar a avisar aqui que "o prazo foi alterado".
   *
   * O aviso existiu entre 14/08 e 17/08/2026 (commit e35e37ecb) porque o
   * "Concluir + próxima" era usado como adiar, na falta de um Adiar de verdade.
   * O Adiar passou a existir no mesmo dia (87d01cbd7) e mora no action bar, ao
   * lado deste botão — a saída certa não precisa ser reoferecida dentro do
   * pop-up.
   *
   * E o aviso não distinguia nada: medido nos 1.000 elos de cadeia mais
   * recentes, 946 (94,6%) nascem com prazo MAIOR que o da mãe, contra 53 que
   * repetem a data. A data nova é justamente a da próxima etapa — mudá-la é o
   * caminho normal. Aviso que dispara em 19 de cada 20 cliques só ensina a
   * clicar por cima.
   *
   * O fluxo correto, e o que o código faz: a mãe fica concluída com a data em
   * que ela venceu, a próxima nasce na data nova.
   */

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5" />
            Concluir e Criar Próxima Atividade
          </DialogTitle>
          <DialogDescription>
            Deseja notificar o grupo do WhatsApp sobre esta atividade?
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Notify or not */}
            <RadioGroup value={notifyGroup} onValueChange={(v: 'yes' | 'no') => setNotifyGroup(v)}>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="yes" id="notify-yes" disabled={!hasGroups} />
                <Label htmlFor="notify-yes" className={!hasGroups ? 'text-muted-foreground' : ''}>
                  Notificar no grupo
                  {!hasGroups && <span className="text-xs ml-1">(nenhum grupo vinculado)</span>}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="no" id="notify-no" />
                <Label htmlFor="notify-no">Não notificar</Label>
              </div>
            </RadioGroup>

            {/* Group selection */}
            {notifyGroup === 'yes' && hasGroups && (
              <div className="space-y-3 pl-1 border-l-2 border-primary/20 ml-2">
                {groups.length > 1 && (
                  <div className="pl-3">
                    <Label className="text-xs text-muted-foreground mb-1 block">Qual grupo?</Label>
                    <Select value={selectedGroupId} onValueChange={setSelectedGroupId}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Selecione o grupo" />
                      </SelectTrigger>
                      <SelectContent>
                        {groups.map(g => (
                          <SelectItem key={g.id} value={g.id} className="text-xs">
                            👥 {g.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Audio option */}
                <div className="pl-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="send-audio"
                      checked={sendAudio}
                      onCheckedChange={(v) => setSendAudio(!!v)}
                    />
                    <Label htmlFor="send-audio" className="text-sm flex items-center gap-1">
                      <Volume2 className="h-3.5 w-3.5" />
                      Enviar áudio junto (resumo falado, com a sua voz)
                    </Label>
                  </div>

                  {sendAudio && (
                    <div className="space-y-2 ml-6">
                      <Label className="text-xs text-muted-foreground flex items-center gap-1">
                        <Sparkles className="h-3 w-3" />
                        Tom do áudio (a IA vai explicar, não ler o texto)
                      </Label>
                      <Select value={audioTone} onValueChange={setAudioTone}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {AUDIO_TONES.map(t => (
                            <SelectItem key={t.key} value={t.key} className="text-xs">
                              {t.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {audioTone === 'custom' && (
                        <Textarea
                          value={customPrompt}
                          onChange={e => setCustomPrompt(e.target.value)}
                          placeholder="Descreva como quer que a IA explique..."
                          className="text-xs min-h-[60px]"
                        />
                      )}

                      {/* Quem o cliente vai ouvir. O texto antigo aqui dizia
                          "voz da sua instância do WhatsApp", o que nunca foi
                          verdade: a voz sai de `voice_preferences` de quem
                          apertou, e sem preferência gravada sai uma voz de
                          catálogo. Agora a tela mostra o estado real e o
                          caminho para arrumar em um clique. */}
                      <div className="rounded-md border bg-muted/40 p-2 space-y-2">
                        {vozCarregando ? (
                          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                            <Loader2 className="h-3 w-3 animate-spin" /> Verificando sua voz...
                          </p>
                        ) : vozErro ? (
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[11px] text-muted-foreground flex items-start gap-1">
                              <AlertTriangle className="h-3 w-3 mt-[2px] shrink-0" />
                              Não deu para verificar qual voz será usada.
                            </p>
                            <Button
                              type="button" variant="ghost" size="sm"
                              className="h-6 px-2 text-[11px]"
                              onClick={carregarVoz}
                            >
                              Tentar de novo
                            </Button>
                          </div>
                        ) : vozPropria ? (
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[11px] text-muted-foreground">
                              🎙️ Sai com a <strong className="text-foreground">sua voz: {voz?.preferencia?.voice_name}</strong>
                            </p>
                            <Button
                              type="button" variant="ghost" size="sm"
                              className="h-6 px-2 text-[11px]"
                              onClick={() => setVozSheetOpen(true)}
                            >
                              Trocar
                            </Button>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <p className="text-[11px] text-amber-700 dark:text-amber-500 flex items-start gap-1">
                              <AlertTriangle className="h-3 w-3 mt-[2px] shrink-0" />
                              <span>
                                {vozClonadaDisponivel
                                  ? <>Você já tem a voz <strong>{vozClonadaDisponivel.name}</strong> pronta, mas ela não está selecionada — hoje o cliente ouviria uma voz genérica.</>
                                  : <>Você ainda não tem voz própria: o cliente vai ouvir uma voz genérica, não a sua.</>}
                              </span>
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {vozClonadaDisponivel && (
                                <Button
                                  type="button" size="sm" variant="secondary"
                                  className="h-7 px-2 text-[11px]"
                                  disabled={vozSalvando}
                                  onClick={() => usarMinhaVoz(vozClonadaDisponivel.elevenlabs_voice_id!, vozClonadaDisponivel.name)}
                                >
                                  {vozSalvando ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Volume2 className="h-3 w-3 mr-1" />}
                                  Usar minha voz
                                </Button>
                              )}
                              <Button
                                type="button" size="sm" variant="outline"
                                className="h-7 px-2 text-[11px]"
                                onClick={() => setVozSheetOpen(true)}
                              >
                                <Mic className="h-3 w-3 mr-1" />
                                {vozClonadaDisponivel ? 'Gravar outra voz' : 'Criar minha voz'}
                              </Button>
                            </div>
                          </div>
                        )}

                        {/* Prévia: o mesmo áudio que vai ao grupo, ouvido antes
                            de enviar. Vale mais que qualquer promessa na tela —
                            se a geração de voz estiver fora do ar, aparece aqui
                            e não em silêncio depois do envio. */}
                        <div className="flex items-center gap-2 pt-1 border-t">
                          <Button
                            type="button" size="sm" variant="outline"
                            className="h-7 px-2 text-[11px]"
                            disabled={previaGerando || isProcessing}
                            onClick={ouvirPrevia}
                          >
                            {previaGerando ? (
                              <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Gerando prévia...</>
                            ) : previaTocando ? (
                              <><Square className="h-3 w-3 mr-1" /> Parar</>
                            ) : (
                              <><Play className="h-3 w-3 mr-1" /> Ouvir prévia</>
                            )}
                          </Button>
                          {previaValida && (
                            <span className="text-[10px] text-muted-foreground">
                              pronta — é este áudio que vai ao grupo
                            </span>
                          )}
                        </div>

                        {previaValida && (
                          <p className="text-[10px] text-muted-foreground italic leading-snug">
                            "{previa!.texto}"
                            {!previa!.resumido && (
                              <span className="not-italic text-amber-700 dark:text-amber-500"> (a IA não respondeu: é a leitura da mensagem, sem resumir)</span>
                            )}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isProcessing}>
            Cancelar
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={isProcessing || (notifyGroup === 'yes' && !selectedGroupId)}>
            {isProcessing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                {generatingAudioText ? 'Gerando áudio...' : 'Processando...'}
              </>
            ) : (
              <>
                {notifyGroup === 'yes' ? <Send className="h-3.5 w-3.5 mr-1" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
                {notifyGroup === 'yes' ? 'Concluir e Notificar' : 'Concluir'}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Criar/trocar a voz SEM sair daqui: painel lateral por cima do dialog,
          e ao fechar a pessoa volta exatamente para a conclusão que começou.
          Mandar para a tela de Configurações do WhatsApp perderia o formulário
          preenchido — e é justamente o passo que ninguém dava (10 vozes
          clonadas, 2 selecionadas). */}
      <Sheet
        open={vozSheetOpen}
        onOpenChange={(v) => {
          setVozSheetOpen(v);
          // Voltou da tela de voz: relê a preferência e descarta a prévia, que
          // pode ter sido feita com a voz antiga.
          if (!v) { setVoz(null); setVozErro(false); vozBuscadaRef.current = false; setPrevia(null); }
        }}
      >
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-base">
              <Mic className="h-4 w-4" />
              Minha voz nos áudios do cliente
            </SheetTitle>
          </SheetHeader>
          <div className="mt-4">
            <Suspense fallback={<div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}>
              {vozSheetOpen && <VoiceSettings />}
            </Suspense>
          </div>
        </SheetContent>
      </Sheet>
    </Dialog>
  );
}
