// =============================================================================
// A FICHA QUE O BANCO JÁ SABE PREENCHER.
//
// Pedido do Raym (26/08/2026), com o processo 0017007-20.2016.5.16.0019 aberto:
// a ficha estava vazia, dizendo "Nunca buscado", e a única saída oferecida era
// gastar uma consulta no Escavador. Só que o banco JÁ TINHA a resposta: a
// publicação guardada em `process_movements` traz autor, classe, vara, tribunal
// e cidade por extenso, e a nota de cadastro traz o polo passivo e o protocolo.
//
// Este módulo não consulta nada: recebe o que veio do banco e devolve os campos
// da ficha que dá para preencher, cada um com a origem escrita. Consultar é
// trabalho do hook; decidir se sobrescreve é da tela.
//
// REGRA DE HONESTIDADE: cada campo carrega `origem` — "publicação de 09/06/2017",
// "nota do cadastro", "jurimetria". Campo preenchido sem dizer de onde veio é
// palpite com cara de dado.
// =============================================================================

/** Uma publicação já guardada do processo (process_movements). */
export interface PublicacaoDoBanco {
  descricao: string | null;
  data_movimentacao: string | null;
  fonte: string | null;
}

/** Movimento do DataJud casado com o processo (vw_estacao_evidencia_datajud). */
export interface MovimentoDatajud {
  orgao_julgador: string | null;
  tribunal_alias: string | null;
  grau: string | null;
  data_hora: string | null;
}

/** Linha de jm_processos — a jurimetria da carteira, quando o CNJ está lá. */
export interface ProcessoJurimetria {
  uf_proc: string | null;
  cidade_proc: string | null;
  empresa: string | null;
  natureza: string | null;
  causa: string | null;
  data_protocolo: string | null;
}

export interface EntradaDaFicha {
  publicacoes: PublicacaoDoBanco[];
  /** lead_processes.notes — onde o inventário por OAB deixou polo passivo e protocolo. */
  notas: string | null;
  datajud: MovimentoDatajud[];
  jurimetria: ProcessoJurimetria | null;
  /** Nomes das partes na jurimetria (jm_partes.cliente). */
  partesJurimetria: string[];
}

/** Um campo da ficha que o banco consegue preencher, e de onde ele saiu. */
export interface CampoDaFicha {
  /** Nome da coluna em lead_processes. */
  campo: string;
  /** Rótulo como aparece na ficha — é o que a tela mostra no resumo. */
  rotulo: string;
  valor: string;
  origem: string;
}

const ROTULOS: Record<string, string> = {
  polo_ativo: 'Polo Ativo (Autor)',
  polo_passivo: 'Polo Passivo (Réu)',
  classe: 'Classe',
  area: 'Área',
  orgao_julgador: 'Órgão Julgador',
  tribunal: 'Tribunal',
  tribunal_sigla: 'Sigla do Tribunal',
  grau: 'Grau',
  estado_origem_sigla: 'UF de origem',
  unidade_origem_cidade: 'Cidade de origem',
  unidade_origem: 'Unidade de origem',
  unidade_origem_endereco: 'Endereço da unidade',
  data_distribuicao: 'Data de Distribuição',
  data_inicio: 'Data de início',
  ano_inicio: 'Ano de início',
  data_ultima_movimentacao: 'Última Movimentação',
};

const limpar = (v: string): string =>
  v.replace(/\s+/g, ' ').replace(/^[\s:\-–]+|[\s.:;\-–]+$/g, '').trim();

/** "TIMON" -> "Timon"; "AIRTON DE SOUSA CARVALHO" -> "Airton de Sousa Carvalho". */
export function capitalizarNome(v: string): string {
  const minusculas = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'a', 'o']);
  return limpar(v)
    .toLowerCase()
    .split(' ')
    .map((p, i) => {
      if (!p) return p;
      if (i > 0 && minusculas.has(p)) return p;
      return p[0].toUpperCase() + p.slice(1);
    })
    .join(' ');
}

const semAcento = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * O que uma intimação da Justiça do Trabalho diz sobre o processo.
 *
 * O texto vem em bloco único, MAIÚSCULO, com rótulos fixos ("AUTOR:", "CLASSE:",
 * "DESTINATÁRIO:"). Cada regex para no próximo rótulo conhecido — sem isso o
 * "AUTOR:" do fim do texto engole o resto da publicação.
 */
