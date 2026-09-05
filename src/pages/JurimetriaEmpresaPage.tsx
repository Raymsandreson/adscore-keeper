// =============================================================================
// Jurimetria — Radar de empresa.
//
// Responde, para um CNPJ ou para a RAIZ inteira (matriz + filiais): quantos
// processos por ano, e quantos deles são de acidente de trabalho ou doença
// ocupacional.
//
// DUAS COISAS QUE ESTA TELA NUNCA FAZ:
//  1. Chutar matéria. Capa sem assunto vira "sem assunto na capa" e é contada
//     à parte — o percentual sai sobre o que deu para classificar, não sobre o
//     total, senão "não sei" viraria "não é".
//  2. Consultar sem avisar o custo. Cada CNPJ/página é consulta paga no
//     Escavador; a varredura de raiz diz quantas serão ANTES de começar e pode
//     ser interrompida no meio.
// =============================================================================
import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useRadarEmpresa } from '@/hooks/useRadarEmpresa';
import {
  ROTULO_MATERIA, agregarPorAno, anoDoProcesso, cnpjValido, cnpjsDaRaiz,
  csvPorAno, csvProcessos, formatarCnpj, limparCnpj, percentualAcidentarios,
  raizDoCnpj, totalizar, type Materia, type ProcessoDaEmpresa,
} from '@/lib/processosDaEmpresa';
import { AlertTriangle, Building2, Download, Search, StopCircle } from 'lucide-react';
import { toast } from 'sonner';

const TODAS = '__todas__';

