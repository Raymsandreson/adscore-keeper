import { authClient, db, ensureExternalSession } from '@/integrations/supabase';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { isWhatsAppGroupId } from '@/lib/whatsappPhone';
import { blocoDoInterlocutor } from '@/lib/tomDaConversa';
import { ehInstanciaCloud } from '@/lib/cloudApiInstances';

/**
 * Responder uma conversa do WhatsApp de FORA da tela do WhatsApp.
 *
 * O popup de notificação precisa das mesmas regras do chat — assinatura de quem
 * fala, instância certa, canal Cloud — sem carregar o painel inteiro junto.
 * Aqui fica só esse mínimo, com a parte que decide texto e instância isolada em
 * funções puras (dá para testar sem banco).
 */

export interface PreferenciasDeAssinatura {
  /** Prefixar a mensagem com quem está falando. */
  identificar: boolean;
  /** 'full' | 'first' | 'first_last' | 'nickname'. */
  formatoDoNome: string;
  /** Dr., Dra., Sr.… Vazio = sem tratamento. */
  tratamento: string;
  /** Apelido escolhido (só usado no formato 'nickname'). */
  apelido: string;
}

export interface PerfilDoRemetente {
  full_name?: string | null;
  treatment_title?: string | null;
  gender?: string | null;
}

/** Mensagem da conversa, no mínimo que o popup precisa. */
export interface MensagemDaConversa {
  direction: string | null;
  message_text: string | null;
  instance_name: string | null;
  created_at: string;
}

/** Instâncias da casa que devem falar pelos grupos, na ordem de preferência. */
const REMETENTES_DE_GRUPO = ['atendimento previdenciario', 'atendimento previdenciario 2'];

/** Espelho parado há mais de 7 dias num grupo ativo = a instância saiu do grupo. */
const SAIU_DO_GRUPO_MS = 7 * 24 * 60 * 60 * 1000;

const semAcento = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

/**
 * Quem envia por um grupo.
 *
 * Em grupo cada mensagem é espelhada por TODAS as instâncias-membro, então o
 * histórico não diz de quem é a conversa: pegar qualquer espelho fazia o envio
 * sair pela instância pessoal de alguém. Vale a instância de atendimento quando
 * ela ainda está no grupo; senão, a do espelho mais recente.
 *
 * @param mensagens Histórico em ordem CRESCENTE (mais antiga primeiro).
 */
export function escolherInstanciaDeGrupo(mensagens: Pick<MensagemDaConversa, 'instance_name' | 'created_at'>[]): string | undefined {
  const recentesPrimeiro = [...mensagens].reverse();
  const maisRecente = recentesPrimeiro.find(m => m.instance_name);
  const preferida = recentesPrimeiro.find(
    m => m.instance_name && REMETENTES_DE_GRUPO.includes(semAcento(m.instance_name)),
  );
  const aindaNoGrupo =
    preferida && maisRecente &&
    new Date(maisRecente.created_at).getTime() - new Date(preferida.created_at).getTime() <= SAIU_DO_GRUPO_MS;
  if (aindaNoGrupo && preferida?.instance_name) return preferida.instance_name;
  return maisRecente?.instance_name;
}

/**
 * Prefixo de identidade da mensagem — o mesmo do chat, para a resposta pelo
 * popup não sair com cara diferente das outras.
 */
export function textoIdentificado(
  mensagem: string,
  prefs: PreferenciasDeAssinatura,
  perfil: PerfilDoRemetente | null,
): string {
  if (!prefs.identificar) return mensagem;

  if (prefs.formatoDoNome === 'nickname' && prefs.apelido) {
    return `*${prefs.apelido}:*\n${mensagem}`;
  }

  const nomeCompleto = perfil?.full_name?.trim();
  if (!nomeCompleto) return mensagem;

  let nome = nomeCompleto;
  if (prefs.formatoDoNome === 'first') {
    nome = nomeCompleto.split(' ')[0];
  } else if (prefs.formatoDoNome === 'first_last') {
    const partes = nomeCompleto.split(' ').filter(Boolean);
    nome = partes.length > 1 ? `${partes[0]} ${partes[partes.length - 1]}` : partes[0];
  }

  const tratamento = prefs.tratamento.trim();
  return `*${tratamento ? `${tratamento} ${nome}` : nome}:*\n${mensagem}`;
}

/** Tratamento padrão de quem nunca escolheu um, pelo gênero do perfil. */
export function tratamentoPadrao(perfil: PerfilDoRemetente | null): string {
  if (perfil?.treatment_title) return perfil.treatment_title;
  if (perfil?.gender === 'female') return 'Dra.';
  if (perfil?.gender === 'male') return 'Dr.';
  return '';
}

/**
 * Preferências de assinatura desta conversa — as MESMAS chaves que o chat grava,
 * então mudar o formato lá vale aqui e vice-versa.
 */
