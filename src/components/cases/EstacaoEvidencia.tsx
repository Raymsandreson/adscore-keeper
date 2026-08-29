// =============================================================================
// O QUE PROVA A ESTAÇÃO: código do DataJud + peça publicada.
//
// Abre dentro do detalhe da estação (linha do trem, aba Marcos). Sem isto a
// régua afirmava "houve Sentença em 11/06/2026" e não havia como conferir:
// nem o código TPU que o tribunal remeteu ao CNJ, nem a peça que foi publicada.
//
// Regra de honestidade da tela: a prova não existe para todo processo (28% têm
// movimento do DataJud, 43% têm peça baixada — medido em 21/08/2026). Quando
// falta, o bloco DIZ que falta e por quê. Silêncio aqui seria lido como
// "não houve", que é outra afirmação.
// =============================================================================
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExternalLink, FileText, Gavel, Loader2, Lock, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import {
  abrirDocumentoArquivado, distanciaDias,
  type EvidenciaDatajud, type EvidenciaDocumento, type ProvaDaEstacao,
} from '@/hooks/useEstacaoEvidencia';

/** Teto de itens por bloco: alvará (código 60) repete dezenas de vezes num processo. */
const TETO = 12;

function fmtData(v: string | null | undefined): string {
  if (!v) return 'sem data';
  const d = new Date(v.length <= 10 ? `${v}T00:00:00` : v);
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('pt-BR');
}

/** Complementos do DataJud viram "tipo: valor" legível. */
function fmtComplementos(c: unknown): string | null {
  if (!c) return null;
  try {
    const arr = Array.isArray(c) ? c : JSON.parse(String(c));
    if (!Array.isArray(arr) || !arr.length) return null;
    return arr
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((x: any) => [x?.nome, x?.descricao, x?.valor].filter(Boolean).join(': '))
      .filter(Boolean)
      .join(' · ') || null;
  } catch {
    return null;
  }
}

