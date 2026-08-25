/**
 * "Este dinheiro saiu mesmo da conta?" — a pergunta que a ficha do lead não
 * respondia.
 *
 * O diálogo tem dois estados e nada mais: ou o lançamento já aponta para uma
 * linha do extrato (e aí mostra QUAL, com a divergência de valor se houver), ou
 * oferece os candidatos ordenados para alguém apontar. Conciliar sozinho, por
 * valor+data, seria palpite virando número fechado sem ninguém olhar — a mesma
 * decisão já tomada em `conferido`.
 */
import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Link2, Link2Off, Loader2, Search, AlertTriangle, CreditCard, Landmark, Check } from 'lucide-react';
import {
  useConciliacaoOpenFinance, conciliacaoDivergente, TOLERANCIA_CENTAVOS,
  type TransacaoExtrato, type CandidatosConciliacao, type ConciliacaoDoLancamento,
} from '@/hooks/useConciliacaoOpenFinance';

/** O mínimo que o diálogo precisa saber do lançamento. */
export interface LancamentoConciliavel extends ConciliacaoDoLancamento {
  id: string;
  amount: number;
  entry_type: 'entrada' | 'saida';
  description: string | null;
  /** Vencimento. Vira a referência da busca quando ainda não houve baixa. */
  entry_date: string;
  settled_at: string | null;
}

interface Props {
  lancamento: LancamentoConciliavel | null;
  onOpenChange: (aberto: boolean) => void;
  /** Chamado depois de conciliar/desconciliar, para a lista recarregar. */
  onMudou: () => void;
  cloudUserId?: string | null;
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dia = (iso: string | null) => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '—');

/** Janelas oferecidas. 15 dias é o padrão porque cartão fecha depois da compra. */
const JANELAS = [
  { valor: '7', rotulo: '± 7 dias' },
  { valor: '15', rotulo: '± 15 dias' },
  { valor: '30', rotulo: '± 30 dias' },
  { valor: '90', rotulo: '± 90 dias' },
];

