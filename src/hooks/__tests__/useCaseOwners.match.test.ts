// Casos tirados dos dados reais do Externo: leads.acolhedor é texto livre
// ("Israel", "edilansantos163@gmail.com", "Dra. Luana Barros l") e precisa
// achar o perfil certo — ou nenhum, quando o nome é genérico/ambíguo.
import { describe, it, expect } from 'vitest';
import { matchPersonByName, CaseOwnerPerson } from '../useCaseOwners';

const people: CaseOwnerPerson[] = [
  { user_id: 'u-israel', full_name: 'Israel de Jesus Carvalho Filho', email: 'israelcarvalho079@gmail.com' },
  { user_id: 'u-edilan', full_name: 'Edilan da Silva Santos', email: 'edilansantos163@gmail.com' },
  { user_id: 'u-analyne', full_name: 'analyne.sousa71', email: 'analyne.sousa71@gmail.com' },
  { user_id: 'u-karolyne', full_name: 'Maria Karolyne de Aguiar Nunes', email: 'karolynenunes2003@gmail.com' },
  { user_id: 'u-luana', full_name: 'Luana Barros', email: 'luana.barroscs@gmail.com' },
  { user_id: 'u-clara1', full_name: 'Maria Clara Nunes Milanez Araújo', email: 'mariclaramilanex@gmail.com' },
  { user_id: 'u-clara2', full_name: 'Maria Clara Nunes Milanez Araújo', email: 'claramilanex@gmail.com' },
];

describe('matchPersonByName', () => {
  it('casa pelo primeiro nome quando ele é único na equipe', () => {
    expect(matchPersonByName('Israel', people)?.user_id).toBe('u-israel');
    expect(matchPersonByName('Karolyne', people)?.user_id).toBe('u-karolyne');
  });

  it('casa nome completo com diferença de acento e caixa', () => {
    expect(matchPersonByName('edilan da silva santos', people)?.user_id).toBe('u-edilan');
  });

  it('casa quando o campo guarda o e-mail no lugar do nome', () => {
    expect(matchPersonByName('edilansantos163@gmail.com', people)?.user_id).toBe('u-edilan');
  });

  it('casa perfil cadastrado com apelido de e-mail', () => {
    expect(matchPersonByName('Analyne Sousa de Oliveira', people)?.user_id).toBe('u-analyne');
  });

  it('ignora tratamento (Dr./Dra.) e sobras de digitação', () => {
    expect(matchPersonByName('Dra. Luana Barros l', people)?.user_id).toBe('u-luana');
  });

  it('não chuta em nome genérico', () => {
    expect(matchPersonByName('Atendimento Previdenciário', people)).toBeNull();
    expect(matchPersonByName('Dom', people)).toBeNull();
    expect(matchPersonByName('', people)).toBeNull();
    expect(matchPersonByName(null, people)).toBeNull();
  });

  it('não escolhe ninguém quando dois perfis casam igual', () => {
    expect(matchPersonByName('Maria Clara Nunes Milanez Araújo', people)).toBeNull();
  });
});
