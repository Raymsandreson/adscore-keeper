import { describe, it, expect } from 'vitest';
import { semSegredo } from '../semSegredo';

// Token falso, no formato que a Meta usa. Nunca por credencial real em teste.
const TOKEN = 'EAAbUBvUtHmABSVpZAfFkUd2kW1pMd2mKjcRXdtZAF6KV3MlLvgZB20lKz8b';

describe('semSegredo', () => {
  it('tira o token da URL de paginacao que a Meta devolve, preservando o resto', () => {
    // Forma exata do defeito de 14/09/2026: a Meta embute o proprio token no
    // `paging.next`, e o modo `dono_do_dataset` devolvia isso ao chamador.
    const daMeta = {
      data: [{ value: 'Purchase', count: 49 }],
      paging: {
        next: `https://graph.facebook.com/v25.0/288371/stats?aggregation=event&access_token=${TOKEN}&limit=25&after=MTc4OQ`,
        previous: `https://graph.facebook.com/v25.0/288371/stats?access_token=${TOKEN}&before=MTc4OA`,
      },
    };

    const limpo = semSegredo(daMeta);

    expect(limpo.paging.next).not.toContain(TOKEN);
    expect(limpo.paging.previous).not.toContain(TOKEN);
    // O resto da URL fica: saber QUAL borda foi chamada e com que cursor e o que
    // torna o diagnostico util.
    expect(limpo.paging.next).toContain('aggregation=event');
    expect(limpo.paging.next).toContain('limit=25');
    expect(limpo.paging.next).toContain('after=MTc4OQ');
    expect(limpo.data).toEqual([{ value: 'Purchase', count: 49 }]);
  });

  it('apaga o campo access_token em qualquer profundidade', () => {
    const r = semSegredo({ a: { b: [{ access_token: TOKEN, id: '1' }] } });
    expect(r.a.b[0].access_token).toBe('<omitido>');
    expect(r.a.b[0].id).toBe('1');
  });

  it('preserva booleano derivado: "existe token" e informacao, nao segredo', () => {
    // `modo: 'paginas'` devolve `tem_token_de_pagina: true` de proposito.
    const r = semSegredo({ tem_token_de_pagina: true, access_token: TOKEN });
    expect(r.tem_token_de_pagina).toBe(true);
    expect(r.access_token).toBe('<omitido>');
  });

  it('pega token solto no meio de mensagem de erro', () => {
    // A Meta as vezes ecoa a URL inteira dentro da mensagem de erro.
    const r = semSegredo({ erro: `Invalid OAuth token ${TOKEN} for app` });
    expect(r.erro).not.toContain(TOKEN);
    expect(r.erro).toContain('Invalid OAuth token');
  });

  it('cobre client_secret e app_secret, nao so o token da Meta', () => {
    const r = semSegredo({ url: 'https://x/y?client_secret=abc123&z=1', app_secret: 'deadbeef' });
    expect(r.url).toBe('https://x/y?client_secret=<omitido>&z=1');
    expect(r.app_secret).toBe('<omitido>');
  });

  it('nao altera o original: o chamador segue usando o token de pagina que leu', () => {
    // `me/accounts` devolve um token por pagina, e ele e necessario para ler
    // `leadgen_forms`. Sanitizar na saida nao pode quebrar o uso interno.
    const original = { data: [{ id: '1', access_token: TOKEN }] };
    semSegredo(original);
    expect(original.data[0].access_token).toBe(TOKEN);
  });

  it('nao explode com estrutura absurdamente aninhada', () => {
    let no: any = { fim: TOKEN };
    for (let i = 0; i < 40; i += 1) no = { dentro: no };
    expect(() => semSegredo(no)).not.toThrow();
  });

  it('deixa passar o que nao e segredo', () => {
    const r = semSegredo({ n: 1, b: false, nulo: null, s: 'Purchase', lista: [1, 2] });
    expect(r).toEqual({ n: 1, b: false, nulo: null, s: 'Purchase', lista: [1, 2] });
  });
});