function LinhaDatajud({ m, dataMarco }: { m: EvidenciaDatajud; dataMarco: string | null }) {
  const comps = fmtComplementos(m.complementos);
  const perto = distanciaDias(m.data_hora, dataMarco) <= 45;
  return (
    <div className={`rounded border px-2 py-1.5 ${perto ? 'border-primary/40 bg-primary/5' : ''}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 min-w-0">
          <Badge variant="outline" className="font-mono text-[10px] shrink-0">TPU {m.codigo}</Badge>
          <span className="text-xs font-medium truncate">{m.nome || 'movimento sem nome'}</span>
          {m.grau && <span className="text-[10px] text-muted-foreground shrink-0">{m.grau}</span>}
        </div>
        <span className="text-[10px] text-muted-foreground whitespace-nowrap">{fmtData(m.data_hora)}</span>
      </div>
      {(m.orgao_julgador || m.tribunal_alias) && (
        <p className="text-[10px] text-muted-foreground mt-0.5">
          {[m.tribunal_alias, m.orgao_julgador].filter(Boolean).join(' · ')}
        </p>
      )}
      {comps && <p className="text-[10px] text-muted-foreground mt-0.5">{comps}</p>}
      {m.codigo_significado && (
        <p className="text-[10px] text-muted-foreground/80 italic mt-0.5">{m.codigo_significado}</p>
      )}
    </div>
  );
}

function LinhaDocumento({ d, onAbrir }: { d: EvidenciaDocumento; onAbrir: (url: string, titulo: string) => void }) {
  const [abrindo, setAbrindo] = useState(false);

  const abrir = async () => {
    setAbrindo(true);
    const url = await abrirDocumentoArquivado(d.documento_id);
    setAbrindo(false);
    if (!url) {
      toast.error('Não foi possível abrir a peça');
      return;
    }
    onAbrir(url, d.titulo || `Peça dos autos`);
  };

  return (
    <div className="rounded border px-2 py-1.5 flex items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="text-xs font-medium truncate">{d.titulo || 'peça sem título'}</span>
          {d.sigilo && d.sigilo !== 'PUBLICO' && (
            <Badge variant="outline" className="text-[9px] gap-0.5">
              <Lock className="h-2.5 w-2.5" /> {d.sigilo}
            </Badge>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5">{fmtData(d.data_documento)}</p>
      </div>
      {d.storage_path ? (
        <Button size="sm" variant="outline" className="h-6 text-[10px] shrink-0" onClick={abrir} disabled={abrindo}>
          {abrindo ? <Loader2 className="h-3 w-3 animate-spin" /> : <><ExternalLink className="h-3 w-3 mr-1" /> Abrir</>}
        </Button>
      ) : (
        <span className="text-[9px] text-muted-foreground whitespace-nowrap shrink-0">
          {d.storage_error ? 'tribunal recusou o download' : 'ainda não baixada'}
        </span>
      )}
    </div>
  );
}

function Secao({
  titulo, contador, children, aberta: abertaInicial = false,
}: { titulo: string; contador: number; children: React.ReactNode; aberta?: boolean }) {
  const [aberta, setAberta] = useState(abertaInicial);
  if (!contador) return null;
  return (
    <div>
      <button
        type="button"
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        onClick={() => setAberta((v) => !v)}
      >
        {aberta ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {titulo} ({contador})
      </button>
      {aberta && <div className="space-y-1.5 mt-1.5">{children}</div>}
    </div>
  );
}

/**
 * Bloco de prova de uma estação.
 * @param semDatajud o processo inteiro não tem movimento do DataJud capturado —
 *   muda a mensagem de "não há código para esta estação" para "não há DataJud".
 */
export default function EstacaoEvidencia({
  prova, dataMarco, loading, semDatajud, semAcervo, onAbrirPeca,
}: {
  prova: ProvaDaEstacao;
  dataMarco: string | null;
  loading: boolean;
  semDatajud: boolean;
  semAcervo: boolean;
  /** Entrega a peça a quem sabe exibir por cima da tela (MediaLightbox). */
  onAbrirPeca: (url: string, titulo: string) => void;
}) {
  if (loading) {
    return (
      <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 py-2">
        <Loader2 className="h-3 w-3 animate-spin" /> Buscando a prova desta estação…
      </div>
    );
  }

  const dj = prova.datajud.slice(0, TETO);
  const djRestantes = prova.datajud.length - dj.length;

  return (
    <div className="space-y-3">
      {/* -------- código do DataJud -------- */}
      <div className="space-y-1.5">
        <h5 className="text-[11px] font-semibold flex items-center gap-1.5">
          <Gavel className="h-3 w-3 text-primary" />
          Código do DataJud
          {prova.datajud.length > 0 && (
            <span className="text-muted-foreground font-normal">({prova.datajud.length})</span>
          )}
        </h5>
        {dj.length > 0 ? (
          <>
            {dj.map((m) => <LinhaDatajud key={m.movimento_id} m={m} dataMarco={dataMarco} />)}
            {djRestantes > 0 && (
              <p className="text-[10px] text-muted-foreground">e mais {djRestantes} movimento(s) com o mesmo código.</p>
            )}
          </>
        ) : (
          <p className="text-[11px] text-muted-foreground italic">
            {semDatajud
              ? 'Este processo ainda não tem movimento capturado do DataJud — o marco veio da consulta ao tribunal pelo Escavador.'
              : 'Nenhum código TPU desta estação aparece no DataJud deste processo.'}
          </p>
        )}
      </div>

      {/* -------- peças que provam o marco -------- */}
      <div className="space-y-1.5">
        <h5 className="text-[11px] font-semibold flex items-center gap-1.5">
          <FileText className="h-3 w-3 text-primary" />
          Documentos desta estação
          {prova.documentos.length > 0 && (
            <span className="text-muted-foreground font-normal">({prova.documentos.length})</span>
          )}
        </h5>
        {prova.documentos.length > 0 ? (
          prova.documentos.slice(0, TETO).map((d) => <LinhaDocumento key={d.documento_id} d={d} onAbrir={onAbrirPeca} />)
        ) : (
          <p className="text-[11px] text-muted-foreground italic">
            {semAcervo
              ? 'Nenhuma peça deste processo foi baixada ainda.'
              : 'Nenhuma peça com o título desta estação na janela do marco.'}
          </p>
        )}
      </div>

      <Secao titulo="Outras peças no período do marco" contador={prova.documentosDoPeriodo.length}>
        {prova.documentosDoPeriodo.slice(0, TETO).map((d) => <LinhaDocumento key={d.documento_id} d={d} onAbrir={onAbrirPeca} />)}
      </Secao>

      <Secao titulo="Mesmo título, outro momento do processo" contador={prova.documentosForaDaJanela.length}>
        {prova.documentosForaDaJanela.slice(0, TETO).map((d) => <LinhaDocumento key={d.documento_id} d={d} onAbrir={onAbrirPeca} />)}
      </Secao>
    </div>
  );
}
