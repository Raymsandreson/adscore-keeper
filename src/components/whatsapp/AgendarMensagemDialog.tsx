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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarClock, Loader2, Repeat, Trash2, AlertTriangle } from 'lucide-react';
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
  /** O que a pessoa digitou, sem assinatura. */
  texto: string;
  /** O texto exatamente como vai sair — com a assinatura, quando ligada. */
  textoFinal: string;
  mentions?: string[];
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
  open, onOpenChange, conversa, texto, textoFinal, mentions,
  criadoPor, criadoPorNome, onAgendado,
}: Props) {
  const { pendentes, loading, salvando, agendar, cancelar } = useMensagensAgendadas({
    phone: conversa.phone,
    instanceName: conversa.instanceName,
  });

  const [data, setData] = useState(() => dataParaCampo(sugestaoInicial()));
  const [hora, setHora] = useState(() => horaParaCampo(sugestaoInicial()));
  const [repeticao, setRepeticao] = useState<Repeticao>('nenhuma');
  const [intervalo, setIntervalo] = useState(2);
  const [unidade, setUnidade] = useState<Unidade>('semanas');
  const [diasDaSemana, setDiasDaSemana] = useState<number[]>([]);
  const [limite, setLimite] = useState<Limite>('sempre');
  const [ate, setAte] = useState('');
  const [vezes, setVezes] = useState(4);
  const [cancelando, setCancelando] = useState<string | null>(null);

  // Cada abertura recomeça do zero — a janela é sobre a mensagem que está no
  // campo AGORA, não sobre a anterior.
  useEffect(() => {
    if (!open) return;
    const inicial = sugestaoInicial();
    setData(dataParaCampo(inicial));
    setHora(horaParaCampo(inicial));
    setRepeticao('nenhuma');
    setIntervalo(2);
    setUnidade('semanas');
    setDiasDaSemana([]);
    setLimite('sempre');
    setAte('');
    setVezes(4);
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

  const erro = validarAgendamento(texto, quando, regra);
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
        mensagemOriginal: texto,
        mentions,
        quando,
        repeticao: regra.repeticao,
        intervalo: regra.intervalo,
        unidade: regra.unidade,
        diasDaSemana: regra.diasDaSemana,
        repetirAte: regra.repetirAte,
        maxEnvios: regra.maxEnvios,
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
          {/* O que vai sair, do jeito que vai sair. */}
          <div className="rounded-md border bg-muted/40 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
              Vai sair assim
            </p>
            {textoFinal.trim() ? (
              <p className="whitespace-pre-wrap break-words text-sm max-h-28 overflow-y-auto">{textoFinal}</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                O campo está vazio. Escreva a mensagem no chat e volte aqui.
              </p>
            )}
          </div>

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
                  {item.criado_por_nome && (
                    <p className="text-[10px] text-muted-foreground">por {item.criado_por_nome}</p>
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
