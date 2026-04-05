import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, AlertTriangle, Info, Shield, Zap, MessageSquare, FileText } from 'lucide-react';
import { Separator } from '@/components/ui/separator';

interface ShortcutFormState {
  shortcut_name: string;
  description: string;
  template_token: string;
  template_name: string;
  prompt_instructions: string;
  media_extraction_prompt: string;
  base_prompt: string;
  agent_name: string;
  assistant_type: string;
  skip_confirmation: boolean;
  partial_min_fields: string[];
  history_limit: number;
  model: string;
  temperature: number;
  response_delay_seconds: number;
  reply_with_audio: boolean;
  reply_voice_id: string | null;
  respond_in_groups: boolean;
  split_messages: boolean;
  split_delay_seconds: number;
  request_documents: boolean;
  document_types: string[];
  document_type_modes: Record<string, 'required' | 'optional'>;
  send_window_start_hour: number;
  send_window_end_hour: number;
  zapsign_settings: Record<string, any>;
}

interface PredefinedFieldConfig {
  field: string;
  mode: string;
  value?: string;
}

interface TemplateField {
  key: string;
  label: string;
  required: boolean;
}

interface Props {
  form: ShortcutFormState;
  templateFields: TemplateField[];
  predefinedFields: PredefinedFieldConfig[];
}

// ══════════════════════════════════════════════════════════
// REGRAS FIXAS — Fonte Única de Verdade
// Estas mesmas regras são usadas nos handlers (new-command.ts e follow-up.ts)
// ══════════════════════════════════════════════════════════

export const FIXED_RULES_NEW_COMMAND = [
  'NACIONALIDADE: se tem CPF brasileiro, use "brasileiro(a)"',
  'WHATSAPP escritório: "(86)99447-3226"',
  'EMAIL escritório: "contato@prudencioadv.com"',
  'Datas: DD/MM/AAAA',
  'Campos DATA_ASSINATURA/DATA_PROCURACAO: preenchidos com data de hoje automaticamente',
  'Use SOMENTE campos que existem no template ZapSign',
];

export const FIXED_RULES_FOLLOWUP = [
  { rule: 'Seguir identidade/persona em tom e estilo', key: 'persona' },
  { rule: 'Cliente confirmando (sim, ok) → gerar documento', key: 'confirm' },
  { rule: 'Cliente corrigindo → atualizar e resumir', key: 'correct' },
  { rule: 'Faltam dados → pedir naturalmente no tom da persona', key: 'collect' },
  { rule: 'CEP é OPCIONAL — nunca insistir', key: 'cep' },
  { rule: 'DATA_ASSINATURA/DATA_PROCURACAO → automático, não perguntar', key: 'dates' },
  { rule: 'CIDADE/ESTADO de assinatura → sincronizados automaticamente', key: 'location' },
  { rule: 'Nome parcial → pedir confirmação se já tem nome completo', key: 'name' },
  { rule: 'Usar nomes EXATOS dos campos do template', key: 'exact_names' },
  { rule: 'Aceitar bairros/locais sem questionar', key: 'accept_locations' },
  { rule: 'ENDERECO_COMPLETO: rua + número + bairro', key: 'address' },
  { rule: 'NUNCA inventar links ou URLs', key: 'no_links' },
  { rule: 'Ao confirmar, não mencionar link — dizer que vai preparar o documento', key: 'confirm_msg' },
  { rule: 'NUNCA dizer que é IA, robô ou que não consegue ler documentos', key: 'no_reveal' },
];

export const CONVERSATION_STYLE_RULES = [
  'Usar tom da identidade/persona definida',
  '✅/❌ para resumos, conversa normal em frases corridas',
  'Aceitar o que o cliente diz, se corrigir atualizar sem questionar',
  'Não ser robótico — integrar pedidos de dados naturalmente',
];

// ══════════════════════════════════════════════════════════

const today = new Date().toLocaleDateString("pt-BR");

function resolvePredefinedDisplay(pf: PredefinedFieldConfig): string {
  switch (pf.mode) {
    case 'today': return `data de hoje (${today})`;
    case 'brazilian_nationality': return '"Brasileira" / "Brasileiro"';
    case 'client_phone': return 'telefone do cliente (WhatsApp)';
    case 'fixed_value': return pf.value ? `"${pf.value}"` : '(valor fixo não definido ⚠️)';
    default: return `[${pf.mode}]`;
  }
}

function Section({ icon: Icon, title, children, variant = 'default' }: { 
  icon: any; title: string; children: React.ReactNode; variant?: 'default' | 'warning' | 'error' | 'success' 
}) {
  const borderColor = {
    default: 'border-border',
    warning: 'border-yellow-500/30',
    error: 'border-destructive/30',
    success: 'border-green-500/30',
  }[variant];

  return (
    <div className={`rounded-lg border ${borderColor} p-3 space-y-2`}>
      <div className="flex items-center gap-2 text-xs font-semibold">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </div>
      {children}
    </div>
  );
}

