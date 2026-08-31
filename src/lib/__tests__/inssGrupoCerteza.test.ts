import { describe, it, expect } from 'vitest';
// Módulo do railway-server, puro — o vitest da raiz é o único runner.
import {
  codigoDoCaso,
  conferirGrupoDoLead,
} from '../../../railway-server/src/lib/inss-grupo-certeza';

describe('codigoDoCaso', () => {
  it('lê o código como está escrito nos nomes reais', () => {
    expect(codigoDoCaso('✅Prev 584 Josileide/ Anúncio Edilan - AUX. MATERNIDADE')).toBe('PREV 584');
    expect(codigoDoCaso('✅PREV 1050  | MARILENE DOS SANTOS/ANUNCIO')).toBe('PREV 1050');
    expect(codigoDoCaso('✅ FAMÍLIA 331 - JOÃO VICTOR - PIRIPIRI PI')).toBe('FAMILIA 331');
    expect(codigoDoCaso('LEAD 269| LUIZ FELIPE ARAÚJO FARIAS X AMBEV |')).toBe('LEAD 269');
    expect(codigoDoCaso('CASO-0474 - Fulano')).toBe('CASO 474');
  });

  it('não inventa código onde não há', () => {
    expect(codigoDoCaso('Raymar Anabel de Jesús Ruiz Cedeno')).toBeNull();
    expect(codigoDoCaso('')).toBeNull();
    expect(codigoDoCaso(null)).toBeNull();
  });

  it('número de processo não é número de caso', () => {
    expect(codigoDoCaso('CASO 0001723-93.2025.5.17.0191')).toBeNull();
    expect(codigoDoCaso('PREV 13621.214680/2024-67')).toBeNull();
  });
});

describe('conferirGrupoDoLead', () => {
  it('aprova quando o código do caso confere (o PREV 584 que abriu o caso)', () => {
    const r = conferirGrupoDoLead({
      leadName: '✅Prev 584 Josileide/ Anúncio Edilan - AUX. MATERNIDADE',
      groupName: '✅Prev 584 Josileide/ Anúncio Edilan - AUX. MATERNIDADE',
      nomeSegurado: 'JOSILEIDE SILVA DE SOUSA',
    });
    expect(r.ok).toBe(true);
  });

  it('reprova código divergente — o erro de julho, lead PREV 1092 no grupo PREV 1174', () => {
    const r = conferirGrupoDoLead({
      leadName: 'PREV 1092 /MONICA',
      groupName: 'PREV 1174 ANA CRISTINA',
      nomeSegurado: 'MONICA SILVA SOUZA',
    });
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain('PREV 1174');
  });

  it('código igual vence grafia do segurado ("CRISTIANE" x "CRISTIANNE")', () => {
    const r = conferirGrupoDoLead({
      leadName: 'CASO 146 SÓ CRISTIANE',
      groupName: 'CASO 146 SÓ CRISTIANE',
      nomeSegurado: 'CRISTIANNE PEREIRA LIMA',
    });
    expect(r.ok).toBe(true);
  });

  it('reprova quando o segurado do INSS não aparece em lugar nenhum', () => {
    const r = conferirGrupoDoLead({
      leadName: 'Maiara Patrícia Alves Ferreira',
      groupName: 'Grupo do Eduardo Santos',
      nomeSegurado: 'PATRICIA SOUZA FERREIRA',
    });
    expect(r.ok).toBe(false);
  });

  it('aprova pelo nome do segurado quando não há código nenhum', () => {
    const r = conferirGrupoDoLead({
      leadName: 'Giedry rosa Alves de Brito',
      groupName: 'Giedry rosa Alves de Brito',
      nomeSegurado: 'GIEDRY ROSA ALVES DE BRITO',
    });
    expect(r.ok).toBe(true);
  });

  it('acolhedor em comum não vale como prova', () => {
    const r = conferirGrupoDoLead({
      leadName: 'Maria Aparecida / Anúncio Edilan',
      groupName: 'João Batista / Anúncio Edilan',
      nomeSegurado: null,
    });
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain('EDILAN');
  });

  it('recusa grupo sem nome: não se confere o que não se lê', () => {
    expect(conferirGrupoDoLead({ leadName: 'Fulano de Tal', groupName: null }).ok).toBe(false);
  });

  it('recusa quando nada liga os dois', () => {
    const r = conferirGrupoDoLead({
      leadName: 'Eduardo Santos Costa',
      groupName: 'Financeiro do escritório',
      nomeSegurado: null,
    });
    expect(r.ok).toBe(false);
  });
});
