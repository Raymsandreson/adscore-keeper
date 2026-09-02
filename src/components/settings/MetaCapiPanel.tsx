/**
 * Painel da Meta Conversions API.
 *
 * Existe por causa de um silêncio: em 31/07/2026 o app da Meta que emitia o
 * token foi apagado e as conversões pararam de sair. Ninguém percebeu por mais
 * de um mês, porque o envio era fire-and-forget e o erro morria num
 * `console.warn`. Esta tela é onde esse tipo de coisa passa a aparecer.
 *
 * Lê pelo Railway (`meta-capi-status`): a tabela tem RLS sem policy, então o
 * navegador não a alcança — e ela guarda só hash, nunca contato em claro.
 */
import { useCallback, useEffect, useState } from 'react';
import { cloudFunctions } from '@/lib/functionRouter';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import {
  AlertTriangle, CheckCircle2, RefreshCw, Send, Clock, XCircle, MinusCircle, Loader2,
} from 'lucide-react';

interface EventoRecente {
  id: string;
  event_id: string;
  event_name: string;
  lead_id: string | null;
  origem: string;
  status: 'pending' | 'sent' | 'failed' | 'skipped';
  motivo_skip: string | null;
  match_keys: string[];
  valor: number | null;
  valor_origem: string | null;
  tentativas: number;
  http_status: number | null;
  events_received: number | null;
  resposta: any;
  enfileirado_em: string;
  enviado_em: string | null;
}

interface Resumo {
  credencial: {
    token_valido: boolean | null;
    dataset_id: string | null;
    erro: string | null;
    ultimo_probe_em: string | null;
    ultimo_sucesso_em: string | null;
    versao_graph: string;
    configurada: boolean;
  };
  fila: Record<string, number>;
  falhas_por_motivo: { motivo: string; eventos: number }[];
  recentes: EventoRecente[];
}

const ROTULO_SITUACAO: Record<string, { texto: string; icone: JSX.Element; classe: string }> = {
  pending: { texto: 'Na fila', icone: <Clock className="h-3.5 w-3.5" />, classe: 'text-amber-600' },
  sent: { texto: 'Enviado', icone: <CheckCircle2 className="h-3.5 w-3.5" />, classe: 'text-emerald-600' },
  failed: { texto: 'Falhou', icone: <XCircle className="h-3.5 w-3.5" />, classe: 'text-red-600' },
  skipped: { texto: 'Ignorado', icone: <MinusCircle className="h-3.5 w-3.5" />, classe: 'text-muted-foreground' },
};

const ROTULO_VALOR: Record<string, string> = {
  informado: 'valor real',
  faixa_produto: 'estimado pela faixa do produto',
  padrao: 'valor padrão',
  ausente: 'sem valor',
};

const dataHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

