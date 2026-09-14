import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import os from "os";

/**
 * Quantos testes rodam ao mesmo tempo.
 *
 * O vitest dimensiona os workers pelo numero de NUCLEOS, e aqui o recurso que
 * acaba primeiro e a MEMORIA. Medido em 14/09/2026 nesta maquina (16 nucleos,
 * 7 GB): a suite subia 19 processos e a memoria disponivel caia para 229 MB.
 * Nesse aperto o GC entra em thrashing, os testes de componente pesado passam
 * dos 5s de `testTimeout` e falham — um conjunto DIFERENTE a cada rodada
 * (ActivityFullSheet, BoardsList, EntityFinancialsPanel, FeedbackFunnel...),
 * sempre verdes quando rodados isolados.
 *
 * Isso e pior que um teste que sempre falha: vermelho aleatorio ensina a
 * equipe a ignorar a suite, e esconde a regressao de verdade no meio do ruido.
 *
 * Medicao que sustenta o numero, 3 rodadas completas de cada:
 *
 *   16 (default)  ->  1 de 3 vermelhas (7 testes), 36-49s
 *    6            ->  3 de 3 verdes,               57-70s
 *    4            ->  3 de 3 verdes,               66-73s
 *
 * ~20s a mais por rodada em troca de resultado em que se pode confiar.
 *
 * Esses tempos foram medidos com a maquina CARREGADA (varias sessoes e a suite
 * competindo). Com a maquina leve, 3 rodadas seguidas ja com esta config
 * fecharam em 28s cada, 215 arquivos e 2147 testes verdes nas tres — ou seja, o
 * custo em tempo depende da carga, mas o resultado verde nao. Nao compare os
 * numeros das duas medicoes entre si; compare cada um com o seu proprio par.
 *
 * A conta e por memoria para continuar valendo em outra maquina: reserva 1,5 GB
 * para o sistema e da 1 GB por worker, sem passar do numero de nucleos. Quem
 * rodar num container menor recebe menos workers sozinho, sem editar nada.
 */
const GB = 1024 ** 3;
const maxWorkers = Math.max(
  2,
  Math.min(os.cpus().length, Math.floor((os.totalmem() - 1.5 * GB) / GB)),
);

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // `railway-server` entra porque a normalização da Meta CAPI vive lá e é
    // lógica pura cujo erro é invisível em produção (a Meta responde 200 e
    // não casa ninguém).
    include: ["src/**/*.{test,spec}.{ts,tsx}", "railway-server/src/**/*.{test,spec}.ts"],
    // Fuso fixo no fuso de quem usa o sistema. Sem isto o resultado depende da
    // MÁQUINA: `format(new Date(iso), 'dd/MM HH:mm')` do date-fns imprime em
    // hora local, então uma sessão rodando em container UTC escreve o teste
    // esperando "15:57" e a mesma suíte quebra no Brasil, onde a tela mostra
    // "12:57" (foi o que aconteceu com MentionsPanel.urgencia entre 12/08 e
    // 17/08/2026: 2 testes vermelhos aqui e verdes em UTC). Brasil não tem
    // horário de verão desde 2019, então é UTC-3 o ano inteiro.
    env: { TZ: "America/Sao_Paulo" },
    maxWorkers,
    /**
     * O default do vitest e 5000ms, e nesta suite ele nao tinha margem nenhuma.
     * Medido em 5 rodadas VERDES com a concorrencia ja corrigida, o teste mais
     * lento de cada uma levou 5875, 7321, 5742, 6073 e 5433 ms — ou seja, os
     * testes de componente pesado ja trabalham NO limite nominal, e 3 a 7 deles
     * por rodada passam de 3s.
     *
     * Com essa folga zero, qualquer lentidao (GC, disco, outro processo na
     * maquina) empurra um teste para fora e pinta de vermelho um comportamento
     * que esta correto. Foi metade do defeito; a outra metade era a
     * concorrencia acima.
     *
     * 15s nao esconde teste travado — quem trava nunca termina e falha do mesmo
     * jeito, so demora mais para reportar. Esconde apenas a diferenca entre
     * "lento" e "quebrado", que era exatamente onde a suite estava mentindo.
     */
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
