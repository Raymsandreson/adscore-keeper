import { describe, it, expect } from 'vitest';
import {
  escolherDesfecho,
  ehInequivoco,
  interpretarResposta,
  rotuloDoBeneficio,
  textoDoAviso,
  textoPedidoDeConsentimento,
  passaramOsDias,
  dentroDaJanela,
  primeiroNome,
} from '../referral-sucesso';

describe('escolherDesfecho', () => {
  it('sem sinal nenhum, não inventa desfecho', () => {
    expect(escolherDesfecho({ inssDeferidos: [], marcos: [] })).toBeNull();
  });

  it('pagamento ganha de acordo — dinheiro na mão não admite discussão', () => {
    const d = escolherDesfecho({
      inssDeferidos: [],
      marcos: [
        { id: 'a', tipo_movimentacao: 'acordo', data_movimentacao: '2026-09-10' },
        { id: 'p', tipo_movimentacao: 'pagamento', data_movimentacao: '2026-08-01' },
      ],
    });
    expect(d?.tipo).toBe('pagamento');
    expect(d?.ref).toBe('p');
  });

  it('marco que não é desfecho (perícia, audiência) é ignorado', () => {
    const d = escolherDesfecho({
      inssDeferidos: [],
      marcos: [
        { id: 'x', tipo_movimentacao: 'pericia', data_movimentacao: '2026-09-01' },
        { id: 'y', tipo_movimentacao: 'audiencia_conciliacao', data_movimentacao: '2026-09-02' },
      ],
    });
    expect(d).toBeNull();
  });

  it('BPC deferido vira rótulo que o cliente reconhece', () => {
    const d = escolherDesfecho({
      inssDeferidos: [{ id: 'r1', benefit_type: 'Benefício Assistencial ao Deficiente', servico: null, protocol_date: '2026-03-01' }],
      marcos: [],
    });
    expect(d?.tipo).toBe('inss_deferido');
    expect(d?.rotulo).toBe('o BPC/LOAS foi concedido');
  });

  it('sentença entra como candidato mas NÃO é inequívoca', () => {
    const d = escolherDesfecho({
      inssDeferidos: [],
      marcos: [{ id: 's', tipo_movimentacao: 'sentenca_1grau', data_movimentacao: '2026-09-09' }],
    });
    expect(d?.tipo).toBe('sentenca_revisar');
    expect(ehInequivoco(d!.tipo)).toBe(false);
  });

  it('desfecho inequívoco continua inequívoco', () => {
    expect(ehInequivoco('pagamento')).toBe(true);
    expect(ehInequivoco('inss_deferido')).toBe(true);
    expect(ehInequivoco('acordo')).toBe(true);
  });
});

describe('rotuloDoBeneficio', () => {
  it('não inventa benefício quando o banco não diz qual é', () => {
    expect(rotuloDoBeneficio(null, null)).toBe('o benefício');
    expect(rotuloDoBeneficio('Aposentadoria Especial', null)).toBe('a aposentadoria');
  });

  it('LOAS, BPC e "assistencial" caem no mesmo rótulo', () => {
    expect(rotuloDoBeneficio('LOAS Deficiente', null)).toBe('o BPC/LOAS');
    expect(rotuloDoBeneficio(null, 'BPC')).toBe('o BPC/LOAS');
  });
});

