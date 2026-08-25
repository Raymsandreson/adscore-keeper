import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group z-[120]"
      expand
      visibleToasts={9}
      toastOptions={{
        classNames: {
          // pointer-events-auto: com Sheet/Dialog aberto o Radix põe
          // pointer-events:none no body e o toast herdava — ficava visível e
          // não clicável (ex.: popup de feedback sobre o painel de Feedbacks).
          toast:
            "group toast pointer-events-auto group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg group-[.toaster]:z-[121]",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          // O X só aparece nos toasts que pedem `closeButton: true` (hoje os
          // popups de atividade). A classe existe para ele herdar o tema do
          // app — sem isso o botão usa as variáveis próprias do sonner e
          // destoa do fundo `bg-background` que sobrescrevemos acima.
          closeButton:
            "group-[.toast]:bg-background group-[.toast]:text-foreground group-[.toast]:border-border group-[.toast]:hover:bg-muted",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
