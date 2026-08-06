// =============================================================================
// Registro do PROTOCOLO INSS no ato, pelo assessor que protocolou.
//
// POR QUE existe: até 06/08/2026 a data de protocolo só era conhecida quando o
// e-mail do INSS chegava — atraso mediano de 9 DIAS — e ninguém sabia QUEM
// protocolou (linked_by estava vazio em 838 de 838 requerimentos).
//
// Regras decididas pelo usuário:
//   - a certidão de protocolo é OBRIGATÓRIA (a coluna certidao_path é NOT NULL)
//   - a data informada passa a valer na hora (trigger trg_inss_protocol_reg_aplica)
//   - se o e-mail do INSS trouxer outra data, ele SOBRESCREVE — é a fonte
//     oficial — mas deixa aviso com data anterior, nova e motivo
//     (trigger trg_inss_protocol_override)
//
// O bucket inss-protocolos é PRIVADO: a certidão traz CPF e nome do segurado.
// Dos 8 buckets do projeto, 7 são públicos — não usar nenhum deles aqui.
// =============================================================================
import { useState } from "react";
import { db } from "@/integrations/supabase";
import { useExternalUserId } from "@/hooks/useExternalUserId";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";

const BUCKET = "inss-protocolos";
const MAX_BYTES = 20 * 1024 * 1024;
const TIPOS_OK = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export interface RegistrarProtocoloAlvo {
  id: string;
  requerimento_number: string;
  nome_segurado?: string | null;
}

interface Props {
  alvo: RegistrarProtocoloAlvo | null;
  onClose: () => void;
  /** Chamado após gravar, para a lista recarregar. */
  onSaved: () => void;
}

/** Sem fuso: `new Date()` em ISO volta UTC e vira o dia anterior à noite no BR. */
function hojeLocalISO(): string {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

export default function RegistrarProtocoloDialog({ alvo, onClose, onSaved }: Props) {
  const extUserId = useExternalUserId();
  const [data, setData] = useState(hojeLocalISO());
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [obs, setObs] = useState("");
  const [salvando, setSalvando] = useState(false);

  const hoje = hojeLocalISO();
  const dataNoFuturo = !!data && data > hoje;
  const podeSalvar = !!alvo && !!data && !dataNoFuturo && !!arquivo && !!extUserId && !salvando;

  function escolherArquivo(f: File | null) {
    if (!f) return setArquivo(null);
    if (!TIPOS_OK.includes(f.type)) {
      toast.error("A certidão precisa ser PDF ou imagem (JPG, PNG, WebP).");
      return;
    }
    if (f.size > MAX_BYTES) {
      toast.error("Arquivo acima de 20 MB.");
      return;
    }
    setArquivo(f);
  }

  function fechar() {
    if (salvando) return;
    setData(hojeLocalISO());
    setArquivo(null);
    setObs("");
    onClose();
  }

  async function salvar() {
    if (!alvo || !arquivo || !extUserId) return;
    setSalvando(true);

    // Nome sanitizado: acento e espaço quebram a key do storage.
    const limpo = arquivo.name
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
    const path = `${alvo.id}/${Date.now()}-${limpo}`;

    const { error: upErr } = await db.storage.from(BUCKET).upload(path, arquivo, {
      contentType: arquivo.type,
      upsert: false,
    });
    if (upErr) {
      setSalvando(false);
      toast.error("Falha ao enviar a certidão: " + upErr.message);
      return;
    }

    const { error: insErr } = await (db as any)
      .from("inss_protocol_registrations")
      .insert({
        inss_process_id: alvo.id,
        protocol_date: data,
        certidao_path: path,
        certidao_nome: arquivo.name.slice(0, 200),
        registrado_por: extUserId,
        observacao: obs.trim() || null,
      });

    if (insErr) {
      // Não deixar o arquivo órfão no bucket se a linha não entrou.
      await db.storage.from(BUCKET).remove([path]).catch(() => {});
      setSalvando(false);
      toast.error("Falha ao registrar: " + insErr.message);
      return;
    }

    setSalvando(false);
    toast.success("Protocolo registrado. A data já vale no sistema.");
    fechar();
    onSaved();
  }

  return (
    <Dialog open={!!alvo} onOpenChange={(o) => !o && fechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar protocolo</DialogTitle>
          <DialogDescription>
            {alvo?.requerimento_number}
            {alvo?.nome_segurado ? ` — ${alvo.nome_segurado}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="prot-data">Data em que protocolou</Label>
            <Input
              id="prot-data"
              type="date"
              value={data}
              max={hoje}
              onChange={(e) => setData(e.target.value)}
            />
            {dataNoFuturo && (
              <p className="text-xs text-rose-600">A data não pode ser no futuro.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="prot-cert">
              Certidão de protocolo <span className="text-rose-600">*</span>
            </Label>
            <Input
              id="prot-cert"
              type="file"
              accept=".pdf,image/jpeg,image/png,image/webp"
              onChange={(e) => escolherArquivo(e.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-muted-foreground">
              Obrigatória — é ela que comprova a data real. PDF ou imagem, até 20 MB.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="prot-obs">Observação (opcional)</Label>
            <Textarea
              id="prot-obs"
              rows={2}
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              placeholder="Algo que ajude quem for conferir depois"
            />
          </div>

          <p className="text-xs text-muted-foreground border-l-2 pl-2">
            Se o e-mail do INSS trouxer outra data, ela substitui esta — mas o
            sistema guarda o aviso com as duas datas e o motivo.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={fechar} disabled={salvando}>Cancelar</Button>
          <Button onClick={salvar} disabled={!podeSalvar} className="gap-2">
            {salvando
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Enviando…</>
              : <><Upload className="h-4 w-4" /> Registrar</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
