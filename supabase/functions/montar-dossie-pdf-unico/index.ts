// Monta UM PDF único concatenando documentos selecionados (Drive).
// Aceita: pdf, jpg, jpeg, png, bmp. Ignora áudio e demais tipos.
// Ordem das páginas: identificação → procuração → comprovante → cadunico → laudo médico.
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import { encode as base64Encode } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
};

const GATEWAY = "https://connector-gateway.lovable.dev/google_drive/drive/v3";

function gwHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`,
    "X-Connection-Api-Key": Deno.env.get("GOOGLE_DRIVE_API_KEY")!,
  };
}

const ACCEPTED_EXT = new Set(["pdf", "jpg", "jpeg", "png"]);

function extOf(name: string, mime: string): string {
  const m = (mime || "").toLowerCase();
  if (m === "application/pdf") return "pdf";
  if (m === "image/jpeg" || m === "image/jpg") return "jpg";
  if (m === "image/png") return "png";
  if (m === "image/bmp" || m === "image/x-ms-bmp") return "bmp";
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "";
  return name.slice(dot + 1).toLowerCase();
}

function isAudio(mime: string, name: string): boolean {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("audio/")) return true;
  const e = extOf(name, "");
  return ["mp3", "ogg", "opus", "wav", "m4a", "aac", "amr"].includes(e);
}

// Ordem de classificação por tipo
function tipoRank(tipo: string, name: string): number {
  const t = `${tipo || ""} ${name || ""}`.toLowerCase();
  // 1) identificação
  if (/(\brg\b|\bcpf\b|identidade|identif|cnh|rne)/.test(t)) return 1;
  // 2) procuração
  if (/procura/.test(t)) return 2;
  // 3) comprovante de residência
  if (/(comprovante|resid[eê]ncia|endere[cç]o)/.test(t)) return 3;
  // 4) cadúnico
  if (/(cad\s*[uú]nico|cadunico|cad[_\s-]?un)/.test(t)) return 4;
  // 5) laudo médico
  if (/(laudo|m[eé]dic|relat[oó]rio|atestado|exame)/.test(t)) return 5;
  return 6;
}

async function downloadDriveFile(fileId: string): Promise<Uint8Array> {
  const res = await fetch(`${GATEWAY}/files/${fileId}?alt=media`, { headers: gwHeaders() });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength === 0) throw new Error("arquivo vazio");
  return buf;
}

// BMP não é suportado nesta versão (jimp/esm.sh quebrou). Converta para PNG/JPG antes.


Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
      const body = await req.json();
      const documentos: Array<{ file_id: string; name: string; mime: string; tipo: string }> =
        Array.isArray(body?.documentos) ? body.documentos : [];

      if (documentos.length === 0) {
        return new Response(
          JSON.stringify({ ok: false, erro: "Nenhum documento selecionado." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Filtra: ignora áudio e tipos não aceitos
      const elegiveis = documentos.filter((d) => {
        if (isAudio(d.mime, d.name)) return false;
        const e = extOf(d.name, d.mime);
        return ACCEPTED_EXT.has(e);
      });

      if (elegiveis.length === 0) {
        return new Response(
          JSON.stringify({ ok: false, erro: "Nenhum documento elegível (apenas PDF/JPG/PNG/BMP)." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Ordena por rank
      elegiveis.sort((a, b) => {
        const ra = tipoRank(a.tipo, a.name);
        const rb = tipoRank(b.tipo, b.name);
        if (ra !== rb) return ra - rb;
        return (a.name || "").localeCompare(b.name || "");
      });

      // Baixa tudo, coletando falhas
      const baixados: Array<{ doc: typeof elegiveis[number]; bytes: Uint8Array; ext: string }> = [];
      const falhas: Array<{ nome: string; motivo: string }> = [];

      for (const doc of elegiveis) {
        const ext = extOf(doc.name, doc.mime);
        try {
          const bytes = await downloadDriveFile(doc.file_id);
          baixados.push({ doc, bytes, ext });
        } catch (e: any) {
          falhas.push({ nome: doc.name, motivo: e?.message || String(e) });
        }
      }

      if (falhas.length > 0) {
        return new Response(
          JSON.stringify({
            ok: false,
            erro: `Falha ao baixar ${falhas.length} documento(s). Dossiê não foi gerado.`,
            falhas,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Monta o PDF final
      const outPdf = await PDFDocument.create();

      for (const item of baixados) {
        try {
          if (item.ext === "pdf") {
            const src = await PDFDocument.load(item.bytes, { ignoreEncryption: true });
            const pages = await outPdf.copyPages(src, src.getPageIndices());
            for (const p of pages) outPdf.addPage(p);
          } else {
            let imgBytes = item.bytes;
            let kind = item.ext;
            if (kind === "bmp") {
              throw new Error("BMP não suportado. Converta para JPG/PNG.");
            }

            const embedded = kind === "png"
              ? await outPdf.embedPng(imgBytes)
              : await outPdf.embedJpg(imgBytes);
            // Página A4-ish, ajustando proporção
            const maxW = 595;
            const maxH = 842;
            const ratio = Math.min(maxW / embedded.width, maxH / embedded.height);
            const w = embedded.width * ratio;
            const h = embedded.height * ratio;
            const page = outPdf.addPage([maxW, maxH]);
            page.drawImage(embedded, {
              x: (maxW - w) / 2,
              y: (maxH - h) / 2,
              width: w,
              height: h,
            });
          }
        } catch (e: any) {
          falhas.push({ nome: item.doc.name, motivo: `processar: ${e?.message || e}` });
        }
      }

      if (falhas.length > 0) {
        return new Response(
          JSON.stringify({
            ok: false,
            erro: `Falha ao processar ${falhas.length} documento(s). Dossiê não foi gerado.`,
            falhas,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const pdfBytes = await outPdf.save();
      const bytesTotal = pdfBytes.byteLength;
      const mb = bytesTotal / (1024 * 1024);

      if (mb > 45) {
        return new Response(
          JSON.stringify({
            ok: false,
            erro: `Dossiê final tem ${mb.toFixed(1)} MB. O INSS rejeita arquivos acima de 50 MB. Reduza a seleção antes de baixar.`,
            tamanho_mb: Number(mb.toFixed(2)),
            paginas: outPdf.getPageCount(),
            documentos_incluidos: baixados.length,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const base64 = base64Encode(pdfBytes);

      return new Response(
        JSON.stringify({
          ok: true,
          pdf_base64: base64,
          paginas: outPdf.getPageCount(),
          documentos_incluidos: baixados.length,
          tamanho_mb: Number(mb.toFixed(2)),
          tamanho_bytes: bytesTotal,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    } catch (e: any) {
      return new Response(
        JSON.stringify({ ok: false, erro: e?.message || String(e) }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
});

