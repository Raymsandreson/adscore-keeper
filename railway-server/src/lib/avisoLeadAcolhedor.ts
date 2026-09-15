// =============================================================================
// Aviso de lead novo para o acolhedor — as partes puras.
//
// O acolhedor vive no WhatsApp, não na tela. Hoje ele precisa abrir o sistema
// para descobrir que entrou lead do tráfego pago; enquanto isso o lead esfria.
// Este módulo monta o aviso que vai para o WhatsApp dele: os dados do
// formulário + um link que abre a conversa com o cliente JÁ COM a primeira
// mensagem escrita.
//
// Aqui só mora função pura (texto entra, texto sai), para ter teste sem rede e
// sem banco. Quem lê o banco e manda a mensagem é
// `functions/avisar-acolhedor-lead.ts`.
//
// O NOME DA CRIANÇA É O CORAÇÃO DA PRIMEIRA MENSAGEM — E NEM SEMPRE EXISTE
// Medido no banco real em 14/09/2026, board BPC, últimos 7 dias:
//
//   origem            leads   com nome da criança
//   API da Meta         304          285  (94%)
//   planilha            327           39  (12%)
//
// O `meta-leads-sync` grava as respostas do formulário em `notes`; o
// `bpc-sheet-sync` não grava (a planilha não traz as colunas de qualificação).
// Como os dois criam no mesmo board e quem chega primeiro cria, cerca de
// metade dos leads chega sem o nome da criança.
//
// Isso NÃO é motivo para inventar o nome nem para segurar o aviso: o aviso sai
// do mesmo jeito, a primeira mensagem cai na versão sem nome, e o aviso diz na
// cara que o nome não veio — para o acolhedor não ser pego de surpresa e para o
// buraco aparecer em vez de virar silêncio.
// =============================================================================

/** Uma resposta do formulário, já com a pergunta legível. */
export type RespostasDoFormulario = Record<string, string>;

/**
 * Respostas do formulário guardadas em `leads.notes`.
 *
 * O `meta-leads-sync` escreve um bloco assim:
 *
 *   Lido direto da Meta — formulário BPC ...
 *   facebook_lead_id: 1009263962139850
 *
 *   Respostas do formulário:
 *   • qual o nome da criança: João
 *   • você tem cad único: Sim
 *
 * A chave já chega sem underscore e sem "?" (ver `formataRespostas` lá).
 * Aqui a chave é normalizada mais uma vez (minúscula, sem acento, sem
 * pontuação) para que a busca por pedaço não dependa de acento.
 */
export function respostasDoLead(notes: string | null | undefined): RespostasDoFormulario {
  const out: RespostasDoFormulario = {};
  for (const linha of String(notes || '').split('\n')) {
    const t = linha.trim();
    if (!t.startsWith('•')) continue;
    const corpo = t.replace(/^•\s*/, '');
    const corte = corpo.indexOf(':');
    if (corte <= 0) continue;
    const chave = chaveNormalizada(corpo.slice(0, corte));
    const valor = corpo.slice(corte + 1).trim();
    if (chave && valor) out[chave] = valor;
  }
  return out;
}

