import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Fuso fixo no fuso de quem usa o sistema. Sem isto o resultado depende da
    // MÁQUINA: `format(new Date(iso), 'dd/MM HH:mm')` do date-fns imprime em
    // hora local, então uma sessão rodando em container UTC escreve o teste
    // esperando "15:57" e a mesma suíte quebra no Brasil, onde a tela mostra
    // "12:57" (foi o que aconteceu com MentionsPanel.urgencia entre 12/08 e
    // 17/08/2026: 2 testes vermelhos aqui e verdes em UTC). Brasil não tem
    // horário de verão desde 2019, então é UTC-3 o ano inteiro.
    env: { TZ: "America/Sao_Paulo" },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
