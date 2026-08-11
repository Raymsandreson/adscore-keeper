import { describe, it, expect } from 'vitest';
import { areaFromLocation } from '@/lib/systemAreas';

/**
 * O mapa de áreas alimenta a contabilidade do "uso do sistema": rota mal
 * classificada joga o tempo do membro na área errada — e ninguém percebe,
 * porque nada quebra. Estes casos travam as regras que dependem de ORDEM de
 * prefixo (as que se parecem entre si) e as abas do /dashboard.
 */
describe('areaFromLocation', () => {
  it('classifica as telas principais pelo menu', () => {
    expect(areaFromLocation('/whatsapp').key).toBe('whatsapp');
    expect(areaFromLocation('/whatsapp-api/conversas').key).toBe('whatsapp');
    expect(areaFromLocation('/contacts').key).toBe('contatos');
    expect(areaFromLocation('/finance').key).toBe('financeiro');
    expect(areaFromLocation('/cost-organization').key).toBe('financeiro');
    expect(areaFromLocation('/campanhas').key).toBe('marketing');
  });

  it('não confunde rotas de prefixo parecido', () => {
    expect(areaFromLocation('/leads').key).toBe('leads');
    expect(areaFromLocation('/leaderboard').key).toBe('vendas');
    expect(areaFromLocation('/processes').key).toBe('processual');
    expect(areaFromLocation('/process-tracking').key).toBe('processual');
    expect(areaFromLocation('/processual/bpc-autista').key).toBe('processual');
    expect(areaFromLocation('/workflow-progress').key).toBe('pop');
  });

  it('separa Marketing de Visão Geral pelas abas do dashboard', () => {
    expect(areaFromLocation('/dashboard').key).toBe('visao-geral');
    expect(areaFromLocation('/dashboard', '?tab=organic').key).toBe('marketing');
    expect(areaFromLocation('/dashboard', '?tab=automation&subtab=manychat').key).toBe('marketing');
    expect(areaFromLocation('/dashboard', '?tab=goals').key).toBe('visao-geral');
  });

  it('trata a raiz (Atividades) e barra final', () => {
    expect(areaFromLocation('/').key).toBe('atividades');
    expect(areaFromLocation('/cases/').key).toBe('processual');
    expect(areaFromLocation('/cases/abc-123').key).toBe('processual');
  });

  it('rota desconhecida cai em "outros" (o tempo nunca some)', () => {
    expect(areaFromLocation('/rota-que-nao-existe').key).toBe('outros');
    expect(areaFromLocation('/rota-que-nao-existe').label).toBe('Outras telas');
  });
});