export function ConciliarLancamentoDialog({ lancamento, onOpenChange, onMudou, cloudUserId }: Props) {
  const { buscarCandidatos, conciliar, desconciliar, buscando, gravando } = useConciliacaoOpenFinance();
  const [resultado, setResultado] = useState<CandidatosConciliacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [dias, setDias] = useState('15');
  const [busca, setBusca] = useState('');
  // Trocar a transação de um lançamento já conciliado: a mesma tela de busca,
  // aberta por cima do retrato em vez de no lugar dele.
  const [trocando, setTrocando] = useState(false);

  const conciliado = !!lancamento?.of_transacao_id;
  const mostrarBusca = !!lancamento && (!conciliado || trocando);
  const referencia = lancamento?.settled_at || lancamento?.entry_date || '';

  const procurar = useCallback(async () => {
    if (!lancamento) return;
    setErro(null);
    try {
      const r = await buscarCandidatos({
        valor: Number(lancamento.amount),
        data: lancamento.settled_at || lancamento.entry_date,
        dias: Number(dias),
        busca,
        direcao: lancamento.entry_type,
      });
      setResultado(r);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setResultado(null);
    }
  }, [lancamento, dias, busca, buscarCandidatos]);

  // Reabrir o diálogo em outro lançamento não pode reaproveitar a busca do
  // anterior: seriam candidatos de outro valor, apresentados como deste.
  useEffect(() => {
    setResultado(null);
    setErro(null);
    setBusca('');
    setDias('15');
    setTrocando(false);
  }, [lancamento?.id]);

  useEffect(() => {
    if (mostrarBusca && !resultado && !buscando && !erro) void procurar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mostrarBusca, lancamento?.id]);

  const aplicar = async (t: TransacaoExtrato) => {
    if (!lancamento) return;
    const uso = resultado?.usadas?.[t.id];
    if (uso && uso.lancamento_id !== lancamento.id) {
      const ok = window.confirm(
        'Esta transação já baixou o lançamento "' + (uso.descricao || 'sem descrição') + '" (' +
        brl(Math.abs(uso.amount)) + '). Apontar os dois para a mesma linha do banco conta o ' +
        'dinheiro duas vezes. Conciliar mesmo assim?',
      );
      if (!ok) return;
    }
    try {
      await conciliar(lancamento.id, t, {
        jaBaixado: !!lancamento.settled_at,
        cloudUserId,
      });
      toast.success(
        lancamento.settled_at
          ? 'Conciliado com o extrato'
          : 'Conciliado e baixado em ' + dia(t.data),
      );
      onMudou();
      onOpenChange(false);
    } catch (e) {
      toast.error('Não conciliou: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const desfazer = async () => {
    if (!lancamento) return;
    try {
      await desconciliar(lancamento.id);
      toast.success('Vínculo com o extrato desfeito — a baixa continua');
      onMudou();
      onOpenChange(false);
    } catch (e) {
      toast.error('Não desfez: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const divergente = lancamento ? conciliacaoDivergente(lancamento.amount, lancamento) : false;

  return (
    <Dialog open={!!lancamento} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Link2 className="h-4 w-4" />
            Conciliar com o extrato
          </DialogTitle>
          <DialogDescription className="text-xs">
            {lancamento
              ? (lancamento.description || 'Sem descrição') + ' · ' + brl(Math.abs(lancamento.amount)) + ' · ' +
                (lancamento.settled_at ? 'baixado em ' + dia(lancamento.settled_at) : 'vence em ' + dia(lancamento.entry_date))
              : ''}
          </DialogDescription>
        </DialogHeader>

        {conciliado && !trocando && lancamento && (
          <div className="space-y-3">
            <div className={'rounded border p-3 text-sm ' + (divergente ? 'border-amber-300 bg-amber-50' : 'border-emerald-300 bg-emerald-50')}>
              <div className="flex items-center gap-2 mb-1">
                {lancamento.of_transacao_tipo === 'card'
                  ? <CreditCard className="h-3.5 w-3.5" />
                  : <Landmark className="h-3.5 w-3.5" />}
                <span className="font-medium">
                  {lancamento.of_transacao_tipo === 'card' ? 'Cartão' : 'Conta'} · {dia(lancamento.of_data)}
                </span>
                <span className="ml-auto font-bold">{brl(Number(lancamento.of_valor || 0))}</span>
              </div>
              <p className="text-xs text-muted-foreground break-words">
                {lancamento.of_descricao || 'sem descrição no banco'}
              </p>
              {divergente && (
                <p className="mt-2 flex items-start gap-1 text-xs text-amber-800">
                  <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                  O extrato diz {brl(Number(lancamento.of_valor || 0))} e o lançamento diz{' '}
                  {brl(Math.abs(lancamento.amount))}. Um dos dois está errado.
                </p>
              )}
              {lancamento.of_conciliado_em && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Conciliado em {dia(lancamento.of_conciliado_em.slice(0, 10))}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1" onClick={() => setTrocando(true)}>
                <Search className="h-3.5 w-3.5 mr-1" /> Trocar transação
              </Button>
              <Button variant="ghost" size="sm" className="flex-1 text-destructive" disabled={gravando} onClick={desfazer}>
                <Link2Off className="h-3.5 w-3.5 mr-1" /> Desfazer vínculo
              </Button>
            </div>
          </div>
        )}

        {mostrarBusca && lancamento && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Select value={dias} onValueChange={setDias}>
                <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {JANELAS.map(j => <SelectItem key={j.valor} value={j.valor}>{j.rotulo}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input
                className="h-8 text-xs"
                placeholder="Filtrar por descrição ou estabelecimento"
                value={busca}
                onChange={e => setBusca(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void procurar(); }}
              />
              <Button size="sm" className="h-8" onClick={() => void procurar()} disabled={buscando}>
                {buscando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Procurando em torno de {dia(referencia)}
              {resultado ? ' (' + dia(resultado.janela.de) + ' a ' + dia(resultado.janela.ate) + ')' : ''}.
            </p>

            {erro && <p className="text-xs text-destructive">{erro}</p>}

            {/* `display:table` do viewport do Radix cresce com o conteúdo e anula
                o `truncate` dos filhos — sem isto a descrição do banco empurra o
                valor para fora da tela. */}
            <ScrollArea className="h-[320px] [&_[data-radix-scroll-area-viewport]>div]:!block">
              <div className="space-y-1 pr-2">
                {buscando && !resultado && (
                  <p className="py-6 text-center text-xs text-muted-foreground">Lendo o extrato...</p>
                )}
                {resultado && resultado.candidatos.length === 0 && (
                  <div className="py-6 text-center text-xs text-muted-foreground space-y-1">
                    <p>Nada no extrato nesta janela.</p>
                    {!resultado.mapeado && (
                      <p className="text-amber-700">
                        Seu usuário não está mapeado entre os dois bancos — a leitura volta vazia
                        mesmo havendo movimento.
                      </p>
                    )}
                    {resultado.mapeado && resultado.contas_permitidas === 0 && (
                      <p>Você não tem permissão em nenhuma conta ou cartão conectado.</p>
                    )}
                  </div>
                )}
                {resultado?.candidatos.map(t => {
                  const exato = Math.abs(Math.abs(t.valor) - Math.abs(lancamento.amount)) <= TOLERANCIA_CENTAVOS;
                  const uso = resultado.usadas[t.id];
                  const usadaPorOutro = !!uso && uso.lancamento_id !== lancamento.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => void aplicar(t)}
                      disabled={gravando}
                      className={'w-full text-left rounded border p-2 text-xs hover:bg-muted/50 disabled:opacity-50 ' +
                        (exato ? 'border-emerald-300' : 'border-border')}
                    >
                      <div className="flex items-center gap-2">
                        {t.tipo === 'card'
                          ? <CreditCard className="h-3 w-3 flex-shrink-0" />
                          : <Landmark className="h-3 w-3 flex-shrink-0" />}
                        <span className="truncate font-medium">{t.descricao || t.merchant_name || 'sem descrição'}</span>
                        <span className={'ml-auto flex-shrink-0 font-bold ' + (t.valor < 0 ? 'text-red-600' : 'text-green-600')}>
                          {brl(Math.abs(t.valor))}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                        <span>{dia(t.data)}{t.hora ? ' ' + t.hora : ''}</span>
                        {t.card_last_digits && <span>· ****{t.card_last_digits}</span>}
                        {t.categoria && <span>· {t.categoria}</span>}
                        {exato && (
                          <Badge variant="outline" className="h-4 px-1 text-[9px] border-emerald-300 text-emerald-700">
                            <Check className="h-2.5 w-2.5 mr-0.5" />valor exato
                          </Badge>
                        )}
                        {usadaPorOutro && (
                          <Badge variant="outline" className="h-4 px-1 text-[9px] border-amber-300 text-amber-700">
                            <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />já usada
                          </Badge>
                        )}
                      </div>
                    </button>
                  );
                })}
                {!!resultado?.cortados && (
                  <p className="py-2 text-center text-[11px] text-muted-foreground">
                    +{resultado.cortados} transações fora da lista. Filtre pela descrição para alcançá-las.
                  </p>
                )}
              </div>
            </ScrollArea>

            {conciliado && trocando && (
              <Button variant="ghost" size="sm" className="w-full" onClick={() => setTrocando(false)}>
                Cancelar troca
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
