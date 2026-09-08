/**
 * Qual linha de `jm_documentos` é a peça que o painel de conferência mostrou.
 *
 * O painel "De onde saiu (para conferir)" lista as peças lidas que entraram no
 * prompt do Dom. Até 08/09/2026 elas eram texto morto: dava para ler o resumo
 * feito pela IA e não dava para ver o documento. Quem revisa tinha que confiar
 * no resumo — exatamente o que aquele painel existe para não pedir.
 *
 * Abrir a peça exige saber QUAL peça é, e é aí que mora a armadilha. O contexto
 * é um retrato gravado junto com o rascunho (`dom_rascunhos.contexto_usado`), e
 * até esta data ele guardava só título, data e resumo. Título + data NÃO
 * identificam um documento — medido no banco externo em 08/09/2026 sobre os
 * 9.151 documentos com leitura:
 *
 *     8.630 chaves (cnj, título, data) distintas
 *       251 chaves repetidas, cobrindo 772 documentos em 48 processos
 *        17 documentos com o MESMO título e a MESMA data, no pior caso
 *
 * Ou seja: casar por título+data abriria a peça errada em cerca de 6% dos
 * cliques, sem avisar ninguém. Peça errada anexada a um resumo é prova falsa —
 * pior que botão nenhum, porque parece conferência.
 *
 * Por isso a ordem aqui é: `arquivo` (o storage_path que a RPC passou a emitir)
 * → `id` → e só então o casamento por título+data, que abre APENAS quando há um
 * único candidato. Com dois ou mais, a resposta é dizer que não dá para saber
 * qual é, nunca sortear um.
 */

/** O que o painel tem em mãos sobre uma peça, vindo de `contexto_usado`. */
export interface DocumentoDoContexto {
  /** `jm_documentos.id`. Só existe em contexto gravado a partir de 08/09/2026. */
  id?: number | null;
  /** `jm_documentos.storage_path`. Idem — é o caminho direto, sem procurar. */
  arquivo?: string | null;
  /** O título da peça. `peca` é a chave que a RPC emite; `titulo` é reserva. */
  peca?: string | null;
  titulo?: string | null;
  data?: string | null;
}

/** Uma linha candidata de `jm_documentos`, já no formato do app. */
export interface CandidataDosAutos {
  id: number;
  titulo: string | null;
  dataDocumento: string | null;
  storagePath: string | null;
}

export type ResolucaoPeca =
  | { ok: true; storagePath: string; id: number | null }
  | { ok: false; motivo: string };

const tituloDe = (d: DocumentoDoContexto) => (d.peca ?? d.titulo ?? '').trim();
const soData = (v: string | null | undefined) => (v ? v.slice(0, 10) : null);

/**
 * O caminho do arquivo desta peça, ou o motivo de não dar para ter certeza.
 *
 * `candidatas` é o que a consulta a `jm_documentos` devolveu para o título
 * desta peça dentro deste processo. Quando o contexto já traz `arquivo`, nem
 * precisa consultar — e é para lá que estamos indo em todo rascunho novo.
 */
export function acharPecaDoContexto(
  doc: DocumentoDoContexto,
  candidatas: CandidataDosAutos[],
): ResolucaoPeca {
  // 1. O contexto já sabe o caminho. Nada a adivinhar.
  if (doc.arquivo) return { ok: true, storagePath: doc.arquivo, id: doc.id ?? null };

  const lista = candidatas ?? [];

  // 2. O contexto sabe o id — a peça é uma só, e a única dúvida é se ela ainda
  //    tem arquivo. Peça sem `storage_path` não foi baixada: não há o que abrir,
  //    e dizer isso é melhor que abrir um visualizador vazio.
  if (typeof doc.id === 'number') {
    const achada = lista.find(c => c.id === doc.id);
    if (!achada) return { ok: false, motivo: 'Esta peça não está mais no acervo dos autos.' };
    return achada.storagePath
      ? { ok: true, storagePath: achada.storagePath, id: achada.id }
      : { ok: false, motivo: 'Esta peça foi lida pela IA, mas o arquivo não foi baixado para o acervo.' };
  }

  // 3. Rascunho gravado antes de a RPC emitir id/arquivo. Casa por título e
  //    data — e só entrega quando o resultado é único.
  const titulo = tituloDe(doc);
  const data = soData(doc.data);
  const casadas = lista.filter(c =>
    (c.titulo ?? '').trim() === titulo && soData(c.dataDocumento) === data);
  const abriveis = casadas.filter(c => c.storagePath);

  if (abriveis.length === 1) {
    return { ok: true, storagePath: abriveis[0].storagePath!, id: abriveis[0].id };
  }
  if (abriveis.length > 1) {
    return {
      ok: false,
      motivo: `${abriveis.length} peças deste processo têm este mesmo título e esta mesma data. `
        + 'Abrir uma delas seria chutar qual você quer ver — abra a aba Documentos do processo. '
        + '(Rascunhos novos já guardam qual é a peça e abrem direto.)',
    };
  }
  if (casadas.length > 0) {
    return { ok: false, motivo: 'Esta peça foi lida pela IA, mas o arquivo não foi baixado para o acervo.' };
  }
  return { ok: false, motivo: 'Não achei esta peça no acervo dos autos deste processo.' };
}
