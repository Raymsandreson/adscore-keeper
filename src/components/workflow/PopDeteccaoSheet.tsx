// =============================================================================
// Painel de detecção do POP: como cada marco é reconhecido sozinho.
//
// Por que existe (24/08/2026). A régua já lia cinco fontes, mas a regra que
// liga fonte a marco só era editável por SQL. A única tela que existia era a
// Auditoria de códigos, e ela só lista código TPU que JÁ apareceu — no BPC
// JUDICIAL ela aparece vazia porque jm_movimentos não tem uma linha para
// aqueles 30 processos federais. Não havia como configurar a detecção do que
// ainda não aconteceu, que é justamente o que se quer configurar.
//
// A REGRA DA CASA AQUI É UMA SÓ: NÃO SE GRAVA SINAL SEM VER A CONTRA-PROVA.
// O botão de gravar só acende depois do teste. Não é burocracia — é o preço de
// dois erros que esta base já pagou:
//
//   O TPU 277 virou sinal de "Levantamento / pagamento". O nome dele é
//   "Convenção das Partes para Satisfação Voluntária da Obrigação em Execução"
//   — o combinado de COMO pagar, não o pagamento. O caso 88 ficou 846 dias
//   parado no topo da régua por causa disso.
//
//   E dos 96 "acórdão" que o parser gerou, 9 eram acórdão; o resto era Certidão
//   de Publicação, DJE e Contrarrazões.
//
// Nenhum dos dois passaria se quem escreveu tivesse lido, na hora, a frase que
// o padrão casa. Por isso a contra-prova mostra o NÚMERO e as CINCO FRASES: o
// número sozinho não protege — "pega 340" parece ótimo até você ver que 300
// são "Mero expediente".
// =============================================================================
import { useEffect, useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ChevronDown, ChevronRight, FlaskConical, Plus, Radar, Trash2, TriangleAlert, Check,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  usePopDeteccao,
  type Contraprova,
  type MarcoDoPop,
  type NovoSinal,
  type Sinal,
  type TipoSinal,
} from '@/hooks/usePopDeteccao';

interface Props {
  boardId: string;
  boardName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fase de onde o painel foi aberto: os marcos dela já vêm abertos. */
  focoStageId?: string | null;
}

const TIPO_LABEL: Record<TipoSinal, string> = {
  tpu: 'Movimentação (código DataJud)',
  texto: 'Texto da movimentação (Escavador)',
  documento: 'Título da peça (autos)',
  grau: 'Grau do processo (Escavador)',
  email: 'E-mail do INSS',
};

const TIPO_CURTO: Record<TipoSinal, string> = {
  tpu: 'DataJud', texto: 'Escavador', documento: 'documento', grau: 'grau', email: 'e-mail',
};

const CAMPO_EMAIL_LABEL: Record<string, string> = {
  despacho: 'Despacho', status: 'Status atual', servico: 'Serviço',
  assunto: 'Assunto do e-mail', evento: 'Tipo do evento (protocolo/status)',
};

const vazio = (tipo: TipoSinal): NovoSinal => ({
  tipo,
  codigo: null, grau: null, complemento_pattern: null,
  padrao: null, padrao_excluir: null,
  campo_email: tipo === 'email' ? 'despacho' : null,
  email_status: null, email_servico: null,
  motivo: null,
});

/** O sinal em uma frase, do jeito que alguém do jurídico lê. */
function descrever(s: Sinal): string {
  if (s.tipo === 'tpu') {
    return `código ${s.codigo}${s.grau ? ` no ${s.grau}` : ''}` +
      (s.complemento_pattern ? ` com complemento "${s.complemento_pattern}"` : '');
  }
  if (s.tipo === 'grau') return `processo no ${s.grau}`;
  if (s.tipo === 'email') {
    const onde = CAMPO_EMAIL_LABEL[s.campo_email || 'despacho'] || s.campo_email;
    return `${onde} casa "${s.padrao}"` +
      (s.email_status ? ` · só quando o status é ${s.email_status}` : '') +
      (s.email_servico ? ` · só no serviço "${s.email_servico}"` : '') +
      (s.padrao_excluir ? ` · menos "${s.padrao_excluir}"` : '');
  }
  return `casa "${s.padrao}"` + (s.padrao_excluir ? ` · menos "${s.padrao_excluir}"` : '');
}