export function lerPublicacao(texto: string | null | undefined): Record<string, string> {
  const t = String(texto || '').replace(/\s+/g, ' ');
  if (!t) return {};
  const achado: Record<string, string> = {};

  // Rótulos que encerram o valor do rótulo anterior.
  const PARADA = '(?=\\s*(?:AUTOR|R[ÉE]U|RECLAMANTE|RECLAMAD[AO]|CLASSE|DESTINAT[ÁA]RIO|PROCESSO|C[ÓO]DIGO DE RASTREAMENTO|ADVOGADO|PODER JUDICI[ÁA]RIO)\\s*:|$)';
  const pegar = (rotulo: string): string | null => {
    const m = t.match(new RegExp(`${rotulo}\\s*:\\s*(.+?)${PARADA}`, 'i'));
    return m ? limpar(m[1]) || null : null;
  };

  const autor = pegar('AUTOR') || pegar('RECLAMANTE');
  if (autor) achado.polo_ativo = capitalizarNome(autor);

  const reu = pegar('R[ÉE]U') || pegar('RECLAMAD[AO]');
  if (reu) achado.polo_passivo = capitalizarNome(reu);

  const classe = pegar('CLASSE');
  if (classe) achado.classe = capitalizarNome(classe.replace(/\s*\(\d+\)\s*$/, ''));

  // "TRIBUNAL REGIONAL DO TRABALHO 16 a REGIÃO" / "16ª REGIÃO"
  const trt = t.match(/TRIBUNAL REGIONAL DO TRABALHO\s+(?:DA\s+)?(\d{1,2})\s*[aª°º]?\s*REGI[ÃA]O/i);
  if (trt) {
    achado.tribunal = `Tribunal Regional do Trabalho da ${trt[1]}ª Região`;
    achado.tribunal_sigla = `TRT${trt[1]}`;
    achado.area = 'Trabalhista';
  }

  // "Vara do Trabalho de Timon" — para antes do endereço (rua/avenida) ou do CEP.
  const vara = t.match(/((?:\d+[ªa°º]?\s*)?(?:Vara|Ju[íi]zo|Turma|Gabinete)[^,;]*?)(?=\s*(?:Avenida|Rua|Pra[çc]a|Travessa|Rodovia|Alameda|Estrada|Setor|CEP|,|;|$))/i);
  if (vara) {
    const nome = limpar(vara[1]);
    if (nome.length > 4) achado.orgao_julgador = capitalizarNome(nome);
  }

  // "TIMON - MA - CEP: 65630-370"
  const cidadeUf = t.match(/([A-ZÀ-Ú][A-ZÀ-Ú ]{2,})\s*[-–]\s*([A-Z]{2})\s*[-–]?\s*CEP/);
  if (cidadeUf) {
    achado.unidade_origem_cidade = capitalizarNome(cidadeUf[1]);
    achado.estado_origem_sigla = cidadeUf[2].toUpperCase();
  }

  const endereco = t.match(/((?:Avenida|Rua|Pra[çc]a|Travessa|Rodovia|Alameda|Estrada)\s+[^,]{2,}?,[^,]{1,80}?CEP:\s*[\d.-]+)/i);
  if (endereco) achado.unidade_origem_endereco = limpar(endereco[1]);

  const destinatario = pegar('DESTINAT[ÁA]RIO');
  if (destinatario) achado.destinatario = capitalizarNome(destinatario);

  return achado;
}

/**
 * O que a nota do cadastro diz. O inventário por OAB grava em texto corrido o
 * que a API não devolveu — e é a única fonte do polo passivo em toda ficha
 * criada por ele.
 */