describe('interpretarResposta — a parte que não pode errar para o lado do sim', () => {
  it('aceites diretos', () => {
    for (const r of ['pode sim', 'Claro!', 'pode contar sim', 'autorizo', 'Com certeza 😊', 'beleza']) {
      expect(interpretarResposta(r)).toBe('sim');
    }
  });

  it('recusas diretas', () => {
    for (const r of ['prefiro que não', 'não quero não', 'melhor não', 'não autorizo', 'não precisa avisar ele']) {
      expect(interpretarResposta(r)).toBe('nao');
    }
  });

  it('"não tem problema" é SIM, não recusa — a armadilha clássica', () => {
    expect(interpretarResposta('não tem problema')).toBe('sim');
    expect(interpretarResposta('por mim não tem problema nenhum')).toBe('sim');
    expect(interpretarResposta('sem problema, pode falar')).toBe('sim');
    expect(interpretarResposta('não vejo problema')).toBe('sim');
  });

  it('vazio, emoji solto e desvio de assunto não decidem nada', () => {
    expect(interpretarResposta('')).toBe('indefinido');
    expect(interpretarResposta(null)).toBe('indefinido');
    expect(interpretarResposta('👍')).toBe('indefinido');
    expect(interpretarResposta('quando cai o dinheiro?')).toBe('indefinido');
  });

  it('sinal contraditório não vira sim', () => {
    expect(interpretarResposta('sim, mas não fala o valor não')).toBe('indefinido');
  });
});

describe('trava de 30 dias', () => {
  const agora = new Date('2026-09-15T12:00:00Z');

  it('quem nunca foi avisado pode ser avisado', () => {
    expect(passaramOsDias(null, agora)).toBe(true);
  });

  it('avisado ontem não recebe de novo', () => {
    expect(passaramOsDias('2026-09-14T12:00:00Z', agora)).toBe(false);
  });

  it('avisado há 31 dias pode receber', () => {
    expect(passaramOsDias('2026-08-15T11:00:00Z', agora)).toBe(true);
  });
});

describe('janela de envio', () => {
  it('meio-dia em Brasília envia', () => {
    expect(dentroDaJanela(new Date('2026-09-15T15:00:00Z'))).toBe(true);
  });

  it('3h da manhã em Brasília não envia', () => {
    expect(dentroDaJanela(new Date('2026-09-15T06:00:00Z'))).toBe(false);
  });
});

describe('textos', () => {
  it('o pedido de consentimento oferece o não antes de fechar', () => {
    const t = textoPedidoDeConsentimento({
      nomeDoIndicado: 'José da Silva',
      nomeDoIndicador: 'Maria Souza',
      rotuloDoDesfecho: 'o BPC/LOAS foi concedido',
    });
    expect(t).toContain('José');
    expect(t).toContain('Maria');
    expect(t).toMatch(/é só me dizer que não/i);
    expect(t).toMatch(/nada muda no seu caso/i);
  });

  it('sem o nome de quem indicou, não inventa um', () => {
    const t = textoPedidoDeConsentimento({
      nomeDoIndicado: 'José',
      nomeDoIndicador: null,
      rotuloDoDesfecho: 'o pagamento saiu',
    });
    expect(t).toContain('uma pessoa conhecida sua');
    expect(t).not.toContain('null');
    expect(t).not.toContain('undefined');
  });

  it('o aviso diz que houve autorização e não promete nada', () => {
    const t = textoDoAviso({
      nomeDoIndicador: 'Maria',
      desfechos: [{ nomeDoIndicado: 'José da Silva', rotulo: 'o BPC/LOAS foi concedido' }],
    });
    expect(t).toContain('Maria');
    expect(t).toContain('José');
    expect(t).toMatch(/autorizou/i);
    expect(t).not.toMatch(/garanti|prometo|com certeza você também/i);
  });

  it('vários desfechos do mesmo indicador viram UMA mensagem em lista', () => {
    const t = textoDoAviso({
      nomeDoIndicador: 'Maria',
      desfechos: [
        { nomeDoIndicado: 'José', rotulo: 'o BPC/LOAS foi concedido' },
        { nomeDoIndicado: 'Ana', rotulo: 'o acordo foi fechado' },
      ],
    });
    expect(t).toContain('2 pessoas');
    expect(t).toContain('• José');
    expect(t).toContain('• Ana');
  });
});

describe('primeiroNome', () => {
  it('limpa lixo de cartão de contato', () => {
    expect(primeiroNome('  joão  da silva ')).toBe('João');
    expect(primeiroNome('11999998888')).toBe('');
    expect(primeiroNome(null)).toBe('');
  });
});
