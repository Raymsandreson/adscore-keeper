/**
 * Invariante: tela que fecha lead avisa a Meta.
 *
 * Fechar um lead é a conversão que paga a campanha — é o `Purchase` que ensina
 * a Meta a procurar mais gente parecida com quem virou cliente. O problema é
 * que "fechar" existe em várias telas, e cada uma grava `lead_status: 'closed'`
 * do seu jeito.
 *
 * Medido em 04/09/2026: 84 fechamentos no CRM desde que a fila passou a
 * existir, 3 eventos enviados. Três dos quatro caminhos de fechamento
 * simplesmente não lembravam de enfileirar, e um deles observava
 * `status === 'converted'` — etapa de funil que não existe em board nenhum (0
 * leads), então o `if` nunca rodou nem quando alguém fechava pela ficha.
 *
 * Este teste não sabe verificar semântica; ele cobra uma decisão. Arquivo que
 * fecha lead ou chama `registrarFechamentoDeLead`, ou explica por que não com
 * um comentário `capi:sem-conversao`. O que não pode é passar batido de novo.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(process.cwd(), 'src');
const FECHA_LEAD = /lead_status:\s*['"]closed['"]/;
const AVISA = 'registrarFechamentoDeLead';
const DISPENSA = 'capi:sem-conversao';

function arquivosDeCodigo(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) {
      return nome === 'node_modules' || nome === '__tests__' ? [] : arquivosDeCodigo(caminho);
    }
    return /\.tsx?$/.test(caminho) && !caminho.endsWith('.test.ts') ? [caminho] : [];
  });
}

describe('fechar lead enfileira a conversão', () => {
  it('todo arquivo que grava lead_status closed avisa a Meta ou declara por que não', () => {
    const faltando = arquivosDeCodigo(SRC)
      .filter((caminho) => {
        // `types.ts` é gerado e só descreve a coluna; não fecha nada.
        if (caminho.endsWith('integrations/supabase/types.ts')) return false;
        const fonte = readFileSync(caminho, 'utf-8');
        if (!FECHA_LEAD.test(fonte)) return false;
        return !fonte.includes(AVISA) && !fonte.includes(DISPENSA);
      })
      .map((caminho) => relative(process.cwd(), caminho));

    expect(faltando).toEqual([]);
  });

  it('encontra os arquivos que fecham lead — se este número zerar, a regex apodreceu', () => {
    const fecham = arquivosDeCodigo(SRC).filter((caminho) => {
      if (caminho.endsWith('integrations/supabase/types.ts')) return false;
      return FECHA_LEAD.test(readFileSync(caminho, 'utf-8'));
    });
    expect(fecham.length).toBeGreaterThanOrEqual(4);
  });
});
