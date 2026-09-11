// Leitura do cartão de contato (vCard) que chega pelo WhatsApp.
//
// Por que existe: quando alguém compartilha um contato na conversa, a UazAPI
// manda `messageType: "ContactMessage"` com o vCard inteiro dentro de
// `message.content.vcard`. O webhook não tinha branch para isso — a mensagem
// era gravada como texto comum e o telefone indicado se perdia no meio do
// `metadata`. É a matéria-prima da esteira de indicações.
//
// A fonte do telefone é o `waid` do vCard, NÃO o número formatado da linha TEL:
// o `waid` é o id real no WhatsApp (já com DDI, sem máscara), enquanto
// `+55 86 9927-5467` precisa ser limpo e ainda pode vir sem DDI. Exemplo real
// colhido em produção:
//
//   item1.TEL;waid=558699275467:+55 86 9927-5467
//
// Um mesmo cartão pode ter vários telefones (item1, item2…), e um
// `ContactsArrayMessage` traz vários cartões de uma vez.

/** Um contato compartilhado, já normalizado. */
export interface ContatoDoCartao {
  /** Nome de exibição do cartão (FN, ou o displayName da mensagem). */
  nome: string;
  /** Telefone no formato do WhatsApp: só dígitos, com DDI. Ex: 558699275467. */
  telefone: string | null;
  /** Empresa (ORG), quando o cartão é de um perfil comercial. */
  empresa: string | null;
  /** Telefones adicionais do mesmo cartão, se houver. */
  telefonesExtras: string[];
  /** O vCard cru, guardado para auditoria e reprocessamento. */
  vcard: string;
}

/** Só dígitos. Devolve null se não sobrar número utilizável. */
function somenteDigitos(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const limpo = valor.replace(/\D/g, '').replace(/^0+/, '');
  return limpo.length >= 8 ? limpo : null;
}

/**
 * Desdobra as linhas do vCard. O formato permite quebra de linha longa
 * continuada por espaço/tab (RFC 6350 §3.2) — sem isso um nome comprido vira
 * duas linhas e nenhuma delas casa com o prefixo.
 */
function linhasDoVcard(vcard: string): string[] {
  const brutas = vcard.replace(/\r\n/g, '\n').split('\n');
  const saida: string[] = [];
  for (const linha of brutas) {
    if ((linha.startsWith(' ') || linha.startsWith('\t')) && saida.length > 0) {
      saida[saida.length - 1] += linha.slice(1);
    } else {
      saida.push(linha);
    }
  }
  return saida;
}

/**
 * Extrai os telefones de um vCard, preferindo sempre o `waid`.
 *
 * Formatos vistos em produção:
 *   item1.TEL;waid=558699275467:+55 86 9927-5467   ← com waid (o bom)
 *   TEL;type=CELL;type=VOICE;waid=5511999999999:+55 11 99999-9999
 *   TEL;type=CELL:+55 11 99999-9999                ← sem waid, cai no formatado
 */
function telefonesDaLinha(linhas: string[]): string[] {
  const achados: string[] = [];
  for (const linha of linhas) {
    // A parte antes do primeiro ":" são os parâmetros; depois vem o valor.
    const corte = linha.indexOf(':');
    if (corte === -1) continue;
    const parametros = linha.slice(0, corte);
    const valor = linha.slice(corte + 1);
    // `item1.TEL`, `TEL;type=CELL`, `tel` — todos valem.
    if (!/(^|\.)TEL\b/i.test(parametros)) continue;

    const waid = parametros.match(/waid=(\d+)/i)?.[1];
    const telefone = somenteDigitos(waid) || somenteDigitos(valor);
    if (telefone && !achados.includes(telefone)) achados.push(telefone);
  }
  return achados;
}

/**
 * Desfaz o escape do vCard: `\,` `\;` `\\` `\n` viram vírgula, ponto-e-vírgula,
 * barra e quebra de linha. Sem isso um nome "Silva\, Maria" chega assim na tela.
 */
