import { useState, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExternalLink, Loader2, Milestone, Filter } from 'lucide-react';
import { useProcessMovements, type MarcoTipo } from '@/hooks/useProcessMovements';

const MARCO_LABEL: Record<MarcoTipo, string> = {
  peticao_inicial: 'Petição Inicial',
  sentenca_1grau: 'Sentença (1º Grau)',
  acordo: 'Acordo',
  acordao_2grau: 'Acórdão (2º Grau)',
  acordao_superior: 'Acórdão (Superior)',
  transito_julgado: 'Trânsito em Julgado',
  pagamento: 'Pagamento',
};

const MARCO_COLOR: Record<MarcoTipo, string> = {
  peticao_inicial: 'bg-slate-100 text-slate-800 dark:bg-slate-800/40 dark:text-slate-300',
  sentenca_1grau: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  acordo: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300',
  acordao_2grau: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  acordao_superior: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  transito_julgado: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  pagamento: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
};

function formatDate(v: string): string {
  if (!v) return '';
  // aceita 'YYYY-MM-DD' (append 'T00:00:00' pra não deslocar fuso) ou ISO completo
  const d = new Date(v.length <= 10 ? `${v}T00:00:00` : v);
  return isNaN(d.getTime()) ? v : d.toLocaleDateString('pt-BR');
}

function formatValor(v: number | null): string | null {
  if (v == null) return null;
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Timeline de marcos processuais (histórico append-only).
 * Por padrão mostra só o status atual (marco mais recente); o toggle
 * expande pro histórico completo, do mais recente ao mais antigo.
 */
export function ProcessMovementsTimeline({ processId }: { processId: string }) {
  const { movements, loading } = useProcessMovements(processId);
  const [onlyCurrent, setOnlyCurrent] = useState(true);

  // movements já vem ordenado por data DESC — o [0] é o status atual.
  const visible = useMemo(
    () => (onlyCurrent ? movements.slice(0, 1) : movements),
    [movements, onlyCurrent],
  );

  if (loading) {
    return (
      <div className="text-center py-6 text-muted-foreground text-xs">
        <Loader2 className="h-4 w-4 animate-spin mx-auto mb-1" />
        Carregando marcos...
      </div>
    );
  }

  if (movements.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground">
        <Milestone className="h-6 w-6 mx-auto mb-1 opacity-50" />
        <p className="text-xs">Nenhum marco processual detectado ainda.</p>
        <p className="text-[10px] mt-1 opacity-70">
          Os marcos são extraídos das movimentações do Escavador ao cadastrar/atualizar o processo.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold flex items-center gap-1.5">
          <Milestone className="h-3.5 w-3.5 text-primary" />
          {onlyCurrent ? 'Status atual' : `Histórico completo (${movements.length})`}
        </h4>
        {movements.length > 1 && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[10px]"
            onClick={() => setOnlyCurrent((v) => !v)}
          >
            <Filter className="h-3 w-3 mr-1" />
            {onlyCurrent ? 'Ver histórico completo' : 'Só status atual'}
          </Button>
        )}
      </div>

      {visible.map((m, idx) => {
        const tipo = m.tipo_movimentacao as MarcoTipo;
        const valor = formatValor(m.valor_indenizacao_fixado);
        return (
          <div
            key={m.id}
            className={`border rounded-lg p-3 space-y-1.5 ${idx === 0 ? 'border-primary/40' : ''}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge className={`text-[9px] ${MARCO_COLOR[tipo] ?? ''}`}>
                  {MARCO_LABEL[tipo] ?? tipo}
                </Badge>
                {idx === 0 && <span className="text-[9px] text-primary font-medium">atual</span>}
              </div>
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                {formatDate(m.data_movimentacao)}
              </span>
            </div>
            {valor && <p className="text-[11px] font-medium pl-0.5">Valor fixado: {valor}</p>}
            {m.descricao && (
              <p className="text-[10px] text-muted-foreground line-clamp-3">{m.descricao}</p>
            )}
            {m.link_decisao && (
              <a
                href={m.link_decisao}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-primary inline-flex items-center gap-1 hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> Ver decisão
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}
