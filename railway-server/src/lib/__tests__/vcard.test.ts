import { describe, it, expect } from 'vitest';
import { lerVcard, contatosCompartilhados } from '../vcard';

// Os dois primeiros payloads são cópia literal de linhas reais de
// whatsapp_messages (Externo, 10/09/2026) — metadata->message. Se o parser
// quebrar neles, quebra em produção.
const CARTAO_PESSOAL =
  'BEGIN:VCARD\nVERSION:3.0\nN:Abraci;🟦Luana;;;\nFN:🟦Luana Abraci\n' +
  'item1.TEL;waid=558699275467:+55 86 9927-5467\nitem1.X-ABLabel:Celular\nEND:VCARD';

const CARTAO_EMPRESA =
  'BEGIN:VCARD\nVERSION:3.0\nN:Neurociencias;Instituto;de;;\nFN:Instituto de Neurociencias\n' +
  'ORG:Instituto de Neurociencias\nTITLE:\nitem1.TEL;waid=558688580126:+55 86 8858-0126\n' +
  'item1.X-ABLabel:Celular\nX-WA-BIZ-NAME:Instituto de Neurociencias\nEND:VCARD';

describe('leitura do cartão de contato', () => {
  it('tira o telefone do waid, não do número formatado', () => {
    const contato = lerVcard(CARTAO_PESSOAL);
    expect(contato?.telefone).toBe('558699275467');
    expect(contato?.nome).toBe('🟦Luana Abraci');
  });

  it('reconhece cartão de empresa e guarda a razão social', () => {
    const contato = lerVcard(CARTAO_EMPRESA);
    expect(contato?.telefone).toBe('558688580126');
    expect(contato?.empresa).toBe('Instituto de Neurociencias');
  });

  it('cai no número formatado quando o cartão não tem waid', () => {
    const semWaid =
      'BEGIN:VCARD\nVERSION:3.0\nFN:João da Silva\nTEL;type=CELL;type=VOICE:+55 11 98888-7777\nEND:VCARD';
    expect(lerVcard(semWaid)?.telefone).toBe('5511988887777');
  });

  it('descarta cartão sem telefone — não dá para falar com quem não tem número', () => {
    const soNome = 'BEGIN:VCARD\nVERSION:3.0\nFN:Fulano Sem Número\nEND:VCARD';
    expect(lerVcard(soNome)).toBeNull();
  });

  it('guarda os telefones extras do mesmo cartão em vez de perdê-los', () => {
    const doisNumeros =
      'BEGIN:VCARD\nVERSION:3.0\nFN:Maria\nitem1.TEL;waid=5511911111111:+55 11 91111-1111\n' +
      'item2.TEL;waid=5511922222222:+55 11 92222-2222\nEND:VCARD';
    const contato = lerVcard(doisNumeros);
    expect(contato?.telefone).toBe('5511911111111');
    expect(contato?.telefonesExtras).toEqual(['5511922222222']);
  });

  it('junta linha continuada (nome longo quebrado em duas linhas)', () => {
    // RFC 6350 §3.2: ao desdobrar, some a quebra E o espaço de continuação.
    // Por isso o emissor quebra DEPOIS do espaço ("dos ") — se juntássemos com
    // um espaço a mais, nome com hífen ou quebra no meio da palavra sairia
    // rasgado ("Neuro ciências").
    const dobrado =
      'BEGIN:VCARD\nVERSION:3.0\nFN:Associação de Pais e Amigos dos \n Excepcionais\n' +
      'item1.TEL;waid=556599999999:+55 65 9999-9999\nEND:VCARD';
    expect(lerVcard(dobrado)?.nome).toBe('Associação de Pais e Amigos dos Excepcionais');
  });

  it('não deixa o ponto-e-vírgula do ORG vazar para a tela', () => {
    // Caso real da amostra de produção: a empresa saía como "JUNIOR;" porque
    // ORG é campo estruturado (Empresa;Departamento;Unidade).
    const comOrgEstruturado =
      'BEGIN:VCARD\nVERSION:3.0\nFN:Antonio marques- Junior Banco\nORG:JUNIOR;\n' +
      'item1.TEL;waid=558699027741:+55 86 9902-7741\nEND:VCARD';
    expect(lerVcard(comOrgEstruturado)?.empresa).toBe('JUNIOR');

    const comDepartamento =
      'BEGIN:VCARD\nVERSION:3.0\nFN:Ana\nORG:Clínica Vida;Fisioterapia\n' +
      'item1.TEL;waid=556599998888:+55 65 9999-8888\nEND:VCARD';
    expect(lerVcard(comDepartamento)?.empresa).toBe('Clínica Vida, Fisioterapia');
  });

  it('desfaz o escape do vCard em vez de mostrar a contrabarra', () => {
    const escapado =
      'BEGIN:VCARD\nVERSION:3.0\nFN:Silva\\, Maria\nitem1.TEL;waid=551188887777:+55 11 8888-7777\nEND:VCARD';
    expect(lerVcard(escapado)?.nome).toBe('Silva, Maria');
  });

  it('usa o displayName da mensagem quando o cartão não tem FN', () => {
    const semFn = 'BEGIN:VCARD\nVERSION:3.0\nitem1.TEL;waid=556588887777:+55 65 8888-7777\nEND:VCARD';
    expect(lerVcard(semFn, 'Dra. Marina')?.nome).toBe('Dra. Marina');
  });
});

describe('contatos compartilhados na mensagem', () => {
  it('lê o ContactMessage real que chegou do WhatsApp', () => {
    const contatos = contatosCompartilhados({
      messageType: 'ContactMessage',
      mediaType: 'vcard',
      content: { vcard: CARTAO_PESSOAL, displayName: '🟦Luana Abraci' },
    });
    expect(contatos).toHaveLength(1);
    expect(contatos[0].telefone).toBe('558699275467');
  });

  it('lê vários cartões de um ContactsArrayMessage', () => {
    const contatos = contatosCompartilhados({
      messageType: 'ContactsArrayMessage',
      mediaType: 'vcard',
      content: { contacts: [{ vcard: CARTAO_PESSOAL }, { vcard: CARTAO_EMPRESA }] },
    });
    expect(contatos.map(c => c.telefone)).toEqual(['558699275467', '558688580126']);
  });

  it('não repete o mesmo telefone mandado duas vezes na mesma mensagem', () => {
    const contatos = contatosCompartilhados({
      messageType: 'ContactsArrayMessage',
      content: { vcard: CARTAO_PESSOAL, contacts: [{ vcard: CARTAO_PESSOAL }] },
    });
    expect(contatos).toHaveLength(1);
  });

  it('ignora mensagem que não é cartão — quem chama não precisa filtrar', () => {
    expect(contatosCompartilhados({ messageType: 'Conversation', text: 'oi' })).toEqual([]);
    expect(contatosCompartilhados({ messageType: 'AudioMessage', mediaType: 'audio' })).toEqual([]);
    expect(contatosCompartilhados(null)).toEqual([]);
  });
});
