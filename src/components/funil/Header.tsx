import { FUNIL_THEME } from "./shared";

export function FunilHeader({ right }: { right?: React.ReactNode }) {
  return (
    <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-4">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-xl text-xl font-semibold"
          style={{
            background: `linear-gradient(135deg, ${FUNIL_THEME.accent}, ${FUNIL_THEME.accentDeep})`,
            color: "#fff",
            fontFamily: '"Newsreader", serif',
            boxShadow: "0 12px 30px -10px rgba(99,102,241,0.5)",
          }}
        >
          F
        </div>
        <div>
          <h1
            className="text-2xl md:text-[28px] leading-tight"
            style={{
              fontFamily: '"Newsreader", serif',
              color: FUNIL_THEME.textPrimary,
              fontWeight: 500,
              letterSpacing: -0.3,
            }}
          >
            Funil de Conversão
          </h1>
          <p
            className="text-sm mt-1"
            style={{ color: FUNIL_THEME.textSecondary }}
          >
            Planilha BPC-LOAS · BASE_UNIFICADA · histórico de etapas (horário de Brasília)
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">{right}</div>
    </header>
  );
}
