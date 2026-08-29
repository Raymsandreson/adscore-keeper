/**
 * Reel de testemunho — a VOZ do cliente sobre o card (1080×1920, 9:16).
 *
 * A Graph API só publica vídeo como REELS (media_type=REELS, video_url), e
 * Reel pede 9:16: o card 1080×1350 é centralizado num canvas 1080×1920 com o
 * mesmo azul do fundo. ffmpeg-static (já dependência do transcode de áudio)
 * faz o mux: imagem em loop + áudio original → H.264/AAC com +faststart.
 */
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import ffmpegPath from 'ffmpeg-static';

const CANVAS_BG = '0x0B1F35'; // mesmo tom do topo do gradiente do card

export async function renderTestimonialReel(cardJpeg: Buffer, audioUrl: string): Promise<Buffer> {
  if (!ffmpegPath) throw new Error('ffmpeg indisponível no servidor');

  const resp = await fetch(audioUrl);
  if (!resp.ok) throw new Error(`Download do áudio falhou: HTTP ${resp.status}`);
  const audio = Buffer.from(await resp.arrayBuffer());

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const imgPath = path.join(tmpdir(), `reel-img-${stamp}.jpg`);
  const audioPath = path.join(tmpdir(), `reel-audio-${stamp}.bin`);
  const outPath = path.join(tmpdir(), `reel-out-${stamp}.mp4`);

  try {
    await fs.writeFile(imgPath, cardJpeg);
    await fs.writeFile(audioPath, audio);

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpegPath as string, [
        '-y',
        '-loop', '1',
        '-framerate', '30',
        '-i', imgPath,
        '-i', audioPath,
        '-vf', `scale=1080:1350,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=${CANVAS_BG}`,
        '-c:v', 'libx264',
        '-tune', 'stillimage',
        '-preset', 'medium',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '44100',
        '-shortest',
        '-movflags', '+faststart',
        '-f', 'mp4',
        outPath,
      ]);
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-400)}`));
      });
    });

    return await fs.readFile(outPath);
  } finally {
    // Falha de limpeza não pode derrubar a geração.
    await Promise.allSettled([fs.unlink(imgPath), fs.unlink(audioPath), fs.unlink(outPath)]);
  }
}
