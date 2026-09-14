/**
 * Agrupamento de páginas soltas em UM documento.
 *
 * O problema que isto resolve: `import-group-docs-to-lead` sobe UMA mídia do
 * WhatsApp por arquivo do Drive, e `analyze_file` classifica UM arquivo por vez.
 * Resultado: um laudo de 10 fotos vira 10 arquivos, cada um se declarando
 * `document_subtype: "único"` — porque nenhuma das duas etapas vê os vizinhos.
 *
 * Aqui mora a parte determinística da fase 2 (a IA entra só para decidir os
 * casos que a heurística deixa em aberto). Lógica pura, sem Deno e sem fetch,
 * para o vitest conseguir importar — mesmo padrão de `processUpdateClassifier`
 * e `escavadorCapa`.
 */

export type FormatoPdf = "pdf" | "jpg" | "png";

export interface AnaliseDoArquivo {
  document_type?: string | null;
  document_subtype?: string | null;
  holder_name?: string | null;
  holder_cpf?: string | null;
  description?: string | null;
  confidence?: string | null;
}

export interface ArquivoParaAgrupar {
  id: string;
  name: string;
  mimeType?: string | null;
  size?: string | number | null;
  modifiedTime?: string | null;
  /** Análise IA já gravada no `description` do arquivo do Drive. */
  analise?: AnaliseDoArquivo | null;
  /** Quando a mídia foi enviada no WhatsApp — é a ordem real das páginas. */
  enviadoEm?: string | null;
}

export type Confianca = "alta" | "média" | "baixa";

export interface GrupoDeDocumento {
  titulo: string;
  document_type: string | null;
  holder_name: string | null;
  /** Já na ordem final das páginas. */
  file_ids: string[];
  confianca: Confianca;
  motivo: string;
  origem: "ia" | "heuristica";
}

/**
 * Tipos que NUNCA são agrupados sozinhos, por mais confiante que a IA esteja.
 * "Foto" e "Outro" não são um documento de várias páginas — são o balaio do que
 * a IA não conseguiu identificar. Juntar cinco fotos distintas num PDF chamado
 * "Foto" destrói informação em vez de organizar.
 */
const TIPOS_QUE_NUNCA_AUTO_AGRUPAM = new Set([
  "foto",
  "fotos",
  "imagem",
  "outro",
  "outros",
  "documento",
  "",
]);

/** Janela entre páginas consecutivas para considerar "mesma sequência de envio". */
export const JANELA_SEQUENCIA_MS = 60 * 60 * 1000; // 1h

export function normalizarTexto(valor?: string | null): string {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Formato real do arquivo
// ---------------------------------------------------------------------------

/**
 * Descobre o formato pelos primeiros bytes. É o único critério confiável para
 * as mídias que chegam do WhatsApp sem nome nem mimetype e viram
 * `doc-XXXX.bin` + `application/octet-stream` — que o merge antigo descartava
 * como "mime não suportado", deixando a página de fora do PDF sem ninguém ver.
 */
export function formatoPorAssinatura(bytes: Uint8Array): FormatoPdf | null {
  if (!bytes || bytes.length < 4) return null;
  // %PDF
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "pdf";
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  return null;
}

function formatoPorMime(mime?: string | null): FormatoPdf | null {
  const m = String(mime ?? "").toLowerCase();
  if (m.includes("pdf")) return "pdf";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("png")) return "png";
  return null;
}

function formatoPorExtensao(name?: string | null): FormatoPdf | null {
  const n = String(name ?? "").toLowerCase();
  const dot = n.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = n.slice(dot + 1);
  if (ext === "pdf") return "pdf";
  if (ext === "jpg" || ext === "jpeg") return "jpg";
  if (ext === "png") return "png";
  return null;
}

/**
 * Formato utilizável para montar PDF. Os bytes mandam mais que o mimetype
 * declarado, porque o mimetype é o que alguém disse que o arquivo é e os bytes
 * são o que ele de fato é.
 */
export function formatoParaPdf(
  mime?: string | null,
  name?: string | null,
  bytes?: Uint8Array | null,
): FormatoPdf | null {
  if (bytes) {
    const porBytes = formatoPorAssinatura(bytes);
    if (porBytes) return porBytes;
  }
  return formatoPorMime(mime) ?? formatoPorExtensao(name);
}

/** O arquivo tem chance de entrar num PDF? (checagem sem baixar os bytes) */
export function podeVirarPagina(arquivo: ArquivoParaAgrupar): boolean {
  const mime = String(arquivo.mimeType ?? "").toLowerCase();
  if (mime.includes("folder")) return false;
  if (mime.startsWith("audio/") || mime.startsWith("video/")) return false;
  if (formatoPorMime(mime) || formatoPorExtensao(arquivo.name)) return true;
  // Mídia do WhatsApp sem mimetype: só os bytes dirão. Entra como candidata.
  return mime === "" || mime === "application/octet-stream";
}