const CORES: Record<Materia, string> = {
  ACIDENTE: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
  DOENCA: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  AMBOS: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300',
  OUTRO: 'bg-muted text-muted-foreground',
  INDETERMINADO: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

const baixar = (nome: string, conteudo: string) => {
  const url = URL.createObjectURL(new Blob([conteudo], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
};

export default function JurimetriaEmpresaPage() {
  const [documento, setDocumento] = useState('');
  const [modoRaiz, setModoRaiz] = useState(false);
  const [ateOrdem, setAteOrdem] = useState('20');
  const [maxPaginas, setMaxPaginas] = useState('20');
  const [filtroMateria, setFiltroMateria] = useState<string>(TODAS);
  const [filtroAno, setFiltroAno] = useState<string>(TODAS);
  const [aberto, setAberto] = useState<ProcessoDaEmpresa | null>(null);

  const { processos, avisos, progresso, buscando, erro, concluidoEm, buscar, parar, limpar } = useRadarEmpresa();

  const digitos = limparCnpj(documento);
  const raiz = raizDoCnpj(documento);
  const documentoOk = modoRaiz ? raiz.length === 8 : cnpjValido(digitos);

  // A lista de CNPJs é derivada, não estado: mudar o modo/ordem recalcula
  // sozinho e o aviso de custo nunca fica defasado do que será consultado.
  const alvos = useMemo(
    () => (modoRaiz ? cnpjsDaRaiz(raiz, Number(ateOrdem) || 1) : documentoOk ? [digitos] : []),
    [modoRaiz, raiz, ateOrdem, documentoOk, digitos],
  );

  const visiveis = useMemo(() => processos.filter(p =>
    (filtroMateria === TODAS || p.materia === filtroMateria) &&
    (filtroAno === TODAS || anoDoProcesso(p) === filtroAno),
  ), [processos, filtroMateria, filtroAno]);

  const linhas = useMemo(() => agregarPorAno(processos), [processos]);
  const totais = useMemo(() => totalizar(linhas), [linhas]);
  const pct = percentualAcidentarios(totais);
  const anosDisponiveis = useMemo(() => linhas.map(l => l.ano), [linhas]);
  const maiorAno = useMemo(() => Math.max(1, ...linhas.map(l => l.total)), [linhas]);

  const iniciar = () => {
    if (!documentoOk) {
      toast.error(modoRaiz ? 'Informe pelo menos os 8 dígitos da raiz' : 'CNPJ inválido — confira o dígito verificador');
      return;
    }
    void buscar(alvos, Number(maxPaginas) || 20);
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-2 min-w-0">
        <Building2 className="h-5 w-5 text-primary flex-shrink-0" />
        <div className="min-w-0">
          <h1 className="text-lg font-semibold leading-tight">Jurimetria — radar de empresa</h1>
          <p className="text-xs text-muted-foreground">
            Processos por ano de um CNPJ (ou de toda a raiz), separando acidente de trabalho
            e doença ocupacional. Fonte: Escavador.
          </p>
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Consulta                                                          */}
      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[240px] space-y-1">
              <Label htmlFor="documento" className="text-xs">CNPJ da empresa</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="documento"
                  className="pl-8"
                  placeholder="01.588.098/0001-02"
                  value={documento}
                  onChange={e => setDocumento(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !buscando) iniciar(); }}
                />
              </div>
              {digitos.length >= 8 && (
                <p className="text-[11px] text-muted-foreground">
                  Raiz <strong>{raiz}</strong>
                  {!modoRaiz && digitos.length === 14 && (
                    <> · {cnpjValido(digitos) ? 'dígito verificador confere' : 'dígito verificador NÃO confere'}</>
                  )}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Alcance</Label>
              <div className="flex rounded-md border overflow-hidden">
                <button
                  type="button"
                  className={`px-3 py-2 text-xs ${!modoRaiz ? 'bg-primary text-primary-foreground' : 'bg-background'}`}
                  onClick={() => setModoRaiz(false)}
                >
                  Só este CNPJ
                </button>
                <button
                  type="button"
                  className={`px-3 py-2 text-xs ${modoRaiz ? 'bg-primary text-primary-foreground' : 'bg-background'}`}
                  onClick={() => setModoRaiz(true)}
                >
                  Raiz (matriz + filiais)
                </button>
              </div>
            </div>

            {modoRaiz && (
              <div className="space-y-1 w-[130px]">
                <Label htmlFor="ate" className="text-xs">Até a filial nº</Label>
                <Input id="ate" type="number" min={1} max={999} value={ateOrdem}
                  onChange={e => setAteOrdem(e.target.value)} />
              </div>
            )}

            <div className="space-y-1 w-[130px]">
              <Label htmlFor="paginas" className="text-xs">Máx. páginas/CNPJ</Label>
              <Input id="paginas" type="number" min={1} max={100} value={maxPaginas}
                onChange={e => setMaxPaginas(e.target.value)} />
            </div>

            {buscando ? (
              <Button variant="destructive" onClick={parar}>
                <StopCircle className="h-4 w-4 mr-1" /> Parar
              </Button>
            ) : (
              <Button onClick={iniciar} disabled={!documentoOk}>
                <Search className="h-4 w-4 mr-1" /> Buscar
              </Button>
            )}
            {processos.length > 0 && !buscando && (
              <Button variant="ghost" onClick={limpar}>Limpar</Button>
            )}
          </div>

          {/* Custo à vista ANTES de gastar: o usuário decide sabendo o tamanho. */}
          {alvos.length > 0 && !buscando && (
            <p className="text-xs text-muted-foreground">
              Vai consultar <strong>{alvos.length}</strong> CNPJ(s) — cada página é consulta paga no
              Escavador (até {alvos.length} × {maxPaginas || 20} páginas no pior caso).
              {modoRaiz && (
                <> A varredura por raiz gera os CNPJs pelo dígito verificador; filial que nunca
                existiu simplesmente não devolve processo.</>
              )}
            </p>
          )}

          {buscando && (
            <div className="space-y-1">
              <Progress value={progresso.cnpjsTotal ? (progresso.cnpjsFeitos / progresso.cnpjsTotal) * 100 : 0} />
              <p className="text-xs text-muted-foreground">
                {progresso.cnpjsFeitos}/{progresso.cnpjsTotal} CNPJ(s) ·{' '}
                {progresso.cnpjAtual ? formatarCnpj(progresso.cnpjAtual) : '—'} ·{' '}
                {progresso.paginas} página(s) · {progresso.encontrados} processo(s)
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {erro && (
        <Card className="border-destructive">
          <CardContent className="p-3 text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> {erro}
          </CardContent>
        </Card>
      )}

      {avisos.length > 0 && (
        <Card className="border-amber-300">
          <CardContent className="p-3 space-y-1">
            <p className="text-xs font-medium flex items-center gap-1 text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5" /> O resultado tem buraco conhecido:
            </p>
            {avisos.map((a, i) => (
              <p key={i} className="text-[11px] text-muted-foreground">
                {a.cnpj === '—' ? '' : `${formatarCnpj(a.cnpj)}: `}{a.texto}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Resultado                                                         */}
      {/* ---------------------------------------------------------------- */}
      {processos.length > 0 && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <Card><CardContent className="p-3">
              <p className="text-xs text-muted-foreground">Processos</p>
              <p className="text-lg font-bold tabular-nums">{totais.total.toLocaleString('pt-BR')}</p>
              <p className="text-[11px] text-muted-foreground">
                {totais.anos} ano(s) · {totais.mediaPorAno.toFixed(1)}/ano
              </p>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <p className="text-xs text-muted-foreground">Acidente / doença</p>
              <p className="text-lg font-bold tabular-nums text-rose-700">{totais.acidentarios.toLocaleString('pt-BR')}</p>
              <p className="text-[11px] text-muted-foreground">
                {totais.mediaAcidentariosPorAno.toFixed(1)}/ano
              </p>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <p className="text-xs text-muted-foreground">% do que deu para classificar</p>
              <p className="text-lg font-bold tabular-nums">{pct == null ? '—' : `${pct.toFixed(1)}%`}</p>
              <p className="text-[11px] text-muted-foreground">
                base {(totais.total - totais.indeterminado).toLocaleString('pt-BR')} processo(s)
              </p>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <p className="text-xs text-muted-foreground">Sem assunto na capa</p>
              <p className="text-lg font-bold tabular-nums text-slate-600">{totais.indeterminado.toLocaleString('pt-BR')}</p>
              <p className="text-[11px] text-muted-foreground">precisa abrir a capa para saber</p>
            </CardContent></Card>
          </div>

          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Por ano</h2>
                <Button size="sm" variant="outline" onClick={() => {
                  baixar(`empresa-${raiz}-por-ano.csv`, csvPorAno(linhas));
                  toast.success('CSV por ano baixado');
                }}>
                  <Download className="h-4 w-4 mr-1" /> CSV por ano
                </Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b">
                      <th className="text-left py-1.5 pr-2">Ano</th>
                      <th className="text-right px-2">Total</th>
                      <th className="text-right px-2">Acidente</th>
                      <th className="text-right px-2">Doença</th>
                      <th className="text-right px-2">Ambos</th>
                      <th className="text-right px-2">Outra</th>
                      <th className="text-right px-2">Sem assunto</th>
                      <th className="text-left pl-3 w-[28%]">Volume</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map(l => (
                      <tr key={l.ano} className="border-b last:border-0 hover:bg-muted/40">
                        <td className="py-1.5 pr-2 font-medium">{l.ano === 'sem_data' ? 'sem data' : l.ano}</td>
                        <td className="text-right px-2 tabular-nums">{l.total}</td>
                        <td className="text-right px-2 tabular-nums text-rose-700">{l.acidente || '—'}</td>
                        <td className="text-right px-2 tabular-nums text-amber-700">{l.doenca || '—'}</td>
                        <td className="text-right px-2 tabular-nums text-purple-700">{l.ambos || '—'}</td>
                        <td className="text-right px-2 tabular-nums text-muted-foreground">{l.outro || '—'}</td>
                        <td className="text-right px-2 tabular-nums text-slate-500">{l.indeterminado || '—'}</td>
                        <td className="pl-3">
                          {/* Barra proporcional ao maior ano — dá a forma da
                              série sem esconder o número, que fica ao lado. */}
                          <div className="h-2 rounded bg-muted overflow-hidden flex">
                            <div className="bg-rose-500" style={{ width: `${(l.acidentarios / maiorAno) * 100}%` }} />
                            <div className="bg-slate-300" style={{ width: `${((l.total - l.acidentarios) / maiorAno) * 100}%` }} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Ano = data de distribuição (na falta dela, início do processo). Barra vermelha =
                acidente/doença; cinza = o resto, incluindo o que não deu para classificar.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">
                  Processos <span className="text-muted-foreground font-normal">({visiveis.length})</span>
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={filtroMateria} onValueChange={setFiltroMateria}>
                    <SelectTrigger className="w-[190px] h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={TODAS}>Toda matéria</SelectItem>
                      {(Object.keys(ROTULO_MATERIA) as Materia[]).map(m => (
                        <SelectItem key={m} value={m}>{ROTULO_MATERIA[m]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={filtroAno} onValueChange={setFiltroAno}>
                    <SelectTrigger className="w-[120px] h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={TODAS}>Todo ano</SelectItem>
                      {anosDisponiveis.map(a => (
                        <SelectItem key={a} value={a}>{a === 'sem_data' ? 'sem data' : a}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" variant="outline" onClick={() => {
                    baixar(`empresa-${raiz}-processos.csv`, csvProcessos(visiveis));
                    toast.success(`${visiveis.length} processo(s) no CSV`);
                  }}>
                    <Download className="h-4 w-4 mr-1" /> CSV
                  </Button>
                </div>
              </div>

              <div className="divide-y">
                {visiveis.map((p, i) => (
                  <button
                    key={`${p.numero_cnj}-${i}`}
                    type="button"
                    className="w-full text-left py-2 hover:bg-muted/40 px-1 rounded"
                    onClick={() => setAberto(p)}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs">{p.numero_cnj ?? 'sem número'}</span>
                      <Badge variant="secondary" className={`text-[10px] ${CORES[p.materia]}`}>
                        {ROTULO_MATERIA[p.materia]}
                      </Badge>
                      {p.tribunal_sigla && <Badge variant="outline" className="text-[10px]">{p.tribunal_sigla}</Badge>}
                      <span className="text-[11px] text-muted-foreground">{anoDoProcesso(p)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {p.polo_ativo ?? '—'} × {p.polo_passivo ?? '—'}
                    </p>
                  </button>
                ))}
                {visiveis.length === 0 && (
                  <p className="text-xs text-muted-foreground py-3">Nenhum processo com esse filtro.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {concluidoEm && processos.length === 0 && !erro && (
        <Card><CardContent className="p-4 text-sm text-muted-foreground">
          Nenhum processo encontrado para {alvos.length} CNPJ(s) consultado(s). Isso quer dizer que o
          Escavador não indexou processo com esse documento — não que a empresa não tenha processo.
        </CardContent></Card>
      )}

      {/* Detalhe em aba lateral, empilhando sobre a lista — sem redirecionar. */}
      <Sheet open={!!aberto} onOpenChange={o => !o && setAberto(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-base font-mono">{aberto?.numero_cnj ?? 'Processo'}</SheetTitle>
          </SheetHeader>
          {aberto && (
            <div className="space-y-3 mt-4 text-sm">
              <Badge variant="secondary" className={CORES[aberto.materia]}>{ROTULO_MATERIA[aberto.materia]}</Badge>
              {[
                ['Autor', aberto.polo_ativo],
                ['Réu', aberto.polo_passivo],
                ['Papel da empresa', aberto.polo_da_empresa === 'INDETERMINADO'
                  ? 'não informado nesta resposta' : aberto.polo_da_empresa.toLowerCase()],
                ['CNPJ consultado', (aberto.cnpjs_encontrados ?? [aberto.cnpj_consultado]).map(formatarCnpj).join(' · ')],
                ['Classe', aberto.classe],
                ['Área', aberto.area],
                ['Assunto principal', aberto.assunto_principal],
                ['Assuntos', aberto.assuntos.join(' · ') || null],
                ['Tribunal', aberto.tribunal_sigla],
                ['Estado', aberto.estado],
                ['Distribuição', aberto.data_distribuicao],
                ['Valor da causa', aberto.valor_causa == null ? null
                  : aberto.valor_causa.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })],
              ].map(([rotulo, valor]) => (
                <div key={String(rotulo)} className="flex gap-2">
                  <span className="text-xs text-muted-foreground w-[130px] flex-shrink-0">{rotulo}</span>
                  <span className="text-xs break-words">{valor || '—'}</span>
                </div>
              ))}
              {aberto.materia === 'INDETERMINADO' && (
                <p className="text-[11px] text-muted-foreground border-t pt-2">
                  A capa veio sem assunto e sem classe. Para saber a matéria é preciso abrir o
                  processo no Escavador (consulta paga por processo) — este aqui não foi contado
                  nem como acidentário nem como "outro".
                </p>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
