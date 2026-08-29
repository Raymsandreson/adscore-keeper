/**
 * Card de testemunho pro Instagram — SVG renderizado com sharp (1080×1350, 4:5).
 *
 * Por que fonte embutida: o container do Railway não garante NENHUMA fonte
 * instalada; texto em SVG sem fonte vira retângulo vazio. As Poppins (OFL,
 * licença em assets/fonts/OFL.txt) vivem no repo e um fonts.conf gerado em
 * runtime aponta o fontconfig pra elas — determinístico em qualquer container.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';

// Em dev (tsx, src/lib) e em build (dist/lib) o assets fica dois níveis acima.
const FONTS_DIR = path.resolve(__dirname, '..', '..', 'assets', 'fonts');

/**
 * fontconfig lê FONTCONFIG_PATH na primeira renderização de texto do processo.
 * Este módulo é importado no boot do servidor (index.ts importa as functions),
 * então o env está posto antes de qualquer render.
 */
function ensureFontconfig(): void {
  if (process.env.WJUD_FONTCONFIG_READY) return;
  const cfgDir = path.join(os.tmpdir(), 'wjud-fontconfig');
  const cacheDir = path.join(cfgDir, 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const conf = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${FONTS_DIR}</dir>
  <cachedir>${cacheDir}</cachedir>
</fontconfig>
`;
  fs.writeFileSync(path.join(cfgDir, 'fonts.conf'), conf);
  process.env.FONTCONFIG_PATH = cfgDir;
  process.env.WJUD_FONTCONFIG_READY = '1';
}
ensureFontconfig();

const W = 1080;
const H = 1350;
const MARGIN = 100;
const TEXT_WIDTH = W - MARGIN * 2;

const GOLD = '#C9A24B';
const WHITE = '#F4F7FA';
const MUTED = '#9FB3C8';

/** Poppins não tem o glifo ★ (virava tofu) — estrela desenhada como polígono. */
function starPoints(cx: number, cy: number, outer: number): string {
  const inner = outer * 0.42;
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

function starsRow(cy: number, count = 5, outer = 22, gap = 62): string {
  const start = W / 2 - ((count - 1) * gap) / 2;
  return Array.from({ length: count })
    .map((_, i) => `<polygon points="${starPoints(start + i * gap, cy, outer)}" fill="${GOLD}"/>`)
    .join('\n  ');
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Quebra por largura estimada (Poppins ≈ 0.55×font-size por caractere).
 * SVG não quebra linha sozinho; sem isso a citação estoura o card.
 */
function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
  const maxChars = Math.max(8, Math.floor(maxWidth / (fontSize * 0.55)));
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Fonte adaptativa: citação curta ganha corpo, longa encolhe pra caber. */
function quoteFontSize(len: number): number {
  if (len <= 120) return 56;
  if (len <= 200) return 50;
  if (len <= 280) return 44;
  return 38;
}

export interface TestimonialCardOptions {
  quote: string;
  displayName: string;
  /** Ex.: "mãe de assistido", "cliente BPC". Vazio → "Cliente". */
  contextLabel?: string;
  brandName: string;
  /** Ex.: "@rprudencioadv" — linha menor no rodapé. */
  handle?: string;
}

export async function renderTestimonialCard(opts: TestimonialCardOptions): Promise<Buffer> {
  const quote = opts.quote.trim();
  const fontSize = quoteFontSize(quote.length);
  const lineHeight = Math.round(fontSize * 1.45);
  const lines = wrapText(quote, fontSize, TEXT_WIDTH);

  // Bloco da citação centralizado verticalmente entre o topo (~380) e os
  // elementos fixos de baixo (estrelas em y≈1020).
  const blockTop = 380;
  const blockBottom = 980;
  const blockHeight = lines.length * lineHeight;
  const firstLineY = Math.max(
    blockTop + fontSize,
    Math.round((blockTop + blockBottom - blockHeight) / 2) + fontSize,
  );

  const quoteTspans = lines
    .map((l, i) => `<tspan x="${W / 2}" y="${firstLineY + i * lineHeight}">${escapeXml(l)}</tspan>`)
    .join('\n      ');

  const contextLabel = (opts.contextLabel || 'Cliente').trim();
  const handleLine = opts.handle
    ? `<text x="${W / 2}" y="1288" text-anchor="middle" font-family="Poppins" font-size="26" fill="${GOLD}">${escapeXml(opts.handle)}</text>`
    : '';

  const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0B1F35"/>
      <stop offset="1" stop-color="#16395E"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect x="36" y="36" width="${W - 72}" height="${H - 72}" fill="none" stroke="${GOLD}" stroke-opacity="0.35" stroke-width="2"/>

  <text x="${W / 2}" y="160" text-anchor="middle" font-family="Poppins" font-weight="600" font-size="26" letter-spacing="7" fill="${GOLD}">DEPOIMENTO DE CLIENTE</text>

  <text x="${W / 2}" y="330" text-anchor="middle" font-family="Poppins" font-weight="700" font-size="200" fill="${GOLD}" fill-opacity="0.9">&#8220;</text>

  <text text-anchor="middle" font-family="Poppins" font-weight="500" font-size="${fontSize}" fill="${WHITE}">
      ${quoteTspans}
  </text>

  ${starsRow(1032)}

  <text x="${W / 2}" y="1122" text-anchor="middle" font-family="Poppins" font-weight="700" font-size="40" fill="${WHITE}">${escapeXml(opts.displayName)}</text>
  <text x="${W / 2}" y="1164" text-anchor="middle" font-family="Poppins" font-size="27" fill="${MUTED}">${escapeXml(contextLabel)}</text>

  <rect x="${W / 2 - 40}" y="1204" width="80" height="2" fill="${GOLD}"/>
  <text x="${W / 2}" y="1252" text-anchor="middle" font-family="Poppins" font-weight="600" font-size="30" fill="${WHITE}">${escapeXml(opts.brandName)}</text>
  ${handleLine}
</svg>`;

  return sharp(Buffer.from(svg)).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
}
