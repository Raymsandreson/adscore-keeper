import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import {
  Gavel, FileText, MapPin, Building2, Scale, Users, Calendar, ExternalLink,
  Hash, Globe, Eye, AlertTriangle, Info, Clock, BookOpen, Landmark
} from 'lucide-react';

interface ProcessDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  process: any;
}

function InfoField({ label, value, icon: Icon, copyable }: { label: string; value: any; icon?: any; copyable?: boolean }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex items-start gap-2 py-1.5">
      {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />}
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</p>
        <p className="text-xs break-words">{String(value)}</p>
      </div>
    </div>
  );
}

function Section({ title, children, icon: Icon }: { title: string; children: React.ReactNode; icon?: any }) {
  return (
    <div className="space-y-1">
      <h3 className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
        {Icon && <Icon className="h-3.5 w-3.5 text-primary" />}
        {title}
      </h3>
      <div className="pl-1">{children}</div>
    </div>
  );
}

export default function ProcessDetailSheet({ open, onOpenChange, process }: ProcessDetailSheetProps) {
  if (!process) return null;

  const p = process;
  const envolvidos = Array.isArray(p.envolvidos) ? p.envolvidos : [];
  const audiencias = Array.isArray(p.audiencias) ? p.audiencias : [];
  const processosRelacionados = Array.isArray(p.processos_relacionados) ? p.processos_relacionados : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg p-0">
        <SheetHeader className="p-4 pb-2">
          <SheetTitle className="text-sm flex items-center gap-2">
            {p.process_type === 'judicial' ? (
              <Gavel className="h-4 w-4 text-orange-500" />
            ) : (
              <FileText className="h-4 w-4 text-blue-500" />
            )}
            Detalhes do Processo
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-80px)] px-4 pb-6">
          <div className="space-y-4">

            {/* Header */}
            <div className="space-y-1">
              <p className="text-sm font-semibold">{p.title}</p>
              {p.process_number && (
                <p className="text-xs text-muted-foreground font-mono">Nº {p.process_number}</p>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary" className="text-[10px]">
                  {p.status === 'em_andamento' ? 'Em Andamento' : p.status === 'concluido' ? 'Concluído' : p.status === 'arquivado' ? 'Arquivado' : p.status}
                </Badge>
                {p.situacao && (
                  <Badge variant="outline" className="text-[10px]">{p.situacao}</Badge>
                )}
                {p.status_predito && (
                  <Badge variant="outline" className="text-[10px]">{p.status_predito}</Badge>
                )}
                {p.segredo_justica && (
                  <Badge variant="destructive" className="text-[10px]">Segredo de Justiça</Badge>
                )}
                {p.fisico && (
                  <Badge variant="outline" className="text-[10px]">Processo Físico</Badge>
                )}
              </div>
            </div>

            <Separator />

            {/* Partes */}
            <Section title="Partes" icon={Users}>
              <InfoField label="Polo Ativo (Autor)" value={p.polo_ativo} />
              <InfoField label="Polo Passivo (Réu)" value={p.polo_passivo} />
            </Section>

            <Separator />

            {/* Dados do Processo */}
            <Section title="Dados do Processo" icon={Scale}>
              <InfoField label="Classe" value={p.classe} icon={BookOpen} />
              <InfoField label="Área" value={p.area} icon={Landmark} />
              <InfoField label="Assunto Principal" value={p.assunto_principal} />
              {p.assuntos?.length > 0 && (
                <div className="py-1.5">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Assuntos</p>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {p.assuntos.map((a: string, i: number) => (
                      <Badge key={i} variant="outline" className="text-[10px]">{a}</Badge>
                    ))}
                  </div>
                </div>
              )}
              <InfoField label="Órgão Julgador" value={p.orgao_julgador} icon={Building2} />
              <InfoField label="Valor da Causa" value={p.valor_causa_formatado || (p.valor_causa ? `R$ ${Number(p.valor_causa).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : null)} />
              <InfoField label="Tipo" value={p.process_type === 'judicial' ? 'Judicial' : 'Administrativo'} />
              {p.fee_percentage != null && (
                <InfoField label="Honorários" value={`${p.fee_percentage}%`} />
              )}
              {p.estimated_fee_value != null && (
                <InfoField label="Valor Estimado Honorários" value={`R$ ${Number(p.estimated_fee_value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} />
              )}
              <InfoField label="Informações Complementares" value={p.informacoes_complementares} />
            </Section>

            <Separator />

            {/* Tribunal / Fonte */}
            <Section title="Tribunal / Fonte" icon={Landmark}>
              <InfoField label="Tribunal" value={p.tribunal} />
              <InfoField label="Sigla" value={p.tribunal_sigla} />
              <InfoField label="Grau" value={p.grau} />
              <InfoField label="Sistema" value={p.sistema} />
              <InfoField label="Fonte" value={p.fonte_nome} />
              <InfoField label="Tipo da Fonte" value={p.fonte_tipo} />
              {p.url_tribunal && (
                <div className="py-1.5">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Link no Tribunal</p>
                  <a
                    href={p.url_tribunal}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                  >
                    <ExternalLink className="h-3 w-3" /> Abrir no tribunal
                  </a>
                </div>
              )}
            </Section>

            <Separator />

            {/* Localização / Origem */}
            <Section title="Localização de Origem" icon={MapPin}>
              <InfoField label="Estado" value={p.estado_origem ? `${p.estado_origem} (${p.estado_origem_sigla || ''})` : null} />
              <InfoField label="Unidade de Origem" value={p.unidade_origem} icon={Building2} />
              <InfoField label="Endereço" value={p.unidade_origem_endereco} />
              <InfoField label="Classificação" value={p.unidade_origem_classificacao} />
              <InfoField label="Cidade" value={p.unidade_origem_cidade} />
            </Section>

            <Separator />

            {/* Datas */}
            <Section title="Datas" icon={Calendar}>
              <InfoField label="Ano de Início" value={p.ano_inicio} />
              <InfoField label="Data de Início" value={p.data_inicio} />
              <InfoField label="Data de Distribuição" value={p.data_distribuicao} />
              <InfoField label="Data Início na Fonte" value={p.fonte_data_inicio} />
              <InfoField label="Última Movimentação" value={p.data_ultima_movimentacao} />
              <InfoField label="Data de Arquivamento" value={p.data_arquivamento} />
              <InfoField label="Última Verificação (Escavador)" value={p.data_ultima_verificacao} />
              <InfoField label="Qtd. Movimentações" value={p.quantidade_movimentacoes} icon={Hash} />
            </Section>

            <Separator />

            {/* Flags */}
            <Section title="Informações Adicionais" icon={Info}>
              <InfoField label="Segredo de Justiça" value={p.segredo_justica === true ? 'Sim' : p.segredo_justica === false ? 'Não' : null} icon={Eye} />
              <InfoField label="Arquivado" value={p.arquivado === true ? 'Sim' : p.arquivado === false ? 'Não' : null} />
              <InfoField label="Status Predito" value={p.status_predito} />
              <InfoField label="Processo Físico" value={p.fisico === true ? 'Sim' : p.fisico === false ? 'Não' : null} />
              <InfoField label="Fluxo de Trabalho" value={p.workflow_name} />
            </Section>

            {/* Envolvidos */}
            {envolvidos.length > 0 && (
              <>
                <Separator />
                <Section title={`Envolvidos (${envolvidos.length})`} icon={Users}>
                  <div className="space-y-2 mt-1">
                    {envolvidos.map((env: any, i: number) => (
                      <div key={i} className="border rounded p-2 bg-muted/30 space-y-0.5">
                        <p className="text-xs font-medium">{env.nome || env.nome_normalizado || 'N/A'}</p>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {(env.tipo_normalizado || env.tipo) && (
                            <Badge variant="outline" className="text-[9px]">{env.tipo_normalizado || env.tipo}</Badge>
                          )}
                          {env.polo && env.polo !== 'NENHUM' && (
                            <Badge variant="secondary" className="text-[9px]">Polo {env.polo}</Badge>
                          )}
                        </div>
                        {env.cpf && <p className="text-[10px] text-muted-foreground">CPF: {env.cpf}</p>}
                        {env.oabs?.length > 0 && (
                          <p className="text-[10px] text-muted-foreground">
                            OAB: {env.oabs.map((o: any) => `${o.numero}/${o.uf}`).join(', ')}
                          </p>
                        )}
                        {env.advogados?.length > 0 && (
                          <div className="ml-3 mt-1 space-y-1">
                            {env.advogados.map((adv: any, j: number) => (
                              <div key={j} className="text-[10px]">
                                <span className="font-medium">Adv:</span> {adv.nome || adv.nome_normalizado}
                                {adv.oabs?.length > 0 && ` (OAB: ${adv.oabs.map((o: any) => `${o.numero}/${o.uf}`).join(', ')})`}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </Section>
              </>
            )}

            {/* Audiências */}
            {audiencias.length > 0 && (
              <>
                <Separator />
                <Section title={`Audiências (${audiencias.length})`} icon={Calendar}>
                  <div className="space-y-1.5 mt-1">
                    {audiencias.map((aud: any, i: number) => (
                      <div key={i} className="border rounded p-2 bg-muted/30">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-medium">{aud.tipo || 'Audiência'}</p>
                          {aud.situacao && <Badge variant="outline" className="text-[9px]">{aud.situacao}</Badge>}
                        </div>
                        <p className="text-[10px] text-muted-foreground">{aud.data}</p>
                        {aud.quantidade_pessoas > 0 && (
                          <p className="text-[10px] text-muted-foreground">{aud.quantidade_pessoas} pessoa(s)</p>
                        )}
                      </div>
                    ))}
                  </div>
                </Section>
              </>
            )}

            {/* Processos Relacionados */}
            {processosRelacionados.length > 0 && (
              <>
                <Separator />
                <Section title={`Processos Relacionados (${processosRelacionados.length})`} icon={Globe}>
                  <div className="space-y-1 mt-1">
                    {processosRelacionados.map((pr: any, i: number) => (
                      <p key={i} className="text-xs font-mono text-muted-foreground">{pr.numero || JSON.stringify(pr)}</p>
                    ))}
                  </div>
                </Section>
              </>
            )}

            {/* Notas */}
            {(p.description || p.notes) && (
              <>
                <Separator />
                <Section title="Notas / Descrição" icon={FileText}>
                  {p.description && <p className="text-xs whitespace-pre-line">{p.description}</p>}
                  {p.notes && <p className="text-xs whitespace-pre-line text-muted-foreground mt-1">{p.notes}</p>}
                </Section>
              </>
            )}

          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
