/**
 * "Escrevi agora, manda depois" — a janela de agendar mensagem do chat.
 *
 * Duas coisas num lugar só, porque são a mesma pergunta: o que ainda vai sair
 * nesta conversa (a fila, com o botão de tirar da fila) e o agendamento novo.
 *
 * Quem dispara é o banco, de minuto em minuto (migration
 * 20260825170000_mensagem_agendada_com_recorrencia.sql). O texto sai
 * exatamente como está na pré-visualização daqui — inclusive a assinatura
 * `*Nome:*` de "Identificar remetente", que já vem pronta de quem abriu a
 * janela.
 */
import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { CalendarClock, Loader2, Repeat, Trash2, AlertTriangle, Sparkles, MessageSquareQuote } from 'lucide-react';
import { format, addDays, addHours, startOfHour } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  DIAS_DA_SEMANA,
  REGRA_PADRAO,
  descreverAgendamento,
  descreverRepeticao,
  listarProximosEnvios,
  regraDaLinha,
  validarAgendamento,
  type RegraDeRepeticao,
  type Repeticao,
  type Unidade,
} from '@/lib/mensagemAgendada';
import { useMensagensAgendadas, type MensagemAgendada } from '@/hooks/useMensagensAgendadas';
import { type QuandoDaConversa } from '@/lib/quandoDaConversa';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  conversa: {
    phone: string;
    chatId?: string | null;
    instanceName?: string | null;
    contactId?: string | null;
    leadId?: string | null;
    contactName?: string | null;
  };
  /**
   * O que já está escrito no campo do chat, se houver. Vira o rascunho inicial
   * da janela — daqui em diante ele é editável aqui dentro, e o campo do chat
   * não precisa mais ter nada para se agendar uma mensagem.
   */
  texto: string;
  /**
   * O rascunho pronto para sair: assinatura `*Nome:*` e `@marcados` aplicados.
   *
   * Vem de fora, e não daqui, porque quem sabe as escolhas da barra (formato do
   * nome, título, apelido, quem é participante do grupo) é o chat. Sem isso a
   * mensagem agendada sairia diferente da enviada na hora — o mesmo texto com
   * duas assinaturas diferentes.
   */
  montarEnvio: (cru: string) => { texto: string; mentions: string[] };
  /**
   * A data que a própria conversa combinou ("me manda na segunda"), já lida por
   * `lerQuandoDaConversa`. Quando existe, a janela abre marcada nela e diz de
   * onde tirou. Null = cai na sugestão padrão (daqui a uma hora).
   */
  sugestaoDeQuando?: QuandoDaConversa | null;
  /**
   * Escreve com IA a mensagem que vai sair na data escolhida. Recebe o instante
   * para a IA saber que está escrevendo para o futuro ("na segunda, como
   * combinamos") e não para agora. Ausente = o botão de sugerir não aparece.
   */
  sugerirTexto?: (quando: Date | null) => Promise<string>;
  criadoPor?: string | null;
  criadoPorNome?: string | null;
  /** Chamado depois de agendar, para o chat limpar o campo. */
  onAgendado?: () => void;
}

type Limite = 'sempre' | 'data' | 'vezes';

const dataParaCampo = (d: Date) => format(d, 'yyyy-MM-dd');
const horaParaCampo = (d: Date) => format(d, 'HH:mm');

/** Sugestão inicial: daqui a uma hora, na hora cheia. */
const sugestaoInicial = () => startOfHour(addHours(new Date(), 1));

