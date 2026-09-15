// Sonda de integração da Data Stone — custo ZERO em créditos.
//
// É o primeiro passo obrigatório da integração, e existe por um motivo prático:
// a Data Stone responde 401 tanto para chave errada quanto para IP fora da
// whitelist, e o Railway não tem IP de saída fixo. Só a mensagem do 401 de
// whitelist entrega qual IP o serviço usou — é esse número que vai no painel
// (Meu Perfil > Whitelist de IPs). Com o IP na whitelist a conta também fica
// isenta do rate limit de 100 requisições/dia, que é o que torna possível
// consultar a fila de leads sem levar bloqueio de 24h.
//
// `GET /apitest/` não consome crédito e ainda diz de quem é a chave (empresa e
// usuário), o que confirma que o token setado no Railway é o da conta certa.
// O saldo (`GET /balance`) vem junto por padrão: também não cobra, e evita um
// segundo deploy só para descobrir quantos créditos existem.
import type { RequestHandler } from 'express';
import { apiTest, saldo, temToken } from '../lib/datastone';

export const handler: RequestHandler = async (req, res) => {
  const body = (req.body || {}) as { saldo?: boolean };
  const querSaldo = body.saldo !== false;

  if (!temToken()) {
    return res.status(200).json({
      success: false,
      token_presente: false,
      proximo_passo:
        'DATASTONE_TOKEN não chegou a este serviço. Conferir a variável no serviço WhatsJUD do Railway e se o deploy é posterior a ela.',
    });
  }

  const teste = await apiTest();

  const apitest = {
    ok: teste.ok,
    status: teste.status,
    falha: teste.falha ?? null,
    motivo: teste.motivo ?? null,
    // De quem é a chave — confirma conta certa, não é dado pessoal de cliente.
    empresa: teste.ok ? (teste.dados as any)?.company?.name ?? null : null,
    usuario: teste.ok ? (teste.dados as any)?.user?.email ?? null : null,
    // O IP que a Data Stone viu. Só vem preenchido no 401 de whitelist.
    ip_de_saida: teste.ip ?? null,
    corpo: teste.ok ? null : teste.dados,
  };

  let proximo_passo: string;
  if (teste.ok) {
    proximo_passo = 'Chave válida e IP autorizado. Pode seguir para o saldo e para a fila de consultas.';
  } else if (teste.falha === 'chave_ou_ip') {
    proximo_passo = teste.ip
      ? `Cadastrar o IP ${teste.ip} em Meu Perfil > Whitelist de IPs no painel da Data Stone e repetir esta chamada.`
      : 'A Data Stone recusou a credencial e não informou IP — provável chave inválida ou mal formatada (o valor vai no header como "Token <chave>", sem "Bearer").';
  } else if (teste.falha === 'sem_acesso') {
    proximo_passo = 'Chave válida, mas a API não está liberada para a conta. Pedir a liberação ao administrador da conta na Data Stone.';
  } else if (teste.falha === 'rate_limit') {
    proximo_passo = 'Limite de requisições estourado — a conta fica bloqueada por 24h. Não repetir; o IP na whitelist é o que isenta desse teto.';
  } else {
    proximo_passo = 'Falha não prevista. Ver `apitest.corpo` antes de gastar qualquer crédito.';
  }

  console.log(
    JSON.stringify({
      event: 'datastone.apitest',
      status: teste.status,
      ok: teste.ok,
      falha: teste.falha ?? null,
      ip_de_saida: teste.ip ?? null,
    }),
  );

  // Saldo só faz sentido depois que a credencial passou.
  let saldoResp: unknown = null;
  if (teste.ok && querSaldo) {
    const s = await saldo();
    saldoResp = s.ok ? s.dados : { erro: s.falha, motivo: s.motivo, status: s.status };
  }

  return res.status(200).json({
    success: teste.ok,
    token_presente: true,
    apitest,
    saldo: saldoResp,
    proximo_passo,
  });
};
