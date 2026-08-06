// =============================================================================
// Régua do processo administrativo INSS — acompanhamento dos requerimentos.
//
// A régua judicial (12 estações) NÃO serve aqui: o administrativo não é fila
// que só anda pra frente. No histórico, um requerimento sai de "Concluída" e
// volta pra "Pendente" 103×, "Exigência" 50×, "Em Análise" 27×. Por isso a
// régua é ancorada no RESULTADO (que é terminal) e o status vira alerta.
//
// Estações: Protocolado → Concessão | Indeferimento | Encerrado sem análise.
// Exigência não é estação — é pendência que vai e volta, e aparece como alerta
// com dias parados, que é o que gera ação da equipe.
// =============================================================================
import { useMemo, useState } from 'react';
import {
  useReguaInss, MARCO_INSS_LABEL, DIAS_EXIGENCIA_CRITICA, type MarcoInss,
} from '@/lib/inssRegua';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { RefreshCw, TriangleAlert, Search, HelpCircle } from 'lucide-react';

const CORES: Record<MarcoInss, string> = {
  protocolado: 'bg-slate-100 text-slate-800 dark:bg-slate-800/40 dark:text-slate-300',
  concedido:   'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  indeferido:  'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300',
  encerrado:   'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
};

const ORDEM: MarcoInss[] = ['protocolado', 'concedido', 'indeferido', 'encerrado'];

function fmtData(v: string | null): string {
  if (!v) return '—';
  const d = new Date(v.length <= 10 ? `${v}T00:00:00` : v);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}

