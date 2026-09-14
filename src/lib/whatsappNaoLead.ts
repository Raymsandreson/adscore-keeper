/**
 * Conversa marcada como "não é lead, é só contato".
 *
 * Nem toda conversa é uma venda em potencial: parceiro, fornecedor, advogado da
 * outra parte, grupo da família. Antes desta marcação o sistema só sabia dizer
 * "sem lead vinculado" — que é AUSÊNCIA de dado, não decisão. As duas coisas
 * caíam na mesma pilha do filtro "Sem lead", e a IA continuava criando lead para
 * o mesmo telefone toda vez que chegava mensagem nova.
 *
 * A marcação vale para o TELEFONE, não para o par telefone+instância: o lead é
 * criado por `leads.lead_phone`, então marcar em um número da casa e deixar
 * passar no outro reabriria o buraco. `instance_name` é registro de onde foi
 * marcado.
 *
 * Banco: Externo (kmedldlepwiityjsdahz), tabela `whatsapp_nao_lead`
 * (supabase/migrations/20260914200000_conversa_marcada_como_nao_lead.sql).
 * Sem a tabela a caixa de entrada continua funcionando: só perde o filtro.
 */
import { db, ensureExternalSession } from '@/integrations/supabase';

const TABLE = 'whatsapp_nao_lead';
const CHANGED_EVENT = 'whatsapp-nao-lead:changed';

export interface WhatsAppNaoLeadMark {
  phone: string;
  instance_name: string | null;
  motivo: string | null;
  marcado_por: string | null;
  created_at: string;
}

export interface WhatsAppNaoLeadChangedDetail {
  phone: string;
  marcado: boolean;
}

/**
 * Mesma forma usada em `whatsappMessageActivities`: a tabela é nova e ainda não
 * está nos types gerados do Externo, então o acesso passa por esta ponte mínima
 * em vez de espalhar `as any` pelo arquivo.
 */
type UntypedQuery<Row> = PromiseLike<{ data: Row[] | null; error: unknown }> & {
  eq: (column: string, value: string) => UntypedQuery<Row>;
  limit: (count: number) => UntypedQuery<Row>;
  maybeSingle: () => PromiseLike<{ data: Row | null; error: unknown }>;
};

type UntypedTable = {
  select: <Row>(columns: string) => UntypedQuery<Row>;
  insert: (row: Record<string, unknown>) => PromiseLike<{ error: unknown }>;
  delete: () => { eq: (column: string, value: string) => PromiseLike<{ error: unknown }> };
};

const naoLeadTable = () => (db as unknown as { from: (table: string) => UntypedTable }).from(TABLE);

/** Teto de leitura — a marcação é rara por natureza; 5000 cobre anos de triagem. */
const MAX_MARKS = 5000;

/**
 * Telefone no formato em que a marcação é gravada e comparada: só dígitos.
 * Grupo entra igual (o JID vira os dígitos do id), então grupo também pode ser
 * marcado como "não é lead".
 */
export function normalizarTelefoneNaoLead(raw: string | null | undefined): string {
  if (!raw) return '';
  return String(raw).replace(/@[^@]+$/, '').replace(/\D/g, '');
}

/** Telefones marcados como "não é lead". Usado pelos filtros da caixa de entrada. */
export async function loadPhonesNaoLead(): Promise<Set<string>> {
  await ensureExternalSession();
  const { data, error } = await naoLeadTable()
    .select<{ phone: string }>('phone')
    .limit(MAX_MARKS);
  if (error) throw error;
  const phones = new Set<string>();
  for (const row of data || []) {
    const normalizado = normalizarTelefoneNaoLead(row.phone);
    if (normalizado) phones.add(normalizado);
  }
  return phones;
}

/** A marcação de uma conversa só (quem marcou, quando, por quê) — ou null. */
export async function loadMarcaNaoLead(phone: string): Promise<WhatsAppNaoLeadMark | null> {
  const normalizado = normalizarTelefoneNaoLead(phone);
  if (!normalizado) return null;
  await ensureExternalSession();
  const { data, error } = await naoLeadTable()
    .select<WhatsAppNaoLeadMark>('phone, instance_name, motivo, marcado_por, created_at')
    .eq('phone', normalizado)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/**
 * Marca a conversa. A partir daqui o agente IA e o CTWA param de criar lead para
 * este telefone (a checagem vive nas edges `execute-agent-automations` e
 * `whatsapp-webhook`).
 */
export async function marcarConversaComoNaoLead(params: {
  phone: string;
  instanceName?: string | null;
  motivo?: string | null;
  marcadoPor: string;
}): Promise<boolean> {
  const normalizado = normalizarTelefoneNaoLead(params.phone);
  if (!normalizado) return false;
  await ensureExternalSession();
  const { error } = await naoLeadTable().insert({
    phone: normalizado,
    instance_name: params.instanceName || null,
    motivo: params.motivo?.trim() || null,
    marcado_por: params.marcadoPor,
  });
  if (error) throw error;
  notifyNaoLeadChanged({ phone: normalizado, marcado: true });
  return true;
}

/** Desfaz a marcação — a conversa volta a poder virar lead, inclusive pela IA. */
export async function desmarcarConversaNaoLead(phone: string): Promise<boolean> {
  const normalizado = normalizarTelefoneNaoLead(phone);
  if (!normalizado) return false;
  await ensureExternalSession();
  const { error } = await naoLeadTable().delete().eq('phone', normalizado);
  if (error) throw error;
  notifyNaoLeadChanged({ phone: normalizado, marcado: false });
  return true;
}

export function notifyNaoLeadChanged(detail: WhatsAppNaoLeadChangedDetail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<WhatsAppNaoLeadChangedDetail>(CHANGED_EVENT, { detail }));
}

export function subscribeNaoLeadChanged(handler: (detail: WhatsAppNaoLeadChangedDetail) => void) {
  if (typeof window === 'undefined') return () => {};
  const listener = (event: Event) => {
    const custom = event as CustomEvent<WhatsAppNaoLeadChangedDetail>;
    if (custom.detail) handler(custom.detail);
  };
  window.addEventListener(CHANGED_EVENT, listener as EventListener);
  return () => window.removeEventListener(CHANGED_EVENT, listener as EventListener);
}