const moeda = (v: number | null) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function MetaCapiPanel() {
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carrega = useCallback(async () => {
    try {
      const { data, error } = await cloudFunctions.invoke('meta-capi-status', { body: { limite: 50 } });
      if (error) throw new Error(error.message);
      setResumo(data as Resumo);
    } catch (err) {
      toast.error('Não foi possível ler o estado da integração', {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carrega();
  }, [carrega]);

  const acao = async (corpo: Record<string, unknown>, rotulo: string, sucesso: (r: any) => string) => {
    setOcupado(rotulo);
    try {
      const { data, error } = await cloudFunctions.invoke('meta-capi-dispatch', { body: corpo });
      if (error) throw new Error(error.message);
      const r = data as any;
      if (r?.credencial_morta) {
        toast.error('A credencial da Meta está inválida', {
          description: 'Os eventos ficaram congelados na fila. Renove o token e tente de novo.',
        });
      } else {
        toast.success(sucesso(r));
      }
      await carrega();
    } catch (err) {
      toast.error('Falhou', { description: err instanceof Error ? err.message : undefined });
    } finally {
      setOcupado(null);
    }
  };

  if (carregando) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Lendo o estado da integração…
      </div>
    );
  }
  if (!resumo) return null;

  const { credencial, fila, falhas_por_motivo, recentes } = resumo;
  const credencialOk = credencial.configurada && credencial.token_valido === true;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Conversões enviadas à Meta</h2>
        <p className="text-sm text-muted-foreground">
          Cada fechamento de lead vira um evento na fila. O servidor despacha a cada 5 minutos e
          registra aqui o que a Meta respondeu.
        </p>
      </div>

      {/* Credencial primeiro: é o que quebra e o que ninguém vê quebrar. */}
      <Card className={credencialOk ? '' : 'border-red-300 bg-red-50/50 dark:bg-red-950/20'}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            {credencialOk ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-red-600" />
            )}
            {!credencial.configurada
              ? 'Credencial não configurada'
              : credencialOk
                ? 'Credencial válida'
                : 'Credencial com problema'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {credencial.erro && (
            <p className="rounded bg-red-100 px-3 py-2 font-mono text-xs text-red-900 dark:bg-red-950/40 dark:text-red-200">
              {credencial.erro}
            </p>
          )}
          <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            <span className="text-muted-foreground">
              Conjunto de dados: <span className="font-mono">{credencial.dataset_id || 'não definido'}</span>
            </span>
            <span className="text-muted-foreground">API: {credencial.versao_graph}</span>
            <span className="text-muted-foreground">Última verificação: {dataHora(credencial.ultimo_probe_em)}</span>
            <span className="text-muted-foreground">Último envio aceito: {dataHora(credencial.ultimo_sucesso_em)}</span>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="outline" disabled={ocupado !== null}
              onClick={() => acao({ modo: 'probe' }, 'probe', (r) =>
                r?.token_valido ? 'Credencial válida e com acesso ao conjunto de dados' : 'Credencial ainda inválida')}>
              {ocupado === 'probe' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
              Verificar credencial
            </Button>
            <Button size="sm" variant="outline" disabled={ocupado !== null}
              onClick={() => acao({}, 'drenar', (r) =>
                r?.drenados ? `${r.drenados} evento(s) enviados` : 'Nada pendente na fila')}>
              {ocupado === 'drenar' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
              Enviar fila agora
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(['pending', 'sent', 'failed', 'skipped'] as const).map((s) => (
          <Card key={s}>
            <CardContent className="p-4">
              <div className={`flex items-center gap-1.5 text-xs ${ROTULO_SITUACAO[s].classe}`}>
                {ROTULO_SITUACAO[s].icone}
                {ROTULO_SITUACAO[s].texto}
              </div>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{fila[s] ?? 0}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {falhas_por_motivo.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Por que estão falhando</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {falhas_por_motivo.map((f) => (
              <div key={f.motivo} className="flex items-start justify-between gap-3 text-sm">
                <span className="font-mono text-xs text-muted-foreground">{f.motivo}</span>
                <Badge variant="secondary" className="shrink-0 tabular-nums">{f.eventos}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Últimos eventos</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {recentes.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              Nenhum evento ainda. Feche um lead para ver a conversão aparecer aqui.
            </p>
          ) : (
            /* Tabela larga rola dentro do próprio contêiner: a página nunca rola de lado. */
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Situação</th>
                    <th className="px-4 py-2 font-medium">Evento</th>
                    <th className="px-4 py-2 font-medium">Origem</th>
                    <th className="px-4 py-2 font-medium">Correspondência</th>
                    <th className="px-4 py-2 font-medium">Valor</th>
                    <th className="px-4 py-2 font-medium">Quando</th>
                  </tr>
                </thead>
                <tbody>
                  {recentes.map((e) => (
                    <tr key={e.id} className="border-b last:border-0 align-top">
                      <td className="px-4 py-2">
                        <span className={`inline-flex items-center gap-1.5 text-xs ${ROTULO_SITUACAO[e.status]?.classe}`}>
                          {ROTULO_SITUACAO[e.status]?.icone}
                          {ROTULO_SITUACAO[e.status]?.texto}
                        </span>
                        {e.motivo_skip && (
                          <p className="mt-0.5 max-w-[24ch] text-[11px] leading-tight text-muted-foreground">
                            {e.motivo_skip}
                          </p>
                        )}
                        {e.tentativas > 0 && (
                          <p className="mt-0.5 text-[11px] text-muted-foreground">{e.tentativas} tentativa(s)</p>
                        )}
                      </td>
                      <td className="px-4 py-2 font-medium">{e.event_name}</td>
                      <td className="px-4 py-2 text-muted-foreground">{e.origem}</td>
                      <td className="px-4 py-2">
                        {e.match_keys.length === 0 ? (
                          <span className="text-xs text-muted-foreground">sem contato</span>
                        ) : (
                          <span className="text-xs">
                            {e.match_keys.includes('em') && 'e-mail'}
                            {e.match_keys.includes('em') && e.match_keys.includes('ph') && ' + '}
                            {e.match_keys.includes('ph') && 'telefone'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 tabular-nums">
                        {moeda(e.valor)}
                        {e.valor_origem && (
                          <p className="text-[11px] text-muted-foreground">{ROTULO_VALOR[e.valor_origem] ?? e.valor_origem}</p>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {dataHora(e.enviado_em ?? e.enfileirado_em)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
