import express from 'express';
import { createServer as createViteServer } from 'vite';
import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Enable CORS so both the Web App and the local Premiere Pro CEP panel can call /api/convert-video
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-File-Name');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  /**
   * POST /api/convert-video
   * Accepts raw binary video body of ANY format supported by FFmpeg / Adobe Premiere Pro
   * (.ts, .mts, .m2ts, .mkv, .mov, .mxf, .avi, .wmv, .flv, .vob, .mpg, .mpeg, .webm, .m4v, .3gp, etc.)
   * and converts/remuxes it into a frame-accurate H.264 MP4 stream for HTML5 <video> optical flow tracking.
   */
  app.post(
    '/api/convert-video',
    express.raw({ type: '*/*', limit: '500mb' }),
    (req, res) => {
      const buffer = req.body as Buffer;
      if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
        res.status(400).json({ error: 'Empty video buffer received.' });
        return;
      }

      const rawName = String(req.headers['x-file-name'] || 'input.ts');
      const ext = path.extname(rawName).replace(/[^a-zA-Z0-9.]/g, '') || '.ts';
      const id = crypto.randomBytes(8).toString('hex');
      const tmpDir = os.tmpdir();
      const inputPath = path.join(tmpDir, `mt_in_${id}${ext}`);
      const outputPath = path.join(tmpDir, `mt_out_${id}.mp4`);

      const cleanup = () => {
        try {
          if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        } catch {}
        try {
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        } catch {}
      };

      try {
        fs.writeFileSync(inputPath, buffer);
      } catch (err) {
        cleanup();
        res.status(500).json({ error: 'Failed to write temporary video file.' });
        return;
      }

      // Transcode with ultrafast H.264 and dense keyframes (-g 15) for instant frame-accurate seeking
      const ffmpegArgs = [
        '-y',
        '-i',
        inputPath,
        '-map',
        '0:v:0',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '18',
        '-pix_fmt',
        'yuv420p',
        '-vf',
        'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-g',
        '15',
        '-an',
        '-movflags',
        '+faststart',
        outputPath,
      ];

      execFile('ffmpeg', ffmpegArgs, { timeout: 120000 }, (err) => {
        if (err || !fs.existsSync(outputPath)) {
          cleanup();
          res.status(500).json({
            error: `FFmpeg conversion failed for ${rawName}: ${err ? err.message : 'No output'}`,
          });
          return;
        }

        try {
          const mp4Buffer = fs.readFileSync(outputPath);
          cleanup();
          res.setHeader('Content-Type', 'video/mp4');
          res.setHeader('Content-Length', String(mp4Buffer.length));
          res.status(200).send(mp4Buffer);
        } catch (readErr) {
          cleanup();
          res.status(500).json({ error: 'Failed to read converted MP4.' });
        }
      });
    }
  );

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MotionTracker by Nightosphere server running on http://localhost:${PORT}`);
  });
}

startServer();