export function lerNotas(notas: string | null | undefined): Record<string, string> {
  const t = String(notas || '').replace(/\s+/g, ' ');
  if (!t) return {};
  const achado: Record<string, string> = {};

  const passivo = t.match(/polo passivo\s*:\s*([^.;\n]+)/i);
  if (passivo) achado.polo_passivo = limpar(passivo[1]);

  const ativo = t.match(/polo ativo\s*:\s*([^.;\n]+)/i);
  if (ativo) achado.polo_ativo = limpar(ativo[1]);

  const protocolo = t.match(/protocolo\s*:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  if (protocolo) achado.data_distribuicao = `${protocolo[3]}-${protocolo[2]}-${protocolo[1]}`;

  return achado;
}

/** Data ISO (YYYY-MM-DD) de um timestamp qualquer. */
const soData = (v: string | null | undefined): string | null => {
  const m = String(v || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};

const dataBR = (iso: string | null | undefined): string => {
  const d = soData(iso);
  return d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : 'sem data';
};

/**
 * Junta tudo que o banco sabe e devolve os campos preenchíveis, sem repetir.
 *
 * ORDEM DE PRECEDÊNCIA (primeiro que fala, vale): publicação mais antiga
 * (é a que traz a capa do processo: autor, classe, vara) → nota do cadastro →
 * DataJud → jurimetria. Quem chega depois só entra em campo ainda vazio.
 */
export function fichaDoBanco(entrada: EntradaDaFicha): CampoDaFicha[] {
  const campos = new Map<string, CampoDaFicha>();
  const por = (campo: string, valor: string | null | undefined, origem: string) => {
    const v = typeof valor === 'string' ? limpar(valor) : '';
    if (!v || campos.has(campo)) return;
    campos.set(campo, { campo, rotulo: ROTULOS[campo] || campo, valor: v, origem });
  };

  // 1. Publicações — da mais antiga para a mais nova (a capa está na primeira).
  const publicacoes = [...entrada.publicacoes].sort(
    (a, b) => String(a.data_movimentacao || '').localeCompare(String(b.data_movimentacao || '')),
  );
  for (const p of publicacoes) {
    const lido = lerPublicacao(p.descricao);
    const origem = `publicação de ${dataBR(p.data_movimentacao)}`;
    for (const [campo, valor] of Object.entries(lido)) {
      if (campo === 'destinatario') continue; // não é campo da ficha; serve ao nosso polo
      por(campo, valor, origem);
    }
  }

  // 2. Nota do cadastro.
  for (const [campo, valor] of Object.entries(lerNotas(entrada.notas))) {
    por(campo, valor, 'nota do cadastro');
  }

  // 3. DataJud — o movimento mais recente carrega o órgão e o grau atuais.
  const dj = [...entrada.datajud].sort(
    (a, b) => String(b.data_hora || '').localeCompare(String(a.data_hora || '')),
  )[0];
  if (dj) {
    por('orgao_julgador', dj.orgao_julgador, 'DataJud');
    por('grau', dj.grau, 'DataJud');
    por('tribunal_sigla', dj.tribunal_alias, 'DataJud');
  }

  // 4. Jurimetria da carteira.
  const jm = entrada.jurimetria;
  if (jm) {
    por('polo_passivo', jm.empresa, 'jurimetria');
    por('unidade_origem_cidade', jm.cidade_proc, 'jurimetria');
    por('estado_origem_sigla', jm.uf_proc, 'jurimetria');
    por('data_distribuicao', soData(jm.data_protocolo), 'jurimetria');
  }
  if (!campos.has('polo_ativo') && entrada.partesJurimetria.length) {
    por('polo_ativo', entrada.partesJurimetria.map(capitalizarNome).join(', '), 'partes da jurimetria');
  }

  // 5. Derivados de quem já entrou.
  const distribuicao = campos.get('data_distribuicao');
  if (distribuicao) {
    por('data_inicio', distribuicao.valor, distribuicao.origem);
    por('ano_inicio', distribuicao.valor.slice(0, 4), distribuicao.origem);
  }
  const ultima = publicacoes[publicacoes.length - 1];
  if (ultima) {
    por('data_ultima_movimentacao', soData(ultima.data_movimentacao), `publicação de ${dataBR(ultima.data_movimentacao)}`);
  }

  return Array.from(campos.values());
}

/**
 * De que lado estamos, quando a publicação diz.
 *
 * A intimação nomeia o DESTINATÁRIO — o advogado que o tribunal intimou. Se
 * esse advogado é do escritório e a mesma publicação nomeia o autor, então
 * representamos o polo ATIVO. Só afirma quando os dois nomes aparecem: chutar o
 * polo erra a saudação da mensagem que vai para o cliente.
 */
export function detectarNossoPolo(
  publicacoes: PublicacaoDoBanco[],
  advogadosDoEscritorio: string[],
): { polo: 'ATIVO' | 'PASSIVO'; advogado: string; parte: string } | null {
  const nossos = advogadosDoEscritorio.filter(Boolean);
  if (!nossos.length) return null;
  for (const p of publicacoes) {
    const lido = lerPublicacao(p.descricao);
    const dest = lido.destinatario ? semAcento(lido.destinatario) : '';
    if (!dest) continue;
    const advogado = nossos.find((a) => {
      const n = semAcento(a);
      return n.length > 5 && (dest.includes(n) || n.includes(dest));
    });
    if (!advogado) continue;
    if (lido.polo_ativo) return { polo: 'ATIVO', advogado, parte: lido.polo_ativo };
    if (lido.polo_passivo) return { polo: 'PASSIVO', advogado, parte: lido.polo_passivo };
  }
  return null;
}