function desescapar(valor: string): string {
  return valor.replace(/\\([,;\\nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));
}

/** Valor da primeira linha com esse prefixo (`FN`, `ORG`…). */
function campo(linhas: string[], nome: string): string | null {
  for (const linha of linhas) {
    const corte = linha.indexOf(':');
    if (corte === -1) continue;
    const parametros = linha.slice(0, corte);
    if (!new RegExp(`(^|\\.)${nome}\\b`, 'i').test(parametros)) continue;
    const valor = desescapar(linha.slice(corte + 1)).trim();
    if (valor) return valor;
  }
  return null;
}

/**
 * `ORG` é campo ESTRUTURADO: "Empresa;Departamento;Unidade". Mostrar o valor
 * cru deixa o ponto-e-vírgula na tela — foi o que apareceu ao conferir contra
 * produção: a empresa saía como "JUNIOR;". Aqui sobram só os pedaços com
 * conteúdo, juntos por vírgula.
 */
function organizacao(linhas: string[]): string | null {
  const bruto = campo(linhas, 'ORG');
  if (!bruto) return null;
  const partes = bruto
    .split(/(?<!\\);/)
    .map(p => p.trim())
    .filter(Boolean);
  return partes.length ? partes.join(', ') : null;
}

/** Lê UM vCard. Devolve null se não houver telefone — cartão sem número não
 *  serve para indicação nenhuma (não dá para falar com a pessoa). */
export function lerVcard(vcard: string, displayNameDaMensagem?: string | null): ContatoDoCartao | null {
  if (!vcard || !/BEGIN:VCARD/i.test(vcard)) return null;
  const linhas = linhasDoVcard(vcard);
  const telefones = telefonesDaLinha(linhas);
  if (telefones.length === 0) return null;

  const empresa = organizacao(linhas);
  const nome =
    campo(linhas, 'FN') ||
    displayNameDaMensagem?.trim() ||
    campo(linhas, 'X-WA-BIZ-NAME') ||
    empresa ||
    telefones[0];

  return {
    nome: nome.trim(),
    telefone: telefones[0],
    empresa: empresa?.trim() || null,
    telefonesExtras: telefones.slice(1),
    vcard,
  };
}

/**
 * Lê o payload de mensagem da UazAPI e devolve os contatos compartilhados.
 *
 * Cobre os dois tipos que aparecem no banco: `ContactMessage` (um cartão, em
 * `content.vcard`) e `ContactsArrayMessage` (vários, em `content.contacts[]`).
 * Qualquer outro tipo devolve lista vazia — quem chama não precisa filtrar.
 */
export function contatosCompartilhados(message: unknown): ContatoDoCartao[] {
  if (!message || typeof message !== 'object') return [];
  const msg = message as Record<string, any>;

  const tipo = String(msg.messageType || '').toLowerCase();
  const mediaType = String(msg.mediaType || '').toLowerCase();
  const ehCartao = tipo.includes('contact') || mediaType === 'vcard';
  if (!ehCartao) return [];

  const content = msg.content;
  const displayName = typeof content === 'object' && content ? content.displayName : null;

  const brutos: Array<{ vcard: string; nome?: string | null }> = [];
  if (typeof content === 'object' && content !== null) {
    if (typeof content.vcard === 'string') {
      brutos.push({ vcard: content.vcard, nome: displayName });
    }
    // ContactsArrayMessage: lista de cartões, cada um com seu displayName.
    const lista = content.contacts || content.contactsArray || content.vcards;
    if (Array.isArray(lista)) {
      for (const item of lista) {
        if (typeof item === 'string') brutos.push({ vcard: item });
        else if (item && typeof item === 'object' && typeof item.vcard === 'string') {
          brutos.push({ vcard: item.vcard, nome: item.displayName || null });
        }
      }
    }
  } else if (typeof content === 'string' && /BEGIN:VCARD/i.test(content)) {
    brutos.push({ vcard: content, nome: displayName });
  }

  const saida: ContatoDoCartao[] = [];
  const jaVistos = new Set<string>();
  for (const bruto of brutos) {
    const contato = lerVcard(bruto.vcard, bruto.nome ?? displayName);
    if (!contato || !contato.telefone) continue;
    if (jaVistos.has(contato.telefone)) continue;
    jaVistos.add(contato.telefone);
    saida.push(contato);
  }
  return saida;
}
