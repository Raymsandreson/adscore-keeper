import { useState, useEffect, useCallback } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Gavel, FileText, MapPin, Building2, Scale, Users, Calendar, ExternalLink,
  Hash, Eye, Info, BookOpen, Landmark, ChevronDown, Save, Loader2, Pencil
} from 'lucide-react';

interface ProcessDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  process: any;
  onUpdated?: () => void;
}

function EditableField({ label, value, onChange, type = 'text', icon: Icon }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; icon?: any;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </Label>
      <Input
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-8 text-xs"
        type={type}
      />
    </div>
  );
}

function EditableTextarea({ label, value, onChange }: {
  label: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</Label>
      <Textarea value={value} onChange={e => onChange(e.target.value)} className="text-xs min-h-[60px]" />
    </div>
  );
}

function EditableSwitch({ label, checked, onChange }: {
  label: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <Label className="text-xs">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function Section({ title, icon: Icon, defaultOpen = true, children }: {
  title: string; icon?: any; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center justify-between w-full py-2 px-3 rounded-md bg-muted/50 hover:bg-muted transition-colors">
        <span className="text-xs font-semibold flex items-center gap-1.5">
          {Icon && <Icon className="h-3.5 w-3.5 text-primary" />}
          {title}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-1 pt-2 pb-1 space-y-2">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function ProcessDetailSheet({ open, onOpenChange, process, onUpdated }: ProcessDetailSheetProps) {
  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (process) {
      setForm({ ...process });
      setDirty(false);
    }
  }, [process]);

  const set = useCallback((key: string, value: any) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  }, []);

  const handleSave = async () => {
    if (!process?.id) return;
    setSaving(true);
    try {
      const { id, created_at, updated_at, envolvidos, audiencias, processos_relacionados, escavador_raw, movimentacoes, assuntos, ...rest } = form;
      
      const payload: Record<string, any> = {};
      const editableKeys = [
        'title', 'process_number', 'status', 'process_type', 'polo_ativo', 'polo_passivo',
        'classe', 'area', 'assunto_principal', 'orgao_julgador', 'valor_causa', 'valor_causa_formatado',
        'fee_percentage', 'estimated_fee_value', 'informacoes_complementares',
        'tribunal', 'tribunal_sigla', 'grau', 'sistema', 'fonte_nome', 'fonte_tipo', 'url_tribunal',
        'estado_origem', 'estado_origem_sigla', 'unidade_origem', 'unidade_origem_endereco',
        'unidade_origem_classificacao', 'unidade_origem_cidade',
        'ano_inicio', 'data_inicio', 'data_distribuicao', 'fonte_data_inicio', 'fonte_data_fim',
        'data_ultima_movimentacao', 'data_arquivamento', 'data_ultima_verificacao',
        'quantidade_movimentacoes', 'segredo_justica', 'arquivado', 'fisico',
        'status_predito', 'situacao', 'moeda', 'description', 'notes',
        'workflow_id', 'workflow_name', 'workflow_stage_id',
      ];

      for (const key of editableKeys) {
        if (form[key] !== process[key]) {
          let val = form[key];
          if (val === '') val = null;
          if (['ano_inicio', 'quantidade_movimentacoes'].includes(key) && val != null) {
            val = Number(val) || null;
          }
          if (['fee_percentage', 'estimated_fee_value', 'valor_causa'].includes(key) && val != null) {
            val = parseFloat(val) || null;
          }
          payload[key] = val;
        }
      }

      if (Object.keys(payload).length === 0) {
        toast.info('Nenhuma alteração detectada');
        setSaving(false);
        return;
      }

      const { error } = await supabase
        .from('lead_processes')
        .update(payload)
        .eq('id', process.id);

      if (error) throw error;
      toast.success('Processo atualizado');
      setDirty(false);
      onUpdated?.();
    } catch (err: any) {
      console.error('Error updating process:', err);
      toast.error('Erro ao salvar: ' + (err.message || ''));
    } finally {
      setSaving(false);
    }
  };

  if (!process) return null;

  const envolvidos = Array.isArray(form.envolvidos) ? form.envolvidos : [];
  const audiencias = Array.isArray(form.audiencias) ? form.audiencias : [];
  const processosRelacionados = Array.isArray(form.processos_relacionados) ? form.processos_relacionados : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg p-0">
        <SheetHeader className="p-4 pb-2 flex flex-row items-center justify-between">
          <SheetTitle className="text-sm flex items-center gap-2">
            <Pencil className="h-4 w-4 text-primary" />
            Detalhes do Processo
          </SheetTitle>
          {dirty && (
            <Button size="sm" onClick={handleSave} disabled={saving} className="h-7 text-xs gap-1">
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Salvar
            </Button>
          )}
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-80px)] px-4 pb-6">
          <div className="space-y-3">

            {/* Header */}
            <div className="space-y-2 pb-2 border-b">
              <EditableField label="Título" value={form.title || ''} onChange={v => set('title', v)} />
              <EditableField label="Nº do Processo" value={form.process_number || ''} onChange={v => set('process_number', v)} icon={Hash} />
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary" className="text-[10px]">
                  {form.status === 'em_andamento' ? 'Em Andamento' : form.status === 'concluido' ? 'Concluído' : form.status === 'arquivado' ? 'Arquivado' : form.status}
                </Badge>
                {form.situacao && <Badge variant="outline" className="text-[10px]">{form.situacao}</Badge>}
                {form.segredo_justica && <Badge variant="destructive" className="text-[10px]">Segredo de Justiça</Badge>}
              </div>
            </div>

            {/* Partes */}
            <Section title="Partes" icon={Users}>
              <EditableField label="Polo Ativo (Autor)" value={form.polo_ativo || ''} onChange={v => set('polo_ativo', v)} />
              <EditableField label="Polo Passivo (Réu)" value={form.polo_passivo || ''} onChange={v => set('polo_passivo', v)} />
            </Section>

            {/* Dados do Processo */}
            <Section title="Dados do Processo" icon={Scale}>
              <EditableField label="Classe" value={form.classe || ''} onChange={v => set('classe', v)} icon={BookOpen} />
              <EditableField label="Área" value={form.area || ''} onChange={v => set('area', v)} icon={Landmark} />
              <EditableField label="Assunto Principal" value={form.assunto_principal || ''} onChange={v => set('assunto_principal', v)} />
              <EditableField label="Órgão Julgador" value={form.orgao_julgador || ''} onChange={v => set('orgao_julgador', v)} icon={Building2} />
              <EditableField label="Valor da Causa" value={form.valor_causa != null ? String(form.valor_causa) : ''} onChange={v => set('valor_causa', v)} type="number" />
              <EditableField label="Valor Formatado" value={form.valor_causa_formatado || ''} onChange={v => set('valor_causa_formatado', v)} />
              <EditableField label="Honorários (%)" value={form.fee_percentage != null ? String(form.fee_percentage) : ''} onChange={v => set('fee_percentage', v)} type="number" />
              <EditableField label="Valor Estimado Honorários" value={form.estimated_fee_value != null ? String(form.estimated_fee_value) : ''} onChange={v => set('estimated_fee_value', v)} type="number" />
              <EditableField label="Situação" value={form.situacao || ''} onChange={v => set('situacao', v)} />
              <EditableField label="Status Predito" value={form.status_predito || ''} onChange={v => set('status_predito', v)} />
              <EditableTextarea label="Informações Complementares" value={form.informacoes_complementares || ''} onChange={v => set('informacoes_complementares', v)} />
            </Section>

            {/* Tribunal / Fonte */}
            <Section title="Tribunal / Fonte" icon={Landmark} defaultOpen={false}>
              <EditableField label="Tribunal" value={form.tribunal || ''} onChange={v => set('tribunal', v)} />
              <EditableField label="Sigla" value={form.tribunal_sigla || ''} onChange={v => set('tribunal_sigla', v)} />
              <EditableField label="Grau" value={form.grau || ''} onChange={v => set('grau', v)} />
              <EditableField label="Sistema" value={form.sistema || ''} onChange={v => set('sistema', v)} />
              <EditableField label="Fonte" value={form.fonte_nome || ''} onChange={v => set('fonte_nome', v)} />
              <EditableField label="Tipo da Fonte" value={form.fonte_tipo || ''} onChange={v => set('fonte_tipo', v)} />
              <EditableField label="URL do Tribunal" value={form.url_tribunal || ''} onChange={v => set('url_tribunal', v)} />
              {form.url_tribunal && (
                <a href={form.url_tribunal} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                  <ExternalLink className="h-3 w-3" /> Abrir no tribunal
                </a>
              )}
            </Section>

            {/* Localização */}
            <Section title="Localização de Origem" icon={MapPin} defaultOpen={false}>
              <EditableField label="Estado" value={form.estado_origem || ''} onChange={v => set('estado_origem', v)} />
              <EditableField label="Sigla UF" value={form.estado_origem_sigla || ''} onChange={v => set('estado_origem_sigla', v)} />
              <EditableField label="Unidade de Origem" value={form.unidade_origem || ''} onChange={v => set('unidade_origem', v)} icon={Building2} />
              <EditableField label="Endereço" value={form.unidade_origem_endereco || ''} onChange={v => set('unidade_origem_endereco', v)} />
              <EditableField label="Classificação" value={form.unidade_origem_classificacao || ''} onChange={v => set('unidade_origem_classificacao', v)} />
              <EditableField label="Cidade" value={form.unidade_origem_cidade || ''} onChange={v => set('unidade_origem_cidade', v)} />
            </Section>

            {/* Datas */}
            <Section title="Datas" icon={Calendar} defaultOpen={false}>
              <EditableField label="Ano de Início" value={form.ano_inicio != null ? String(form.ano_inicio) : ''} onChange={v => set('ano_inicio', v)} type="number" />
              <EditableField label="Data de Início" value={form.data_inicio || ''} onChange={v => set('data_inicio', v)} />
              <EditableField label="Data de Distribuição" value={form.data_distribuicao || ''} onChange={v => set('data_distribuicao', v)} />
              <EditableField label="Data Início na Fonte" value={form.fonte_data_inicio || ''} onChange={v => set('fonte_data_inicio', v)} />
              <EditableField label="Data Fim na Fonte" value={form.fonte_data_fim || ''} onChange={v => set('fonte_data_fim', v)} />
              <EditableField label="Última Movimentação" value={form.data_ultima_movimentacao || ''} onChange={v => set('data_ultima_movimentacao', v)} />
              <EditableField label="Data de Arquivamento" value={form.data_arquivamento || ''} onChange={v => set('data_arquivamento', v)} />
              <EditableField label="Última Verificação" value={form.data_ultima_verificacao || ''} onChange={v => set('data_ultima_verificacao', v)} />
              <EditableField label="Qtd. Movimentações" value={form.quantidade_movimentacoes != null ? String(form.quantidade_movimentacoes) : ''} onChange={v => set('quantidade_movimentacoes', v)} type="number" icon={Hash} />
            </Section>

            {/* Flags */}
            <Section title="Configurações" icon={Info} defaultOpen={false}>
              <EditableSwitch label="Segredo de Justiça" checked={!!form.segredo_justica} onChange={v => set('segredo_justica', v)} />
              <EditableSwitch label="Arquivado" checked={!!form.arquivado} onChange={v => set('arquivado', v)} />
              <EditableSwitch label="Processo Físico" checked={!!form.fisico} onChange={v => set('fisico', v)} />
              <EditableField label="Fluxo de Trabalho" value={form.workflow_name || ''} onChange={v => set('workflow_name', v)} />
            </Section>

            {/* Notas */}
            <Section title="Notas / Descrição" icon={FileText} defaultOpen={false}>
              <EditableTextarea label="Descrição" value={form.description || ''} onChange={v => set('description', v)} />
              <EditableTextarea label="Notas" value={form.notes || ''} onChange={v => set('notes', v)} />
            </Section>

            {/* Envolvidos (read-only) */}
            {envolvidos.length > 0 && (
              <Section title={`Envolvidos (${envolvidos.length})`} icon={Users} defaultOpen={false}>
                <div className="space-y-2">
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
            )}

            {/* Audiências (read-only) */}
            {audiencias.length > 0 && (
              <Section title={`Audiências (${audiencias.length})`} icon={Calendar} defaultOpen={false}>
                <div className="space-y-1.5">
                  {audiencias.map((aud: any, i: number) => (
                    <div key={i} className="border rounded p-2 bg-muted/30">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-medium">{aud.tipo || 'Audiência'}</p>
                        {aud.situacao && <Badge variant="outline" className="text-[9px]">{aud.situacao}</Badge>}
                      </div>
                      <p className="text-[10px] text-muted-foreground">{aud.data}</p>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Processos Relacionados (read-only) */}
            {processosRelacionados.length > 0 && (
              <Section title={`Processos Relacionados (${processosRelacionados.length})`} icon={Scale} defaultOpen={false}>
                <div className="space-y-1">
                  {processosRelacionados.map((pr: any, i: number) => (
                    <p key={i} className="text-xs font-mono text-muted-foreground">{pr.numero || JSON.stringify(pr)}</p>
                  ))}
                </div>
              </Section>
            )}

            {/* Save button at bottom */}
            {dirty && (
              <div className="sticky bottom-0 bg-background pt-2 pb-4 border-t">
                <Button onClick={handleSave} disabled={saving} className="w-full gap-2">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Salvar alterações
                </Button>
              </div>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
