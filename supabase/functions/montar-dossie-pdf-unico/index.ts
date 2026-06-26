// Monta UM PDF único concatenando documentos selecionados (Drive).
// Aceita: pdf, jpg, jpeg, png. Ignora áudio e demais tipos.
// Ordem das páginas: identificação → procuração → comprovante → cadunico → laudo médico.
// Retorna o PDF como binário (application/pdf) para evitar inflar com base64.
// Em caso de erro de negócio, retorna application/json com { ok:false, erro, falhas? }.
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Expose-Headers": "x-dossie-paginas, x-dossie-documentos, x-dossie-tamanho-mb",
};

const GATEWAY = "https://connector-gateway.lovable.dev/google_drive/drive/v3";
const CONCURRENCY = 6;

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

function tipoRank(tipo: string, name: string): number {
  const t = `${tipo || ""} ${name || ""}`.toLowerCase();
  if (/(\brg\b|\bcpf\b|identidade|identif|cnh|rne)/.test(t)) return 1;
  if (/procura/.test(t)) return 2;
  if (/(comprovante|resid[eê]ncia|endere[cç]o)/.test(t)) return 3;
  if (/(cad\s*[uú]nico|cadunico|cad[_\s-]?un)/.test(t)) return 4;
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

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return out;
}

function jsonError(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify({ ok: false, ...payload }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const documentos: Array<{ file_id: string; name: string; mime: string; tipo: string }> =
      Array.isArray(body?.documentos) ? body.documentos : [];

    if (documentos.length === 0) {
      return jsonError({ erro: "Nenhum documento selecionado." });
    }

    const elegiveis = documentos.filter((d) => {
      if (isAudio(d.mime, d.name)) return false;
      const e = extOf(d.name, d.mime);
      return ACCEPTED_EXT.has(e);
    });

    if (elegiveis.length === 0) {
      return jsonError({ erro: "Nenhum documento elegível (apenas PDF/JPG/PNG)." });
    }

    elegiveis.sort((a, b) => {
      const ra = tipoRank(a.tipo, a.name);
      const rb = tipoRank(b.tipo, b.name);
      if (ra !== rb) return ra - rb;
      return (a.name || "").localeCompare(b.name || "");
    });

    // Download em paralelo (lotes de CONCURRENCY)
    type Baixado = { doc: typeof elegiveis[number]; bytes: Uint8Array; ext: string };
    const falhas: Array<{ nome: string; motivo: string }> = [];
    const results = await mapWithConcurrency<typeof elegiveis[number], Baixado | null>(
      elegiveis,
      CONCURRENCY,
      async (doc) => {
        const ext = extOf(doc.name, doc.mime);
        try {
          const bytes = await downloadDriveFile(doc.file_id);
          return { doc, bytes, ext };
        } catch (e: any) {
          falhas.push({ nome: doc.name, motivo: e?.message || String(e) });
          return null;
        }
      },
    );

    if (falhas.length > 0) {
      return jsonError({
        erro: `Falha ao baixar ${falhas.length} documento(s). Dossiê não foi gerado.`,
        falhas,
      });
    }

    const baixados = results.filter((r): r is Baixado => r !== null);

    const outPdf = await PDFDocument.create();
    for (const item of baixados) {
      try {
        if (item.ext === "pdf") {
          const src = await PDFDocument.load(item.bytes, { ignoreEncryption: true });
          const pages = await outPdf.copyPages(src, src.getPageIndices());
          for (const p of pages) outPdf.addPage(p);
        } else {
          const embedded = item.ext === "png"
            ? await outPdf.embedPng(item.bytes)
            : await outPdf.embedJpg(item.bytes);
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
      return jsonError({
        erro: `Falha ao processar ${falhas.length} documento(s). Dossiê não foi gerado.`,
        falhas,
      });
    }

    const pdfBytes = await outPdf.save();
    const bytesTotal = pdfBytes.byteLength;
    const mb = bytesTotal / (1024 * 1024);

    if (mb > 45) {
      return jsonError({
        erro: `Dossiê final tem ${mb.toFixed(1)} MB. O INSS rejeita arquivos acima de 50 MB. Reduza a seleção antes de baixar.`,
        tamanho_mb: Number(mb.toFixed(2)),
        paginas: outPdf.getPageCount(),
        documentos_incluidos: baixados.length,
      });
    }

    // Retorna binário direto (sem base64 inflando 33%)
    const pdfBody = pdfBytes.buffer.slice(
      pdfBytes.byteOffset,
      pdfBytes.byteOffset + pdfBytes.byteLength,
    ) as ArrayBuffer;

    return new Response(pdfBody, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Length": String(bytesTotal),
        "x-dossie-paginas": String(outPdf.getPageCount()),
        "x-dossie-documentos": String(baixados.length),
        "x-dossie-tamanho-mb": mb.toFixed(2),
      },
    });
  } catch (e: any) {
    return jsonError({ erro: e?.message || String(e) });
  }
});