/** minúscula, sem acento, sem pontuação — para casar chave sem depender de acento. */
export function chaveNormalizada(texto: string): string {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Primeira resposta cuja pergunta contenha TODOS os pedaços de algum grupo. */
function respostaPor(respostas: RespostasDoFormulario, grupos: string[][]): string {
  for (const grupo of grupos) {
    for (const [pergunta, valor] of Object.entries(respostas)) {
      if (grupo.every((p) => pergunta.includes(p))) return valor;
    }
  }
  return '';
}

/**
 * Nome da criança, como o formulário do BPC pergunta.
 *
 * Busca por pedaço, e não por nome exato, porque o mesmo formulário existe em
 * mais de uma redação (`qual o nome da criança`, `nome da crianca`,
 * `nome do seu filho`). Vazio quando não veio — e vazio aqui é resposta
 * legítima, não erro: metade dos leads chega sem isso (ver o topo do arquivo).
 */
export function nomeDaCrianca(respostas: RespostasDoFormulario): string {
  const bruto = respostaPor(respostas, [
    ['nome', 'crianca'],
    ['nome', 'filho'],
    ['nome', 'filha'],
    ['nome', 'beneficiario'],
    ['nome', 'dependente'],
  ]);
  return primeiroNome(bruto);
}

/**
 * Só o primeiro nome, com a inicial maiúscula.
 *
 * A mãe escreve "JOÃO PEDRO DA SILVA SANTOS" no formulário. "Oi, é a mamãe do
 * JOÃO PEDRO DA SILVA SANTOS?" não é como gente fala — e mensagem que soa a
 * robô queima o primeiro contato, que é o único que importa aqui.
 */
export function primeiroNome(bruto: string | null | undefined): string {
  const limpo = String(bruto || '').replace(/\s+/g, ' ').trim();
  if (!limpo) return '';
  // Resposta que é número, "não sei", "-" ou similar não é nome de gente.
  if (!/\p{L}{2}/u.test(limpo)) return '';
  const primeiro = limpo.split(' ')[0];
  if (primeiro.length < 2) return '';
  return primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase();
}

/** Texto padrão da 1ª mensagem quando o formulário trouxe o nome da criança. */
export const TEMPLATE_PADRAO_COM_CRIANCA = 'Oi, é a mamãe do {crianca}?';
/** Texto padrão quando não trouxe — nunca inventar nome. */
export const TEMPLATE_PADRAO_SEM_CRIANCA = 'Oi, tudo bem? É a mamãe?';

/**
 * A primeira mensagem, já pronta para o acolhedor mandar.
 *
 * Curta de propósito: o pedido do Raym em 14/09/2026 foi "não se apresentando,
 * só é a mamãe não sei o quê" — quem se apresenta na primeira linha parece
 * telemarketing e leva bloqueio. O resto da conversa o acolhedor desenrola.
 *
 * `{crianca}` é o único marcador. Se o template tiver o marcador e o nome não
 * existir, cai no texto sem nome — nunca manda "Oi, é a mamãe do {crianca}?".
 */
export function montarMensagemInicial(args: {
  crianca?: string | null;
  templateComCrianca?: string | null;
  templateSemCrianca?: string | null;
}): string {
  const crianca = primeiroNome(args.crianca);
  if (!crianca) {
    return (args.templateSemCrianca || TEMPLATE_PADRAO_SEM_CRIANCA).replace(/\{crianca\}/g, '').trim();
  }
  const tpl = args.templateComCrianca || TEMPLATE_PADRAO_COM_CRIANCA;
  return tpl.replace(/\{crianca\}/g, crianca);
}

/** Telefone em dígitos com DDI 55. Devolve vazio quando não dá para falar com a pessoa. */
export function telefoneParaLink(bruto: string | null | undefined): string {
  const digitos = String(bruto || '').replace(/\D/g, '');
  if (digitos.length < 10) return '';
  if (digitos.startsWith('55')) return digitos.length >= 12 ? digitos : '';
  // DDD + número, sem DDI: completa o 55. Número de 8/9 dígitos SEM DDD fica de
  // fora de propósito — inventar DDD manda mensagem de cliente para o celular
  // de outra pessoa (mesma regra da skill `grupo-incerto-nao-manda-avisa`).
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  return '';
}

/**
 * Link que abre a conversa com o cliente já com a mensagem escrita.
 *
 * `wa.me` PREENCHE a caixa, não envia. É de propósito: o acolhedor lê e ajusta
 * antes de mandar, e nenhuma mensagem sai para cliente sem gente no meio.
 */
export function linkWaMe(telefone: string, mensagem: string): string {
  const numero = telefoneParaLink(telefone);
  if (!numero) return '';
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`;
}

/** Telefone bonito para ler no aviso: (86) 99999-9999. */
export function telefoneLegivel(bruto: string | null | undefined): string {
  const d = String(bruto || '').replace(/\D/g, '');
  const sem55 = d.startsWith('55') ? d.slice(2) : d;
  if (sem55.length === 11) return `(${sem55.slice(0, 2)}) ${sem55.slice(2, 7)}-${sem55.slice(7)}`;
  if (sem55.length === 10) return `(${sem55.slice(0, 2)}) ${sem55.slice(2, 6)}-${sem55.slice(6)}`;
  return bruto || '—';
}

/**
 * Valor de resposta como gente lê.
 *
 * A Meta grava a opção escolhida com underscore no lugar do espaço
 * (`até_r$_2.000,00`, visto em lead real de 15/09/2026) e em caixa baixa
 * (`não`). Cru, isso chega no WhatsApp do acolhedor parecendo dado de máquina
 * vazado na tela. Só formatação: o valor não é alterado nem interpretado.
 */
export function valorLegivel(bruto: string): string {
  const limpo = String(bruto || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  if (!limpo) return '';
  return limpo.charAt(0).toUpperCase() + limpo.slice(1);
}

/** Data e hora em Brasília, sem depender do TZ do container. */
export function horaBrasilia(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

/** As perguntas de qualificação que mudam a conversa, na ordem em que ajudam. */
const QUALIFICACAO: { rotulo: string; pedacos: string[][] }[] = [
  { rotulo: 'Já recebe BPC', pedacos: [['recebe', 'bpc'], ['bpc']] },
  { rotulo: 'Laudo/relatório', pedacos: [['laudo']] },
  { rotulo: 'Renda da família', pedacos: [['renda']] },
  { rotulo: 'CadÚnico', pedacos: [['cad', 'unico']] },
  { rotulo: 'Já tem advogado', pedacos: [['advogado']] },
  { rotulo: 'Moram na casa', pedacos: [['quantas', 'pessoas'], ['moram']] },
];

export interface LeadParaAviso {
  lead_id: string;
  nome: string | null;
  telefone: string | null;
  criado_em: string | null;
  campanha?: string | null;
  anuncio?: string | null;
  notes?: string | null;
}

export interface AvisoMontado {
  texto: string;
  link: string;
  mensagem_inicial: string;
  crianca: string;
  /** Sem telefone utilizável não há o que avisar: a pessoa não tem como falar. */
  falta_telefone: boolean;
}

/**
 * O aviso inteiro, pronto para sair no WhatsApp do acolhedor.
 *
 * Ordem pensada para o celular: quem é e o telefone primeiro (é o que ele
 * precisa para agir), qualificação depois (é o que muda o tom da conversa), e
 * o botão de falar por último — que é onde o dedo vai.
 */
export function montarAviso(
  lead: LeadParaAviso,
  cfg?: { templateComCrianca?: string | null; templateSemCrianca?: string | null },
): AvisoMontado {
  const respostas = respostasDoLead(lead.notes);
  const crianca = nomeDaCrianca(respostas);
  const mensagemInicial = montarMensagemInicial({
    crianca,
    templateComCrianca: cfg?.templateComCrianca,
    templateSemCrianca: cfg?.templateSemCrianca,
  });
  const link = linkWaMe(lead.telefone || '', mensagemInicial);

  const linhas: string[] = [
    '🔥 *Lead novo — BPC/Autismo*',
    '',
    `*Quem preencheu:* ${(lead.nome || '').trim() || '(sem nome no formulário)'}`,
  ];
  if (crianca) linhas.push(`*Criança:* ${crianca}`);
  else linhas.push('*Criança:* _o formulário não trouxe o nome_');
  linhas.push(`*Telefone:* ${telefoneLegivel(lead.telefone)}`);

  const qualificacao = QUALIFICACAO.map(({ rotulo, pedacos }) => {
    const v = valorLegivel(respostaPor(respostas, pedacos));
    return v ? `• ${rotulo}: ${v}` : '';
  }).filter(Boolean);
  if (qualificacao.length) linhas.push('', ...qualificacao);

  const rodape: string[] = [];
  if (lead.campanha) rodape.push(`📣 ${lead.campanha}`);
  if (lead.criado_em) rodape.push(`🕐 preencheu ${horaBrasilia(lead.criado_em)}`);
  if (rodape.length) linhas.push('', rodape.join(' · '));

  if (link) {
    linhas.push('', '👉 *Toque para falar com ela agora* (a mensagem já vai escrita):', link);
  } else {
    // Sem telefone utilizável o aviso ainda sai, dizendo o que falta. Aviso
    // engolido vira lead que ninguém sabe que existe.
    linhas.push('', '⚠️ *Sem telefone utilizável no formulário* — abra o lead no sistema.');
  }

  return {
    texto: linhas.join('\n'),
    link,
    mensagem_inicial: mensagemInicial,
    crianca,
    falta_telefone: !link,
  };
}

/**
 * Está dentro do horário de avisar?
 *
 * Aviso de trabalho no WhatsApp pessoal às 3h da manhã é o tipo de coisa que
 * faz a pessoa silenciar a conversa — e uma vez silenciada, nenhum aviso
 * futuro chega. O lead da madrugada não se perde: fica pendente e sai na
 * primeira rodada depois que a janela abre.
 */
export function dentroDoHorario(
  agora: Date,
  inicio: number,
  fim: number,
  timeZone = 'America/Sao_Paulo',
): boolean {
  const hora = Number(
    new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hour12: false }).format(agora),
  );
  return hora >= inicio && hora < fim;
}