function Tile({ label, valor, hint, tom = 'normal' }: {
  label: string; valor: string | number; hint?: string;
  tom?: 'normal' | 'bom' | 'alerta' | 'ruim';
}) {
  const cor = tom === 'bom' ? 'text-emerald-600 dark:text-emerald-400'
    : tom === 'alerta' ? 'text-amber-600 dark:text-amber-400'
    : tom === 'ruim' ? 'text-rose-600 dark:text-rose-400'
    : '';
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-2xl font-bold tabular-nums ${cor}`}>{valor}</div>
        {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export default function InssReguaPanel() {
  const { data, resumo, loading, error, refresh } = useReguaInss();
  const [filtro, setFiltro] = useState<MarcoInss | 'exigencia' | 'sem_resultado' | null>(null);
  const [busca, setBusca] = useState('');

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return data.filter((r) => {
      if (filtro === 'exigencia' && !r.emExigencia) return false;
      if (filtro === 'sem_resultado' && !r.concluidaSemResultado) return false;
      if (filtro && filtro !== 'exigencia' && filtro !== 'sem_resultado' && r.marcoAtual !== filtro) return false;
      if (q && !(`${r.requerimentoNumber} ${r.beneficio ?? ''} ${r.servico ?? ''}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [data, filtro, busca]);

  if (error) {
    return (
      <div className="p-6 text-center space-y-3">
        <p className="text-rose-600">{error}</p>
        <Button variant="outline" onClick={refresh} className="gap-2">
          <RefreshCw className="h-4 w-4" /> Tentar de novo
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        <Tile label="Requerimentos" valor={resumo.total} />
        <Tile label="Aguardando" valor={resumo.protocolado} hint="sem desfecho" />
        <Tile label="Concedidos" valor={resumo.concedido} tom="bom" />
        <Tile label="Indeferidos" valor={resumo.indeferido} tom="ruim" />
        <Tile
          label="Taxa de deferimento"
          valor={resumo.taxaDeferimento == null ? '—' : `${resumo.taxaDeferimento}%`}
          hint="só sobre desfecho de mérito"
          tom={resumo.taxaDeferimento == null ? 'normal' : resumo.taxaDeferimento >= 40 ? 'bom' : 'alerta'}
        />
        <Tile
          label="Em exigência"
          valor={resumo.emExigencia}
          hint={resumo.medianaDiasExigencia != null ? `mediana ${resumo.medianaDiasExigencia}d parados` : undefined}
          tom={resumo.emExigencia ? 'alerta' : 'normal'}
        />
      </div>

      {(resumo.exigenciaVencida > 0 || resumo.concluidaSemResultado > 0) && (
        <div className="flex flex-wrap gap-2">
          {resumo.exigenciaVencida > 0 && (
            <button
              onClick={() => setFiltro(filtro === 'exigencia' ? null : 'exigencia')}
              className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20
                         px-3 py-2 text-sm text-amber-900 dark:text-amber-200 hover:brightness-95"
            >
              <TriangleAlert className="h-4 w-4" />
              <b>{resumo.exigenciaVencida}</b> em exigência há mais de {DIAS_EXIGENCIA_CRITICA} dias
            </button>
          )}
          {resumo.concluidaSemResultado > 0 && (
            <button
              onClick={() => setFiltro(filtro === 'sem_resultado' ? null : 'sem_resultado')}
              className="flex items-center gap-2 rounded-lg border border-sky-300 bg-sky-50 dark:bg-sky-900/20
                         px-3 py-2 text-sm text-sky-900 dark:text-sky-200 hover:brightness-95"
            >
              <HelpCircle className="h-4 w-4" />
              <b>{resumo.concluidaSemResultado}</b> o INSS concluiu e não sabemos o resultado
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {ORDEM.map((m) => {
          const n = m === 'protocolado' ? resumo.protocolado
            : m === 'concedido' ? resumo.concedido
            : m === 'indeferido' ? resumo.indeferido : resumo.encerrado;
          return (
            <button key={m} onClick={() => setFiltro(filtro === m ? null : m)}>
              <Badge className={`${CORES[m]} ${filtro === m ? 'ring-2 ring-offset-1 ring-primary' : ''}`}>
                {MARCO_INSS_LABEL[m]} · {n}
              </Badge>
            </button>
          );
        })}
        {filtro && (
          <Button size="sm" variant="ghost" onClick={() => setFiltro(null)}>Limpar filtro</Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Requerimento ou benefício"
              className="pl-7 h-9 w-56"
            />
          </div>
          <Button size="sm" variant="outline" onClick={refresh} disabled={loading} className="gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        {loading ? 'Carregando…' : `${lista.length} de ${resumo.total} requerimentos`}
      </div>

      <div className="space-y-1.5">
        {lista.slice(0, 300).map((r) => {
          const critico = r.emExigencia && (r.diasEmExigencia ?? 0) > DIAS_EXIGENCIA_CRITICA;
          return (
            <div
              key={r.id}
              className={`flex flex-wrap items-center gap-2 rounded-lg border p-2.5 text-sm
                          ${critico ? 'border-amber-300 bg-amber-50/50 dark:bg-amber-900/10' : ''}`}
            >
              <Badge className={CORES[r.marcoAtual]}>{MARCO_INSS_LABEL[r.marcoAtual]}</Badge>
              <span className="font-mono text-xs">{r.requerimentoNumber}</span>
              {r.beneficio && <span className="text-muted-foreground">{r.beneficio}</span>}
              <span className="text-xs text-muted-foreground">Protocolo: {fmtData(r.protocolDate)}</span>
              {r.emExigencia && (
                <Badge className={critico
                  ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200'
                  : 'bg-muted text-muted-foreground'}>
                  exigência {r.diasEmExigencia != null ? `há ${r.diasEmExigencia}d` : 'aberta'}
                </Badge>
              )}
              {r.concluidaSemResultado && (
                <Badge className="bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300">
                  concluída sem resultado
                </Badge>
              )}
              {!r.caseId && (
                <Badge variant="outline" className="text-muted-foreground">sem caso vinculado</Badge>
              )}
            </div>
          );
        })}
        {lista.length > 300 && (
          <p className="text-xs text-muted-foreground text-center py-2">
            Mostrando 300 de {lista.length}. Use o filtro ou a busca para estreitar.
          </p>
        )}
        {!loading && !lista.length && (
          <p className="text-sm text-muted-foreground text-center py-8">
            Nenhum requerimento com esse filtro.
          </p>
        )}
      </div>
    </div>
  );
}