export function AgendarMensagemDialog({
  open, onOpenChange, conversa, texto, montarEnvio, sugestaoDeQuando, sugerirTexto,
  criadoPor, criadoPorNome, onAgendado,
}: Props) {
  const { pendentes, loading, salvando, agendar, cancelar } = useMensagensAgendadas({
    phone: conversa.phone,
    instanceName: conversa.instanceName,
  });

  // O texto mora aqui dentro: dá para abrir a janela com o campo do chat vazio,
  // escrever a mensagem e agendar sem passar pelo chat.
  const [rascunho, setRascunho] = useState(texto);
  const [sugerindo, setSugerindo] = useState(false);
  const [data, setData] = useState(() => dataParaCampo(sugestaoInicial()));
  const [hora, setHora] = useState(() => horaParaCampo(sugestaoInicial()));
  const [repeticao, setRepeticao] = useState<Repeticao>('nenhuma');
  const [intervalo, setIntervalo] = useState(2);
  const [unidade, setUnidade] = useState<Unidade>('semanas');
  const [diasDaSemana, setDiasDaSemana] = useState<number[]>([]);
  const [limite, setLimite] = useState<Limite>('sempre');
  const [ate, setAte] = useState('');
  const [vezes, setVezes] = useState(4);
  const [pularSeResponder, setPularSeResponder] = useState(true);
  const [cancelando, setCancelando] = useState<string | null>(null);

  // Cada abertura recomeça do zero — a janela é sobre a mensagem que está no
  // campo AGORA, não sobre a anterior.
  useEffect(() => {
    if (!open) return;
    // A data que o interlocutor combinou ganha da sugestão genérica: se ele
    // disse "me manda na segunda", a janela já abre na segunda. Quando ele não
    // marcou a hora, vale a hora comercial que o leitor devolve, não "daqui a
    // uma hora" — ninguém combina retorno para as 23h.
    const inicial = sugestaoDeQuando?.quando ?? sugestaoInicial();
    setRascunho(texto);
    setData(dataParaCampo(inicial));
    setHora(horaParaCampo(inicial));
    setRepeticao('nenhuma');
    setIntervalo(2);
    setUnidade('semanas');
    setDiasDaSemana([]);
    setLimite('sempre');
    setAte('');
    setVezes(4);
    setPularSeResponder(true);
    // De propósito só `open`: isto é o reset da ABERTURA. Com `texto` e
    // `sugestaoDeQuando` na lista, digitar no chat por trás da janela (ou uma
    // releitura da conversa) apagaria o rascunho e a data já escolhidos aqui.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const quando = useMemo(() => {
    if (!data || !hora) return null;
    const d = new Date(`${data}T${hora}:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }, [data, hora]);

  const regra: RegraDeRepeticao = useMemo(() => ({
    ...REGRA_PADRAO,
    repeticao,
    intervalo,
    unidade,
    diasDaSemana,
    repetirAte: repeticao !== 'nenhuma' && limite === 'data' && ate ? new Date(`${ate}T00:00:00`) : null,
    maxEnvios: repeticao !== 'nenhuma' && limite === 'vezes' ? vezes : null,
  }), [repeticao, intervalo, unidade, diasDaSemana, limite, ate, vezes]);

  // O texto do jeito que vai sair, recalculado a cada tecla: a pré-visualização
  // é a promessa, e ela tem que acompanhar o que está sendo escrito aqui.
  const envio = useMemo(() => montarEnvio(rascunho), [montarEnvio, rascunho]);
  const textoFinal = envio.texto;

  const erro = validarAgendamento(rascunho, quando, regra);
  const proximos = useMemo(
    () => (quando && !erro ? listarProximosEnvios(quando, regra, new Date(), 4) : []),
    [quando, regra, erro],
  );

  const alternarDia = (dia: number) => {
    setDiasDaSemana((atual) => (atual.includes(dia) ? atual.filter((d) => d !== dia) : [...atual, dia].sort()));
  };

  const atalho = (rotulo: string, alvo: Date) => (
    <Button
      key={rotulo}
      type="button"
      variant="outline"
      size="sm"
      className="h-7 text-xs"
      onClick={() => { setData(dataParaCampo(alvo)); setHora(horaParaCampo(alvo)); }}
    >
      {rotulo}
    </Button>
  );

  const amanha8h = (() => { const d = addDays(new Date(), 1); d.setHours(8, 0, 0, 0); return d; })();
  const segunda8h = (() => {
    const d = new Date();
    d.setHours(8, 0, 0, 0);
    do { d.setDate(d.getDate() + 1); } while (d.getDay() !== 1);
    return d;
  })();

  /**
   * Pede à IA a mensagem que vai sair na data escolhida.
   *
   * A sugestão do chat responde AGORA; esta escreve para depois — muda o tempo
   * verbal e o gancho ("como combinamos", "conforme o senhor pediu"). Por isso
   * a data vai junto no pedido, e não só a conversa.
   */
  const pedirSugestao = async () => {
    if (!sugerirTexto || sugerindo) return;
    setSugerindo(true);
    try {
      const sugerido = (await sugerirTexto(quando)).trim();
      if (!sugerido) {
        toast.info('A IA não conseguiu escrever agora — tente de novo em instantes.');
        return;
      }
      setRascunho(sugerido);
    } catch (e) {
      toast.error('Não consegui sugerir: ' + ((e as Error)?.message || 'erro desconhecido'));
    } finally {
      setSugerindo(false);
    }
  };

  const confirmar = async () => {
    if (erro || !quando) return;
    try {
      await agendar({
        phone: conversa.phone,
        chatId: conversa.chatId,
        instanceName: conversa.instanceName,
        contactId: conversa.contactId,
        leadId: conversa.leadId,
        contactName: conversa.contactName,
        mensagem: textoFinal,
        mensagemOriginal: rascunho.trim(),
        mentions: envio.mentions,
        quando,
        repeticao: regra.repeticao,
        intervalo: regra.intervalo,
        unidade: regra.unidade,
        diasDaSemana: regra.diasDaSemana,
        repetirAte: regra.repetirAte,
        maxEnvios: regra.maxEnvios,
        pularSeResponder,
        criadoPor,
        criadoPorNome,
      });
      toast.success(`Agendada — ${descreverAgendamento(quando, regra).toLowerCase()}`);
      onAgendado?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error('Não consegui agendar: ' + (e?.message || 'erro desconhecido'));
    }
  };

  const tirarDaFila = async (item: MensagemAgendada) => {
    setCancelando(item.id);
    try {
      await cancelar(item.id, criadoPorNome);
      toast.success('Tirada da fila — não vai mais sair');
    } catch (e: any) {
      toast.error('Não consegui cancelar: ' + (e?.message || 'erro desconhecido'));
    } finally {
      setCancelando(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5" /> Agendar mensagem
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* A mensagem: escrita aqui mesmo. Antes a janela só exibia o que já
              estava no campo do chat e mandava a pessoa voltar para digitar —
              agendar exigia começar a escrever primeiro. */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="agendar-texto" className="text-xs">Mensagem</Label>
              {sugerirTexto && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 text-xs text-primary hover:text-primary"
                  onClick={pedirSugestao}
                  disabled={sugerindo}
                >
                  {sugerindo
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Sparkles className="h-3.5 w-3.5" />}
                  {rascunho.trim() ? 'Reescrever com IA' : 'Sugerir com IA'}
                </Button>
              )}
            </div>
            <Textarea
              id="agendar-texto"
              value={rascunho}
              onChange={(e) => setRascunho(e.target.value)}
              placeholder="O que vai sair na hora marcada..."
              className="min-h-[80px] max-h-40 resize-none text-sm"
            />
          </div>

          {/* O que vai sair, do jeito que vai sair — com a assinatura já pronta. */}
          {textoFinal.trim() && textoFinal.trim() !== rascunho.trim() && (
            <div className="rounded-md border bg-muted/40 p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                Vai sair assim
              </p>
              <p className="whitespace-pre-wrap break-words text-sm max-h-28 overflow-y-auto">{textoFinal}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="agendar-dia" className="text-xs">Dia</Label>
              <Input id="agendar-dia" type="date" value={data} onChange={(e) => setData(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="agendar-hora" className="text-xs">Hora</Label>
              <Input id="agendar-hora" type="time" value={hora} onChange={(e) => setHora(e.target.value)} className="h-9" />
            </div>
          </div>

          {/* A data que a própria conversa combinou. Não é palpite: vem de uma
              fala do interlocutor, e o trecho fica à vista para conferência. */}
          {sugestaoDeQuando && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-2.5">
              <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <MessageSquareQuote className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span>
                  Na conversa ele falou em <strong className="text-foreground">{sugestaoDeQuando.rotulo}</strong>
                  {!sugestaoDeQuando.horaExplicita && ' — sem marcar hora, ficou às 8h'}.
                </span>
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-1.5 h-7 text-xs"
                onClick={() => {
                  setData(dataParaCampo(sugestaoDeQuando.quando));
                  setHora(horaParaCampo(sugestaoDeQuando.quando));
                }}
              >
                Usar {format(sugestaoDeQuando.quando, "dd/MM 'às' HH:mm", { locale: ptBR })}
              </Button>
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            {atalho('Daqui a 1 hora', startOfHour(addHours(new Date(), 1)))}
            {atalho('Amanhã 8h', amanha8h)}
            {atalho('Segunda 8h', segunda8h)}
          </div>

          <div className="space-y-1">
            <Label className="text-xs flex items-center gap-1.5">
              <Repeat className="h-3.5 w-3.5" /> Repetir
            </Label>
            <Select value={repeticao} onValueChange={(v) => setRepeticao(v as Repeticao)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="nenhuma">Não repetir — sai uma vez</SelectItem>
                <SelectItem value="diaria">Todo dia</SelectItem>
                <SelectItem value="semanal">Toda semana</SelectItem>
                <SelectItem value="mensal">Todo mês</SelectItem>
                <SelectItem value="personalizada">Personalizado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {repeticao === 'semanal' && (
            <div className="space-y-1">
              <Label className="text-xs">Em quais dias</Label>
              <div className="flex flex-wrap gap-1">
                {DIAS_DA_SEMANA.map(({ valor, label }) => (
                  <Button
                    key={valor}
                    type="button"
                    size="sm"
                    variant={diasDaSemana.includes(valor) ? 'default' : 'outline'}
                    className="h-8 w-11 text-xs capitalize"
                    onClick={() => alternarDia(valor)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Sem nenhum marcado, repete no mesmo dia da semana do primeiro envio.
              </p>
            </div>
          )}

          {repeticao === 'personalizada' && (
            <div className="space-y-1">
              <Label className="text-xs">A cada</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={intervalo}
                  onChange={(e) => setIntervalo(Number(e.target.value))}
                  className="h-9 w-24"
                />
                <Select value={unidade} onValueChange={(v) => setUnidade(v as Unidade)}>
                  <SelectTrigger className="h-9 flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dias">dias</SelectItem>
                    <SelectItem value="semanas">semanas</SelectItem>
                    <SelectItem value="meses">meses</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {repeticao !== 'nenhuma' && (
            <div className="space-y-1">
              <Label className="text-xs">Até quando</Label>
              <div className="flex gap-2">
                <Select value={limite} onValueChange={(v) => setLimite(v as Limite)}>
                  <SelectTrigger className="h-9 flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sempre">Sem data para acabar</SelectItem>
                    <SelectItem value="data">Até uma data</SelectItem>
                    <SelectItem value="vezes">Depois de N envios</SelectItem>
                  </SelectContent>
                </Select>
                {limite === 'data' && (
                  <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="h-9 w-40" />
                )}
                {limite === 'vezes' && (
                  <Input
                    type="number"
                    min={1}
                    max={500}
                    value={vezes}
                    onChange={(e) => setVezes(Number(e.target.value))}
                    className="h-9 w-24"
                  />
                )}
              </div>
            </div>
          )}

          {/* Confere a conversa antes de mandar. Quase toda agendada é cobrança
              de uma resposta que ainda não veio; se ela vier antes da hora, a
              cobrança chega como se ninguém tivesse lido o cliente. */}
          <div className="flex items-start justify-between gap-3 rounded-md border p-3">
            <div className="min-w-0">
              <Label htmlFor="pular-se-responder" className="text-xs cursor-pointer">
                Não enviar se o cliente responder antes
              </Label>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {pularSeResponder
                  ? 'Na hora marcada, olha a conversa: se ele tiver falado depois de agora, a mensagem não sai.'
                  : 'Sai na hora marcada de qualquer jeito — para aviso de audiência, parabéns, lembrete de parcela.'}
              </p>
            </div>
            <Switch
              id="pular-se-responder"
              checked={pularSeResponder}
              onCheckedChange={setPularSeResponder}
            />
          </div>

          {/* A promessa, escrita: quando sai e quais são os próximos. */}
          {erro ? (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {erro}
            </p>
          ) : (
            quando && (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-1">
                <p className="text-sm font-medium">{descreverAgendamento(quando, regra)}</p>
                <p className="text-[11px] text-muted-foreground">
                  {proximos.length > 1 ? 'Próximos envios: ' : 'Sai em '}
                  {proximos.map((d) => format(d, "dd/MM 'às' HH:mm", { locale: ptBR })).join(' · ')}
                  {repeticao !== 'nenhuma' && limite === 'sempre' ? ' · …' : ''}
                </p>
              </div>
            )
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Fechar</Button>
            <Button onClick={confirmar} disabled={!!erro || salvando} className="gap-2">
              {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
              Agendar
            </Button>
          </div>

          {/* A fila desta conversa. */}
          <div className="border-t pt-3 space-y-2">
            <p className="text-xs font-medium flex items-center gap-2">
              Na fila desta conversa
              <Badge variant="secondary" className="text-[10px]">{pendentes.length}</Badge>
              {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
            </p>

            {pendentes.length === 0 && !loading && (
              <p className="text-xs text-muted-foreground">Nada agendado por aqui ainda.</p>
            )}

            {pendentes.map((item) => (
              <div key={item.id} className="flex items-start gap-2 rounded-md border p-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">
                    {format(new Date(item.proximo_envio_at), "dd/MM 'às' HH:mm", { locale: ptBR })}
                    {item.repeticao !== 'nenhuma' && (
                      <span className="ml-1.5 font-normal text-muted-foreground">
                        · {descreverRepeticaoDaLinha(item)}
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.mensagem_original || item.mensagem}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {item.pular_se_responder ? 'Só sai se ele não responder antes' : 'Sai de qualquer jeito'}
                    {item.criado_por_nome ? ` · por ${item.criado_por_nome}` : ''}
                  </p>
                  {item.ultimo_resultado && (
                    <p className="text-[10px] text-amber-600 dark:text-amber-400">{item.ultimo_resultado}</p>
                  )}
                  {item.ultimo_erro && (
                    <p className="text-[10px] text-destructive">último envio falhou: {item.ultimo_erro}</p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn('h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive')}
                  title="Tirar da fila"
                  disabled={cancelando === item.id}
                  onClick={() => tirarDaFila(item)}
                >
                  {cancelando === item.id
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Trash2 className="h-3.5 w-3.5" />}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A frase da recorrência de uma linha já salva, reconstruída do banco. */
function descreverRepeticaoDaLinha(item: MensagemAgendada): string {
  return descreverRepeticao(new Date(item.proximo_envio_at), regraDaLinha(item));
}