export function lerPreferenciasDeAssinatura(phone: string, perfil: PerfilDoRemetente | null): PreferenciasDeAssinatura {
  const ler = (chave: string) => {
    try {
      return localStorage.getItem(chave);
    } catch {
      return null;
    }
  };

  return {
    identificar: ler(`wa-identify-sender:${phone}`) !== 'false',
    formatoDoNome: ler(`wa-name-format:${phone}`) || 'first_last',
    tratamento: ler(`wa-treatment:${phone}`) ?? tratamentoPadrao(perfil),
    apelido: ler(`wa-selected-nickname:${phone}`) || '',
  };
}

/** Últimas mensagens da conversa — contexto da sugestão de IA e da instância de envio. */
export async function historicoDaConversa(
  phone: string,
  instanceName: string | null,
  limite = 20,
): Promise<MensagemDaConversa[]> {
  // Conversa é dado de negócio: vem do Supabase Externo, igual ao painel do chat.
  await ensureExternalSession().catch(() => {});
  let query = db
    .from('whatsapp_messages')
    .select('direction, message_text, instance_name, created_at')
    .eq('phone', phone)
    .order('created_at', { ascending: false })
    .limit(limite);

  // Grupo: as linhas de TODAS as instâncias-membro contam — é delas que sai a
  // escolha de quem envia. Conversa normal fica presa à instância do aviso.
  if (instanceName && !isWhatsAppGroupId(phone)) query = query.eq('instance_name', instanceName);

  const { data } = await query;
  return ((data as MensagemDaConversa[]) || []).slice().reverse();
}

/**
 * Transcrição para a IA ler (Eu = atendente).
 *
 * Em grupo a mesma fala aparece uma vez por instância-membro que a espelhou —
 * sem cortar a repetição, a IA leria a conversa em triplicata.
 */
export function transcricaoDaConversa(mensagens: MensagemDaConversa[], nomeDoContato?: string | null): string {
  const linhas: string[] = [];
  for (const m of mensagens) {
    const texto = String(m.message_text || '').trim();
    if (!texto) continue;
    const linha = `${m.direction === 'outbound' ? 'Eu' : (nomeDoContato || 'Cliente')}: ${texto}`;
    if (linhas[linhas.length - 1] === linha) continue;
    linhas.push(linha);
  }
  return linhas.join('\n');
}

/** Há resposta pendente? (última fala é do cliente) + as âncoras que a IA usa. */
export function pendenciaDaConversa(mensagens: MensagemDaConversa[]) {
  const comTexto = mensagens.filter(m => m.message_text && String(m.message_text).trim());
  const ultima = comTexto[comTexto.length - 1];
  const ultimaMinha = [...comTexto].reverse().find(m => m.direction === 'outbound');
  return {
    pending: !!ultima && ultima.direction !== 'outbound',
    lastOutboundText: ultimaMinha ? String(ultimaMinha.message_text).trim() : '',
    // Todas as falas seguidas dele sem resposta, não só a última: quem manda
    // quatro mensagens está fazendo uma frase só (`blocoDoInterlocutor`).
    lastClientText: blocoDoInterlocutor(comTexto),
  };
}

/** Perfil de quem está respondendo (para a assinatura). */
async function perfilDoUsuario(): Promise<PerfilDoRemetente | null> {
  const { data: auth } = await authClient.auth.getUser();
  if (!auth?.user) return null;
  const { data } = await authClient
    .from('profiles')
    .select('full_name, treatment_title, gender')
    .eq('user_id', auth.user.id)
    .maybeSingle();
  return (data as PerfilDoRemetente) || null;
}

export interface RespostaRapida {
  phone: string;
  /** Instância que recebeu a mensagem (vem do aviso). */
  instanceName: string | null;
  message: string;
  /** Histórico já carregado, quando quem chama acabou de buscar. */
  historico?: MensagemDaConversa[];
}

/**
 * Envia a resposta pelo mesmo caminho do chat (edge `send-whatsapp`).
 * Estoura erro para quem chamou avisar — o popup mostra o toast de falha.
 */
export async function enviarRespostaRapida({ phone, instanceName, message, historico }: RespostaRapida): Promise<void> {
  const texto = message.trim();
  if (!texto) throw new Error('Mensagem vazia');

  let instancia = instanceName || null;
  if (isWhatsAppGroupId(phone)) {
    const mensagens = historico ?? (await historicoDaConversa(phone, instanceName));
    instancia = escolherInstanciaDeGrupo(mensagens) || instancia;
  }
  if (!instancia) {
    const mensagens = historico ?? (await historicoDaConversa(phone, null));
    instancia = [...mensagens].reverse().find(m => m.instance_name)?.instance_name || null;
  }
  if (!instancia) throw new Error('Não sei por qual instância responder esta conversa');

  const perfil = await perfilDoUsuario();
  const finalMessage = textoIdentificado(texto, lerPreferenciasDeAssinatura(phone, perfil), perfil);

  const { data, error } = await cloudFunctions.invoke('send-whatsapp', {
    body: {
      phone,
      message: finalMessage,
      instance_name: instancia,
      // Canal Cloud API (Meta oficial) → a edge reroteia pra Railway.
      channel: ehInstanciaCloud(instancia) ? 'cloud' : undefined,
    },
  });

  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || 'Resposta inesperada do servidor');
}
