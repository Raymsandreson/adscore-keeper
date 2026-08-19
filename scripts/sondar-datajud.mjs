#!/usr/bin/env node
// =============================================================================
// Sondagem do DataJud (CNJ) — descobre o SCHEMA REAL antes de codar contra ele.
//
// Por que existe: a sessão que desenhou a prospecção de acidente de trabalho
// (19/08/2026) não conseguiu medir o DataJud — api-publica.datajud.cnj.jus.br
// responde 403 no CONNECT do proxy de egress do ambiente remoto, e a wiki do
// CNJ também está bloqueada. Sem medir, qualquer integração é chute.
// Ver docs/sistema/prospeccao-acidente-trabalho.md, seção 3.
//
// O que este script responde, de forma objetiva:
//   1. A API responde? Com qual chave?
//   2. Quais chaves existem no `_source` de um processo?
//   3. Existe `valorCausa`? Existe `assuntos[]` com codigo/nome?
//   4. Vêm nomes de PARTES e ADVOGADOS, ou o CNJ removeu por LGPD?
//   5. Um filtro por assunto + range de valor devolve resultado?
//
// USO:
//   DATAJUD_API_KEY='<chave>' node scripts/sondar-datajud.mjs
//   DATAJUD_API_KEY='<chave>' node scripts/sondar-datajud.mjs api_publica_trt15
//
// A chave pública é divulgada pelo próprio CNJ na página da API Pública
// (cnj.jus.br/sistemas/datajud/api-publica/). NÃO está hardcoded aqui de
// propósito: chave em repo é o tipo de coisa que o CLAUDE.md manda barrar.
// =============================================================================

const API_KEY = process.env.DATAJUD_API_KEY;
const TRIBUNAL = process.argv[2] || 'api_publica_trt2';
const BASE = 'https://api-publica.datajud.cnj.jus.br';

if (!API_KEY) {
  console.error('ERRO: defina DATAJUD_API_KEY no ambiente.');
  console.error("Uso: DATAJUD_API_KEY='<chave>' node scripts/sondar-datajud.mjs [indice]");
  process.exit(1);
}

const url = `${BASE}/${TRIBUNAL}/_search`;

async function consultar(descricao, query) {
  process.stdout.write(`\n--- ${descricao}\n`);
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `APIKey ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(query),
    });
  } catch (e) {
    console.error(`  FALHA de rede: ${e.message}`);
    return null;
  }

  if (!resp.ok) {
    const txt = await resp.text();
    console.error(`  HTTP ${resp.status}: ${txt.slice(0, 400)}`);
    return null;
  }

  const json = await resp.json();
  const total = json?.hits?.total?.value ?? json?.hits?.total ?? '?';
  console.log(`  OK — total de hits: ${total}`);
  return json;
}

/** Achata as chaves de um objeto até `profundidade`, para listar o schema. */
function chaves(obj, prefixo = '', profundidade = 2) {
  const out = [];
  if (obj == null || typeof obj !== 'object' || profundidade < 0) return out;
  for (const [k, v] of Object.entries(obj)) {
    const caminho = prefixo ? `${prefixo}.${k}` : k;
    const tipo = Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
    out.push(`${caminho} (${tipo})`);
    if (Array.isArray(v) && v.length && typeof v[0] === 'object') {
      out.push(...chaves(v[0], `${caminho}[]`, profundidade - 1));
    } else if (!Array.isArray(v) && typeof v === 'object' && v !== null) {
      out.push(...chaves(v, caminho, profundidade - 1));
    }
  }
  return out;
}

const main = async () => {
  console.log(`Índice: ${TRIBUNAL}`);
  console.log(`URL:    ${url}`);

  // 1) Um processo qualquer — para listar o schema do _source.
  const amostra = await consultar('1. Amostra (match_all, 1 doc)', {
    size: 1,
    query: { match_all: {} },
  });

  if (amostra) {
    const src = amostra?.hits?.hits?.[0]?._source;
    if (!src) {
      console.log('  Sem documentos neste índice.');
    } else {
      console.log('\n  CAMPOS DO _source:');
      for (const c of chaves(src)) console.log(`    ${c}`);

      console.log('\n  RESPOSTAS DIRETAS:');
      const temValor = 'valorCausa' in src;
      console.log(`    valorCausa presente? ${temValor}` +
        (temValor ? ` -> ${JSON.stringify(src.valorCausa)}` : ''));

      const temAssuntos = Array.isArray(src.assuntos);
      console.log(`    assuntos[] presente? ${temAssuntos}` +
        (temAssuntos ? ` -> ${JSON.stringify(src.assuntos.slice(0, 3))}` : ''));

      // A pergunta que decide se o Escavador continua necessário.
      const camposPessoa = Object.keys(src).filter((k) =>
        /parte|polo|advogad|pessoa|nome/i.test(k),
      );
      console.log(`    campos de parte/advogado: ${
        camposPessoa.length ? camposPessoa.join(', ') : 'NENHUM'
      }`);
      if (!camposPessoa.length) {
        console.log('      => DataJud NÃO identifica advogado. Continua sendo');
        console.log('         necessário resolver as partes por CNJ no Escavador.');
      }

      console.log('\n  _source COMPLETO (1 doc):');
      console.log(JSON.stringify(src, null, 2).split('\n').map((l) => `    ${l}`).join('\n'));
    }
  }

  // 2) O recorte que a prospecção precisa: assunto + valor da causa.
  //    Se isto voltar com hits, o DataJud resolve o filtro global de graça e
  //    o Escavador só é chamado nos CNJs que passaram.
  await consultar('2. Recorte alvo: acidente de trabalho E valorCausa > 500k', {
    size: 3,
    query: {
      bool: {
        must: [
          { match: { 'assuntos.nome': 'acidente de trabalho' } },
          { range: { valorCausa: { gt: 500000 } } },
        ],
      },
    },
  });

  // 3) Só o range, para separar "o filtro de assunto não casou" de
  //    "valorCausa não é pesquisável / não existe".
  await consultar('3. Só o range de valorCausa > 500k', {
    size: 1,
    query: { range: { valorCausa: { gt: 500000 } } },
  });

  console.log('\nPróximo passo: colar esta saída em');
  console.log('docs/sistema/prospeccao-acidente-trabalho.md, seção 3,');
  console.log('trocando "hipótese NÃO verificada" pelo que foi medido.\n');
};

main().catch((e) => {
  console.error('Erro não tratado:', e);
  process.exit(1);
});
