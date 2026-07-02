/**
 * transcode-audio-opus — recebe { url } de um áudio (webm/mp4/etc), baixa,
 * transcodifica com ffmpeg-static pra ogg/opus mono 48k 32kbps (formato nativo
 * das mensagens de voz do WhatsApp), sobe pro bucket `whatsapp-media` do
 * Supabase Externo e devolve { url, mime, size_in, size_out }.
 *
 * Usado pelo ActivityCallRecorder pra padronizar o formato antes de enviar
 * o áudio pro grupo via send-whatsapp (UazAPI/Cloud).
 */

import { RequestHandler } from 'express';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import ffmpegPath from 'ffmpeg-static';
import { supabase } from '../lib/supabase';

export const handler: RequestHandler = async (req, res) => {
  const rid = (req.headers['x-request-id'] as string) || `tx-${Date.now()}`;
  const url = String(req.body?.url || '').trim();
  const folder = String(req.body?.folder || 'transcoded').replace(/[^a-z0-9/_-]/gi, '') || 'transcoded';

  if (!url) {
    res.status(200).json({ success: false, error: 'url obrigatório', error_code: 'MISSING_URL' });
    return;
  }
  if (!ffmpegPath) {
    res.status(200).json({ success: false, error: 'ffmpeg indisponível', error_code: 'NO_FFMPEG' });
    return;
  }

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const inPath = path.join(tmpdir(), `tx-in-${stamp}.bin`);
  const outPath = path.join(tmpdir(), `tx-out-${stamp}.ogg`);

  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      res.status(200).json({ success: false, error: `download falhou: ${resp.status}`, error_code: 'DOWNLOAD_FAIL' });
      return;
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    await fs.writeFile(inPath, buf);

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpegPath as string, [
        '-y',
        '-i', inPath,
        '-vn',
        '-c:a', 'libopus',
        '-b:a', '32k',
        '-ac', '1',
        '-ar', '48000',
        '-f', 'ogg',
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

    const outBytes = await fs.readFile(outPath);
    const storagePath = `${folder}/audio-opus-${stamp}.ogg`;
    const { error: upErr } = await supabase.storage
      .from('whatsapp-media')
      .upload(storagePath, outBytes, {
        contentType: 'audio/ogg',
        upsert: false,
        cacheControl: '31536000',
      });
    if (upErr) {
      console.error(`[transcode-audio-opus ${rid}] upload falhou:`, upErr);
      res.status(200).json({ success: false, error: upErr.message, error_code: 'UPLOAD_FAIL' });
      return;
    }
    const { data: pub } = supabase.storage.from('whatsapp-media').getPublicUrl(storagePath);
    if (!pub?.publicUrl) {
      res.status(200).json({ success: false, error: 'sem publicUrl', error_code: 'NO_PUBLIC_URL' });
      return;
    }
    console.log(`[transcode-audio-opus ${rid}] ${buf.length}B → ${outBytes.length}B ok`);
    res.status(200).json({
      success: true,
      url: pub.publicUrl,
      mime: 'audio/ogg',
      size_in: buf.length,
      size_out: outBytes.length,
    });
  } catch (err: any) {
    console.error(`[transcode-audio-opus ${rid}] exceção:`, err);
    res.status(200).json({ success: false, error: err?.message || String(err), error_code: 'TRANSCODE_EXCEPTION' });
  } finally {
    await fs.unlink(inPath).catch(() => {});
    await fs.unlink(outPath).catch(() => {});
  }
};
