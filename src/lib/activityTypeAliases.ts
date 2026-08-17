// =============================================================================
// Tipos de atividade: reconciliação das duas famílias de chave.
//
// `activity_type` tem DOIS namespaces vivos ao mesmo tempo:
//  - as chaves seed hardcoded no código (`tarefa`, `audiencia`, `prazo`,
//    `acompanhamento`, `reuniao`, `diligencia`), que nunca ganharam linha na
//    tabela `activity_types`;
//  - as chaves `custom_*`, que são as linhas da tabela.
//
// O problema é que os SEIS seeds têm um gêmeo na tabela com o MESMO rótulo, e o
// dado ficou partido entre os dois (medido no Externo em 17/08/2026):
//
//     Tarefa           seed 17.282  |  custom 1.673
//     Acompanhamento   seed  1.828  |  custom   814
//     Prazo            seed    548  |  custom   390
//     Audiência        seed    117  |  custom    89
//     Reunião          seed     10  |  custom    42
//     Diligência       seed     10  |  custom     0
//
// Três estragos que isso causa na tela de Atividades:
//  1. O filtro de tipo lista "Prazo" DUAS vezes e cada opção traz só metade —
//     e `filterType` vai direto para o fetch, então a outra metade nem chega.
//  2. Dois itens de cmdk com o mesmo `value` compartilham seleção: passar o
//     mouse acende os dois e o Enter pega sempre o primeiro.
//  3. Na visão de Blocos, o rótulo é resolvido só pela tabela — o bloco das
//     17.282 atividades de chave seed aparece como "tarefa", em cinza, ao lado
//     de um bloco "Tarefa" colorido do gêmeo custom.
//
// Aqui a reconciliação é por CÓDIGO: as duas chaves passam a ser tratadas como
// um tipo só, agrupadas pelo rótulo normalizado. Nenhuma linha do banco é
// reescrita — juntar de verdade seria um UPDATE em ~19.800 atividades de
// produção, que precisa de decisão e rollback próprios.
// =============================================================================

export interface TipoDeAtividade {
  value: string;
  label: string;
}

/** Rótulo sem acento, sem caixa e sem espaço duplo — a chave do agrupamento. */
export function rotuloNormalizado(label?: string | null): string {
  return (label || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Rótulo normalizado → todas as chaves que o usam.
 *
 * Tipo sem rótulo (ou com rótulo igual à própria chave, que é o fallback de
 * quem apareceu só nas atividades) fica no seu próprio grupo — não dá para
 * afirmar que duas chaves cruas são a mesma coisa.
 */
export function agruparTiposPorRotulo(tipos: TipoDeAtividade[]): Map<string, string[]> {
  const grupos = new Map<string, string[]>();
  for (const t of tipos) {
    if (!t?.value) continue;
    const chaveGrupo = rotuloNormalizado(t.label) || rotuloNormalizado(t.value);
    const lista = grupos.get(chaveGrupo) || [];
    if (!lista.includes(t.value)) lista.push(t.value);
    grupos.set(chaveGrupo, lista);
  }
  return grupos;
}

/**
 * Uma entrada por rótulo, guardando as chaves irmãs em `aliases`.
 *
 * Mantém a PRIMEIRA ocorrência: quem monta a lista põe os seeds do código na
 * frente, e são eles que carregam a cor boa (`bg-blue-500` e companhia) — o
 * gêmeo da tabela costuma vir com a cor padrão cinza.
 */
export function deduparTiposPorRotulo<T extends TipoDeAtividade>(tipos: T[]): (T & { aliases: string[] })[] {
  const grupos = agruparTiposPorRotulo(tipos);
  const vistos = new Set<string>();
  const saida: (T & { aliases: string[] })[] = [];
  for (const t of tipos) {
    if (!t?.value) continue;
    const chaveGrupo = rotuloNormalizado(t.label) || rotuloNormalizado(t.value);
    if (vistos.has(chaveGrupo)) continue;
    vistos.add(chaveGrupo);
    saida.push({ ...t, aliases: grupos.get(chaveGrupo) || [t.value] });
  }
  return saida;
}

/**
 * Expande as chaves escolhidas no filtro para todas as irmãs de mesmo rótulo.
 *
 * É o que faz "Prazo" trazer as 938 atividades em vez de 548 ou 390. Roda
 * também sobre valor antigo salvo no localStorage: a chave persistida pode ser
 * qualquer uma das duas, e as duas expandem para o mesmo conjunto.
 */
export function expandirChavesDeTipo(selecionadas: string[], tipos: TipoDeAtividade[]): string[] {
  if (selecionadas.length === 0) return [];
  const grupos = agruparTiposPorRotulo(tipos);
  const porChave = new Map<string, string[]>();
  for (const irmas of grupos.values()) {
    for (const chave of irmas) porChave.set(chave, irmas);
  }
  const saida = new Set<string>();
  for (const chave of selecionadas) {
    const irmas = porChave.get(chave);
    if (irmas) irmas.forEach(k => saida.add(k));
    else saida.add(chave); // chave que não está no catálogo: usa ela mesma
  }
  return [...saida];
}

/**
 * Chave → chave canônica do grupo dela, pronto para consulta O(1).
 *
 * Existe por causa de escala: `getEffectiveType` roda uma vez por atividade
 * dentro da visão de Blocos, e resolver o grupo do zero a cada chamada custaria
 * uma varredura do catálogo (110 entradas) por atividade — com alguns milhares
 * de atividades na tela isso vira milhões de comparações a cada render. Quem
 * chama monta este mapa uma vez, em `useMemo`.
 */
export function mapaCanonicoDeTipos(tipos: TipoDeAtividade[]): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const irmas of agruparTiposPorRotulo(tipos).values()) {
    const canonica = irmas[0];
    for (const chave of irmas) mapa.set(chave, canonica);
  }
  return mapa;
}

/**
 * Chave que representa o grupo de uma atividade — usada para agrupar em blocos.
 *
 * Devolve a primeira chave do grupo (a mesma que `deduparTiposPorRotulo` manteve
 * na lista), para o bloco casar com a entrada visível do catálogo. Chave fora do
 * catálogo devolve ela mesma, para o bloco não sumir.
 *
 * Em laço quente, prefira `mapaCanonicoDeTipos` — esta aqui remonta os grupos a
 * cada chamada.
 */
export function chaveCanonicaDoTipo(key: string | null | undefined, tipos: TipoDeAtividade[]): string {
  if (!key) return '';
  return mapaCanonicoDeTipos(tipos).get(key) ?? key;
}