// ---------------------------------------------------------------------------
// Identidade do documento
// ---------------------------------------------------------------------------

export function tipoNormalizado(arquivo: ArquivoParaAgrupar): string {
  const daAnalise = normalizarTexto(arquivo.analise?.document_type);
  if (daAnalise) return daAnalise;
  // Sem análise, o nome do Drive já segue "{Tipo} — {Titular} ({subtipo})".
  const antesDoTravessao = String(arquivo.name ?? "").split("—")[0];
  return normalizarTexto(antesDoTravessao.replace(/\.[^.]+$/, ""));
}

export function titularNormalizado(arquivo: ArquivoParaAgrupar): string {
  return normalizarTexto(arquivo.analise?.holder_name);
}

/**
 * "página 3 de 9" / "pág 3/9" / "fls. 2 de 10" no nome ou na descrição.
 * Quando existe, é o sinal mais forte de ordem que temos — vale mais que
 * horário de envio, porque quem fotografa fora de ordem ainda manda a página
 * certa.
 */
export function paginaDeclarada(
  arquivo: ArquivoParaAgrupar,
): { pagina: number; total: number | null } | null {
  const texto = `${arquivo.name ?? ""} ${arquivo.analise?.description ?? ""}`.toLowerCase();
  const comTotal = texto.match(/(?:p[áa]g(?:ina)?|fls?\.?|folha)\s*\.?\s*(\d{1,3})\s*(?:de|\/)\s*(\d{1,3})/);
  if (comTotal) {
    return { pagina: Number(comTotal[1]), total: Number(comTotal[2]) };
  }
  const soPagina = texto.match(/(?:p[áa]g(?:ina)?|fls?\.?|folha)\s*\.?\s*(\d{1,3})\b/);
  if (soPagina) return { pagina: Number(soPagina[1]), total: null };
  return null;
}