const dataCurta = (iso?: string | null) => {
  if (!iso) return '—';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : iso;
};

export function PopDeteccaoSheet({ boardId, boardName, open, onOpenChange, focoStageId }: Props) {
  const { marcos, sinais, loading, testar, adicionar, remover, confirmar } =
    usePopDeteccao(boardId, open);

  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const [formDe, setFormDe] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<NovoSinal>(vazio('tpu'));
  const [prova, setProva] = useState<Contraprova | null>(null);
  const [testando, setTestando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  // Abrir o painel a partir de uma fase já mostra os marcos daquela fase.
  useEffect(() => {
    if (!open) return;
    if (!focoStageId) { setAbertos({}); return; }
    const foco: Record<string, boolean> = {};
    for (const m of marcos) if (m.stage_id === focoStageId) foco[m.id] = true;
    setAbertos(foco);
  }, [open, focoStageId, marcos]);

  const semSinal = useMemo(
    () => marcos.filter((m) => !(sinais[m.id]?.length)).length,
    [marcos, sinais],
  );

  const abrirForm = (marcoId: string) => {
    setFormDe(marcoId);
    setRascunho(vazio('tpu'));
    setProva(null);
  };

  const mudarRascunho = (patch: Partial<NovoSinal>) => {
    setRascunho((r) => ({ ...r, ...patch }));
    setProva(null);          // mudou a regra, a prova anterior não vale mais
  };

  const rodarTeste = async () => {
    setTestando(true);
    try {
      setProva(await testar(rascunho));
    } finally {
      setTestando(false);
    }
  };

  const gravar = async (marco: MarcoDoPop) => {
    setSalvando(true);
    try {
      const alvos = prova?.alvos ?? 0;
      await adicionar(
        marco.id,
        rascunho,
        `cadastrado no painel de detecção; a contra-prova mostrou ${alvos} ${prova?.unidade || 'alvo(s)'}`,
      );
      toast.success('Sinal cadastrado. Vale a partir da próxima passagem da régua.');
      setFormDe(null);
      setProva(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao gravar o sinal');
    } finally {
      setSalvando(false);
    }
  };

  const apagar = async (s: Sinal) => {
    try {
      await remover(s.id);
      toast.success('Sinal removido. Os marcos que só ele sustentava saem no próximo recálculo.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao remover');
    }
  };

  /** Sem padrão (ou sem código, no TPU) não há o que testar. */
  const rascunhoUtil =
    rascunho.tipo === 'tpu' ? rascunho.codigo != null
    : rascunho.tipo === 'grau' ? !!rascunho.grau
    : !!rascunho.padrao?.trim();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-3 overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle className="text-base">
            <Radar className="mr-1.5 inline h-4 w-4" />
            Detecção · {boardName || 'POP'}
          </SheetTitle>
        </SheetHeader>

        <p className="text-[11px] leading-snug text-muted-foreground">
          Como cada marco deste POP é reconhecido <b>sem ninguém marcar passo</b>. Um marco sem
          sinal nunca vai ser detectado sozinho — o processo cumpre a etapa e a régua não enxerga.
          Os padrões são <b>expressões regulares</b> aplicadas ao texto em minúsculas: <code>a|b</code> é
          "a ou b", <code>^x</code> é "começa com x".
        </p>

        {semSinal > 0 && !loading ? (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-[11px]">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
            <span>
              <b>{semSinal}</b> marco(s) sem sinal nenhum. Enquanto estiverem assim, só entram na
              régua se alguém mexer à mão.
            </span>
          </div>
        ) : null}

        {loading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div className="space-y-1.5">
            {marcos.map((m) => {
              const meus = sinais[m.id] || [];
              const aberto = !!abertos[m.id];
              return (
                <div key={m.id} className="rounded-lg border">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 p-2.5 text-left"
                    onClick={() => setAbertos((a) => ({ ...a, [m.id]: !a[m.id] }))}
                  >
                    {aberto ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                    <span className="w-6 shrink-0 text-[10px] text-muted-foreground">{m.ordem}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.rotulo}</span>
                    {m.atravessa_fases ? (
                      <Badge variant="outline" className="shrink-0 text-[10px]" title="Estado, não fase: não move o processo na régua">
                        estado
                      </Badge>
                    ) : null}
                    {m.terminal ? (
                      <Badge variant="outline" className="shrink-0 text-[10px]">encerra</Badge>
                    ) : null}
                    <Badge
                      variant={meus.length === 0 ? 'destructive' : 'secondary'}
                      className="shrink-0 text-[10px]"
                    >
                      {meus.length === 0 ? 'sem sinal' : `${meus.length} sinal${meus.length > 1 ? 'is' : ''}`}
                    </Badge>
                  </button>

                  {aberto ? (
                    <div className="space-y-1.5 border-t p-2.5">
                      {m.descricao ? (
                        <p className="text-[11px] italic text-muted-foreground">{m.descricao}</p>
                      ) : null}

                      {meus.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground">
                          Nenhuma regra cadastrada.
                        </p>
                      ) : (
                        meus.map((s) => (
                          <div key={s.id} className="flex flex-wrap items-center gap-2 rounded border p-2 text-xs">
                            <Badge variant="outline" className="shrink-0 text-[10px]">
                              {TIPO_CURTO[s.tipo]}
                            </Badge>
                            <span className="min-w-0 flex-1 break-words" title={s.motivo || ''}>
                              {descrever(s)}
                            </span>
                            {s.origem === 'ia' && !s.confirmado ? (
                              <Button
                                type="button" variant="outline" size="sm" className="h-6 shrink-0 px-1.5 text-[10px]"
                                onClick={() => void confirmar(s.id).catch(() => toast.error('Erro ao confirmar'))}
                                title="Proposta pela IA e ainda não conferida por gente"
                              >
                                <Check className="mr-1 h-3 w-3" /> confirmar
                              </Button>
                            ) : null}
                            <Button
                              type="button" variant="ghost" size="sm"
                              className="h-6 shrink-0 px-1.5 text-muted-foreground hover:text-destructive"
                              onClick={() => void apagar(s)}
                              title="Remover esta regra"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        ))
                      )}

                      {formDe === m.id ? (
                        <div className="space-y-2 rounded-md border border-dashed p-2.5">
                          <Select
                            value={rascunho.tipo}
                            onValueChange={(v) => { setRascunho(vazio(v as TipoSinal)); setProva(null); }}
                          >
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {(Object.keys(TIPO_LABEL) as TipoSinal[]).map((t) => (
                                <SelectItem key={t} value={t} className="text-xs">{TIPO_LABEL[t]}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          {rascunho.tipo === 'tpu' ? (
                            <div className="flex gap-2">
                              <Input
                                type="number" placeholder="código TPU (ex.: 193)"
                                className="h-8 text-xs"
                                value={rascunho.codigo ?? ''}
                                onChange={(e) => mudarRascunho({ codigo: e.target.value ? Number(e.target.value) : null })}
                              />
                              <Select
                                value={rascunho.grau ?? 'qualquer'}
                                onValueChange={(v) => mudarRascunho({ grau: v === 'qualquer' ? null : v })}
                              >
                                <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="qualquer" className="text-xs">qualquer grau</SelectItem>
                                  <SelectItem value="G1" className="text-xs">1º grau</SelectItem>
                                  <SelectItem value="G2" className="text-xs">2º grau</SelectItem>
                                  <SelectItem value="SUP" className="text-xs">superior</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          ) : null}

                          {rascunho.tipo === 'grau' ? (
                            <Select
                              value={rascunho.grau ?? ''}
                              onValueChange={(v) => mudarRascunho({ grau: v })}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="qual grau prova este marco" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="G1" className="text-xs">1º grau</SelectItem>
                                <SelectItem value="G2" className="text-xs">2º grau</SelectItem>
                                <SelectItem value="SUP" className="text-xs">instância superior</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : null}

                          {rascunho.tipo === 'email' ? (
                            <div className="grid grid-cols-3 gap-2">
                              <Select
                                value={rascunho.campo_email ?? 'despacho'}
                                onValueChange={(v) => mudarRascunho({ campo_email: v })}
                              >
                                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {Object.entries(CAMPO_EMAIL_LABEL).map(([k, v]) => (
                                    <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Input
                                placeholder="só se o status for…" className="h-8 text-xs"
                                value={rascunho.email_status ?? ''}
                                onChange={(e) => mudarRascunho({ email_status: e.target.value || null })}
                              />
                              <Input
                                placeholder="só no serviço…" className="h-8 text-xs"
                                value={rascunho.email_servico ?? ''}
                                onChange={(e) => mudarRascunho({ email_servico: e.target.value || null })}
                              />
                            </div>
                          ) : null}

                          {rascunho.tipo !== 'tpu' && rascunho.tipo !== 'grau' ? (
                            <div className="flex gap-2">
                              <Input
                                placeholder="padrão que reconhece (regex, minúsculas)"
                                className="h-8 text-xs"
                                value={rascunho.padrao ?? ''}
                                onChange={(e) => mudarRascunho({ padrao: e.target.value || null })}
                              />
                              <Input
                                placeholder="menos quando casar…"
                                className="h-8 text-xs"
                                value={rascunho.padrao_excluir ?? ''}
                                onChange={(e) => mudarRascunho({ padrao_excluir: e.target.value || null })}
                              />
                            </div>
                          ) : null}

                          <div className="flex items-center gap-2">
                            <Button
                              type="button" variant="outline" size="sm" className="h-7 text-xs"
                              disabled={!rascunhoUtil || testando}
                              onClick={() => void rodarTeste()}
                            >
                              <FlaskConical className="mr-1 h-3 w-3" />
                              {testando ? 'testando…' : 'testar'}
                            </Button>
                            <Button
                              type="button" size="sm" className="h-7 text-xs"
                              disabled={!prova || !!prova.erro || salvando}
                              onClick={() => void gravar(m)}
                              title={!prova ? 'Teste antes: não se grava sinal sem ver o que ele pega' : undefined}
                            >
                              gravar
                            </Button>
                            <Button
                              type="button" variant="ghost" size="sm" className="h-7 text-xs"
                              onClick={() => { setFormDe(null); setProva(null); }}
                            >
                              cancelar
                            </Button>
                          </div>

                          {prova ? (
                            prova.erro ? (
                              <p className="rounded border border-destructive/40 bg-destructive/5 p-2 text-[11px] text-destructive">
                                {prova.erro}
                              </p>
                            ) : (
                              <div className="space-y-1.5 rounded border bg-muted/40 p-2">
                                <p className="text-[11px]">
                                  Pegaria <b>{prova.alvos}</b> {prova.unidade}
                                  {' '}em <b>{prova.ocorrencias}</b> ocorrência(s), de{' '}
                                  {dataCurta(prova.primeira)} a {dataCurta(prova.ultima)}.
                                  {prova.alvos === 0 ? ' Nada casa — a regra não vale de nada assim.' : ''}
                                </p>
                                {prova.amostra?.length ? (
                                  <>
                                    <p className="text-[10px] font-medium text-muted-foreground">
                                      Leia antes de gravar — é a frase que o padrão casa:
                                    </p>
                                    <ul className="space-y-0.5">
                                      {prova.amostra.map((a, i) => (
                                        <li key={i} className="truncate text-[10px] text-muted-foreground" title={a.texto}>
                                          <span className="mr-1 font-mono">{dataCurta(a.data)}</span>
                                          {a.texto}
                                        </li>
                                      ))}
                                    </ul>
                                  </>
                                ) : null}
                              </div>
                            )
                          ) : null}
                        </div>
                      ) : (
                        <Button
                          type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs"
                          onClick={() => abrirForm(m.id)}
                        >
                          <Plus className="mr-1 h-3 w-3" /> adicionar regra
                        </Button>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