export function SuperPromptDiagnostic({ form, templateFields, predefinedFields }: Props) {
  const isAssistant = form.assistant_type === 'assistant';
  const predefinedKeys = new Set(predefinedFields.map(pf => pf.field.toUpperCase()));
  const minFieldKeys = new Set((form.partial_min_fields || []).map(f => f.toUpperCase()));
  const isPartialEnabled = !!form.skip_confirmation;

  // Categorize fields
  const autoFields = templateFields.filter(f => predefinedKeys.has(f.key.toUpperCase()));
  const minFields = templateFields.filter(f => !predefinedKeys.has(f.key.toUpperCase()) && isPartialEnabled && minFieldKeys.has(f.key.toUpperCase()));
  const optionalFields = templateFields.filter(f => !predefinedKeys.has(f.key.toUpperCase()) && isPartialEnabled && !minFieldKeys.has(f.key.toUpperCase()));
  const requiredFields = templateFields.filter(f => !predefinedKeys.has(f.key.toUpperCase()) && !isPartialEnabled);

  // Detect warnings
  const warnings: string[] = [];
  predefinedFields.forEach(pf => {
    const upperKey = pf.field.toUpperCase();
    if (pf.mode === 'today' && !upperKey.includes('DATA') && !upperKey.includes('DATE')) {
      const label = templateFields.find(f => f.key.toUpperCase() === upperKey)?.label || pf.field;
      warnings.push(`"${label}" configurado como "data de hoje" mas não parece ser um campo de data`);
    }
    if (pf.mode === 'fixed_value' && !pf.value) {
      warnings.push(`"${pf.field}" configurado como valor fixo mas sem valor definido`);
    }
  });

  if (!form.base_prompt?.trim()) {
    warnings.push('Nenhuma persona/prompt base definido — agente usará tom genérico');
  }
  if (templateFields.length === 0 && !isAssistant) {
    warnings.push('Nenhum template selecionado — campos serão carregados dinamicamente');
  }
  if (isPartialEnabled && minFieldKeys.size === 0 && templateFields.length > 0) {
    warnings.push('Geração parcial ativada mas nenhum campo mínimo selecionado');
  }

  return (
    <div className="space-y-3 text-xs">
      {/* ALERTS */}
      {warnings.length > 0 && (
        <Section icon={AlertTriangle} title={`${warnings.length} Alerta${warnings.length > 1 ? 's' : ''} de Configuração`} variant="warning">
          <ul className="space-y-1">
            {warnings.map((w, i) => (
              <li key={i} className="flex items-start gap-1.5 text-yellow-700 dark:text-yellow-400">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* PERSONA */}
      <Section icon={MessageSquare} title="Persona / Identidade">
        {form.base_prompt?.trim() ? (
          <div className="bg-muted/50 rounded p-2 max-h-[120px] overflow-y-auto">
            <p className="text-[11px] text-muted-foreground whitespace-pre-wrap">{form.base_prompt}</p>
          </div>
        ) : (
          <p className="text-muted-foreground italic">Sem persona definida — tom genérico de assistente jurídico</p>
        )}
        {form.prompt_instructions?.trim() && (
          <div className="mt-1">
            <span className="text-[10px] font-medium text-muted-foreground">Instruções específicas:</span>
            <div className="bg-muted/50 rounded p-2 mt-1 max-h-[80px] overflow-y-auto">
              <p className="text-[11px] text-muted-foreground whitespace-pre-wrap">{form.prompt_instructions}</p>
            </div>
          </div>
        )}
      </Section>

      {/* FIELD CATEGORIZATION */}
      {!isAssistant && (
        <Section icon={FileText} title={`Campos do Template${form.template_name ? ` — "${form.template_name}"` : ''}`}>
          {templateFields.length === 0 ? (
            <p className="text-muted-foreground italic">Nenhum template selecionado</p>
          ) : (
            <div className="space-y-2">
              {/* Auto fields */}
              {autoFields.length > 0 && (
                <div>
                  <div className="flex items-center gap-1 mb-1">
                    <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30">
                      ✅ Automático ({autoFields.length})
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">— preenchidos pelo sistema, não pergunta</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {autoFields.map(f => {
                      const pf = predefinedFields.find(p => p.field.toUpperCase() === f.key.toUpperCase())!;
                      return (
                        <span key={f.key} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-700 dark:text-blue-300">
                          {f.label} → {resolvePredefinedDisplay(pf)}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Min fields */}
              {minFields.length > 0 && (
                <div>
                  <div className="flex items-center gap-1 mb-1">
                    <Badge variant="outline" className="text-[10px] bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30">
                      ⭐ Mínimos ({minFields.length})
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">— bloqueiam geração se não coletados</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {minFields.map(f => (
                      <span key={f.key} className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-700 dark:text-orange-300">
                        {f.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Optional fields (partial enabled) */}
              {optionalFields.length > 0 && (
                <div>
                  <div className="flex items-center gap-1 mb-1">
                    <Badge variant="outline" className="text-[10px] bg-muted text-muted-foreground">
                      📝 Opcionais ({optionalFields.length})
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">— cliente preenche no formulário se não informar</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {optionalFields.map(f => (
                      <span key={f.key} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        {f.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Required fields (partial disabled) */}
              {requiredFields.length > 0 && (
                <div>
                  <div className="flex items-center gap-1 mb-1">
                    <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30">
                      🔴 Obrigatórios ({requiredFields.length})
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">— geração parcial desativada, todos são obrigatórios</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {requiredFields.map(f => (
                      <span key={f.key} className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-700 dark:text-red-300">
                        {f.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </Section>
      )}

      {/* ACTIVE RULES */}
      <Section icon={Shield} title="Regras Fixas Ativas (aplicadas pelo código)">
        <div className="space-y-1.5">
          <span className="text-[10px] font-medium text-muted-foreground">Comando Inicial:</span>
          <ul className="space-y-0.5">
            {FIXED_RULES_NEW_COMMAND.map((r, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <CheckCircle2 className="h-3 w-3 text-green-500 mt-0.5 shrink-0" />
                <span className="text-[10px] text-muted-foreground">{r}</span>
              </li>
            ))}
          </ul>
        </div>
        <Separator className="my-1.5" />
        <div className="space-y-1.5">
          <span className="text-[10px] font-medium text-muted-foreground">Estilo de Conversa:</span>
          <ul className="space-y-0.5">
            {CONVERSATION_STYLE_RULES.map((r, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <CheckCircle2 className="h-3 w-3 text-green-500 mt-0.5 shrink-0" />
                <span className="text-[10px] text-muted-foreground">{r}</span>
              </li>
            ))}
          </ul>
        </div>
        <Separator className="my-1.5" />
        <div className="space-y-1.5">
          <span className="text-[10px] font-medium text-muted-foreground">Coleta / Follow-up ({FIXED_RULES_FOLLOWUP.length} regras):</span>
          <ul className="space-y-0.5">
            {FIXED_RULES_FOLLOWUP.map((r) => (
              <li key={r.key} className="flex items-start gap-1.5">
                <CheckCircle2 className="h-3 w-3 text-green-500 mt-0.5 shrink-0" />
                <span className="text-[10px] text-muted-foreground">{r.rule}</span>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* CONFIGURATION SUMMARY */}
      <Section icon={Zap} title="Configurações Ativas">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <ConfigLine label="Modelo" value={form.model} />
          <ConfigLine label="Temperatura" value={String(form.temperature)} />
          <ConfigLine label="Histórico" value={`${form.history_limit ?? 50} msgs`} />
          <ConfigLine label="Delay resposta" value={`${form.response_delay_seconds}s`} />
          <ConfigLine label="Geração parcial" value={isPartialEnabled ? 'Ativada' : 'Desativada'} ok={isPartialEnabled} />
          <ConfigLine label="Confirmação" value={form.skip_confirmation ? 'Desativada' : 'Aguarda Sim'} />
          <ConfigLine label="Áudio" value={form.reply_with_audio ? 'Ativado' : 'Desativado'} />
          <ConfigLine label="Grupos" value={form.respond_in_groups ? 'Responde' : 'Ignora'} />
          <ConfigLine label="Split msgs" value={form.split_messages ? `Sim (${form.split_delay_seconds}s)` : 'Não'} />
          <ConfigLine label="Janela envio" value={`${form.send_window_start_hour}h - ${form.send_window_end_hour}h`} />
          {form.request_documents && (
            <ConfigLine label="Documentos" value={`${form.document_types.length} tipo(s)`} />
          )}
        </div>
      </Section>

      {/* FOOTER */}
      <div className="flex items-start gap-1.5 p-2 rounded bg-muted/30">
        <Info className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
        <p className="text-[10px] text-muted-foreground">
          Este painel mostra como suas configurações afetam o comportamento da IA. 
          As <strong>regras fixas</strong> são aplicadas pelo código e não podem ser alteradas pelo prompt. 
          A <strong>persona</strong> define o tom e estilo. Os <strong>campos</strong> são categorizados pela configuração de documento.
        </p>
      </div>
    </div>
  );
}

function ConfigLine({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className={`text-[10px] font-medium ${ok === true ? 'text-green-600 dark:text-green-400' : ok === false ? 'text-red-600 dark:text-red-400' : ''}`}>
        {value}
      </span>
    </div>
  );
}