function instante(arquivo: ArquivoParaAgrupar): number | null {
  const bruto = arquivo.enviadoEm || arquivo.modifiedTime;
  if (!bruto) return null;
  const ms = new Date(bruto).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Ordem das páginas: página declarada > horário de envio > nome (ordem natural,
 * para "foto 2" não vir depois de "foto 10").
 */
export function ordenarPaginas(arquivos: ArquivoParaAgrupar[]): ArquivoParaAgrupar[] {
  return [...arquivos].sort((a, b) => {
    const pa = paginaDeclarada(a);
    const pb = paginaDeclarada(b);
    if (pa && pb && pa.pagina !== pb.pagina) return pa.pagina - pb.pagina;
    if (pa && !pb) return -1;
    if (!pa && pb) return 1;

    const ia = instante(a);
    const ib = instante(b);
    if (ia !== null && ib !== null && ia !== ib) return ia - ib;
    if (ia !== null && ib === null) return -1;
    if (ia === null && ib !== null) return 1;

    return String(a.name ?? "").localeCompare(String(b.name ?? ""), "pt-BR", { numeric: true });
  });
}

/** Dois titulares diferentes (ambos preenchidos) no mesmo grupo. */
export function conflitoDeTitular(arquivos: ArquivoParaAgrupar[]): boolean {
  const titulares = new Set(arquivos.map(titularNormalizado).filter(Boolean));
  return titulares.size > 1;
}

/** Todas as páginas foram enviadas em sequência, sem buraco maior que a janela. */
export function sequenciaContinua(
  arquivos: ArquivoParaAgrupar[],
  janelaMs = JANELA_SEQUENCIA_MS,
): boolean {
  const instantes = ordenarPaginas(arquivos)
    .map(instante)
    .filter((n): n is number => n !== null);
  if (instantes.length < arquivos.length) return false;
  for (let i = 1; i < instantes.length; i++) {
    if (instantes[i] - instantes[i - 1] > janelaMs) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Candidatos e decisão
// ---------------------------------------------------------------------------

export interface Candidato {
  chave: string;
  document_type: string | null;
  holder_name: string | null;
  arquivos: ArquivoParaAgrupar[];
}

/**
 * Junta por (tipo de documento × titular) os arquivos que PODEM ser páginas do
 * mesmo documento. Não decide nada — só monta o que vale a pena mandar para a
 * IA olhar, para não pagar Gemini em cima de arquivo que está sozinho.
 */
export function candidatosDeAgrupamento(arquivos: ArquivoParaAgrupar[]): Candidato[] {
  const elegiveis = arquivos.filter(podeVirarPagina);
  const porChave = new Map<string, ArquivoParaAgrupar[]>();

  for (const arquivo of elegiveis) {
    const tipo = tipoNormalizado(arquivo);
    if (!tipo) continue;
    const chave = `${tipo}|${titularNormalizado(arquivo)}`;
    const lista = porChave.get(chave) ?? [];
    lista.push(arquivo);
    porChave.set(chave, lista);
  }

  // Titular vazio não conflita com titular preenchido: a IA costuma ler o nome
  // só na primeira página do laudo. Então as páginas sem titular são anexadas
  // ao grupo do mesmo tipo que TEM titular — desde que exista um só.
  for (const [chave, lista] of [...porChave.entries()]) {
    const [tipo, titular] = chave.split("|");
    if (titular !== "") continue;
    const comTitular = [...porChave.entries()].filter(
      ([outraChave]) => outraChave.startsWith(`${tipo}|`) && outraChave !== chave,
    );
    if (comTitular.length === 1) {
      comTitular[0][1].push(...lista);
      porChave.delete(chave);
    }
  }

  return [...porChave.entries()]
    .filter(([, lista]) => lista.length >= 2)
    .map(([chave, lista]) => {
      const ordenados = ordenarPaginas(lista);
      const comTitular = ordenados.find((a) => a.analise?.holder_name);
      const comTipo = ordenados.find((a) => a.analise?.document_type);
      return {
        chave,
        document_type: comTipo?.analise?.document_type ?? null,
        holder_name: comTitular?.analise?.holder_name ?? null,
        arquivos: ordenados,
      };
    });
}

export interface ClassificacaoDeGrupos {
  /** Agrupa sozinho: a IA tem certeza e os sinais objetivos batem. */
  aplicar: GrupoDeDocumento[];
  /** Fica na tela esperando o usuário confirmar. */
  confirmar: GrupoDeDocumento[];
  /** Por que cada grupo rebaixado não foi aplicado — vai para o log e para a tela. */
  motivosDeRebaixamento: Array<{ titulo: string; motivo: string }>;
}

/**
 * Porteiro do modo automático. A IA sugere; quem decide se junta sem perguntar
 * são estas regras — todas objetivas, nenhuma opinião:
 *   1. a IA precisa ter dito confiança "alta";
 *   2. dois arquivos ou mais;
 *   3. nenhum titular conflitante no grupo;
 *   4. tipo específico (nunca "Foto" / "Outro");
 *   5. as páginas vieram em sequência OU declaram "página X de Y".
 * Falhou uma? Não some da tela: vai para confirmação manual.
 */
export function classificarGrupos(
  grupos: GrupoDeDocumento[],
  arquivosPorId: Map<string, ArquivoParaAgrupar>,
): ClassificacaoDeGrupos {
  const aplicar: GrupoDeDocumento[] = [];
  const confirmar: GrupoDeDocumento[] = [];
  const motivosDeRebaixamento: Array<{ titulo: string; motivo: string }> = [];

  for (const grupo of grupos) {
    const arquivos = grupo.file_ids
      .map((id) => arquivosPorId.get(id))
      .filter((a): a is ArquivoParaAgrupar => !!a);

    const rebaixar = (motivo: string) => {
      confirmar.push({ ...grupo, confianca: grupo.confianca === "alta" ? "média" : grupo.confianca });
      motivosDeRebaixamento.push({ titulo: grupo.titulo, motivo });
    };

    if (arquivos.length < 2) {
      rebaixar("grupo com menos de 2 arquivos válidos");
      continue;
    }
    if (arquivos.length !== grupo.file_ids.length) {
      rebaixar("a IA citou arquivo que não está na pasta");
      continue;
    }
    if (grupo.confianca !== "alta") {
      confirmar.push(grupo);
      continue;
    }
    const tipo = normalizarTexto(grupo.document_type) || tipoNormalizado(arquivos[0]);
    if (TIPOS_QUE_NUNCA_AUTO_AGRUPAM.has(tipo)) {
      rebaixar(`tipo "${grupo.document_type ?? "sem tipo"}" não se agrupa sozinho`);
      continue;
    }
    if (conflitoDeTitular(arquivos)) {
      rebaixar("titulares diferentes no mesmo grupo");
      continue;
    }
    const todasDeclaramPagina = arquivos.every((a) => paginaDeclarada(a) !== null);
    if (!todasDeclaramPagina && !sequenciaContinua(arquivos)) {
      rebaixar("páginas não vieram em sequência e não declaram numeração");
      continue;
    }
    aplicar.push(grupo);
  }

  return { aplicar, confirmar, motivosDeRebaixamento };
}

/** Nome do PDF unificado quando a IA não propõe um título utilizável. */
export function nomeDoGrupo(
  document_type?: string | null,
  holder_name?: string | null,
  paginas?: number,
): string {
  const sanitize = (s: string) => s.replace(/[\\/:*?"<>|\r\n]/g, " ").replace(/\s+/g, " ").trim();
  const partes = [sanitize(String(document_type || "Documento"))];
  if (holder_name) partes.push(sanitize(String(holder_name)));
  const base = partes.join(" — ");
  const comPaginas = paginas && paginas > 1 ? `${base} (${paginas} páginas)` : base;
  return `${comPaginas.slice(0, 180)}.pdf`;
}
