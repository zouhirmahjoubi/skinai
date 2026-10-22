// Entry point. `npm run dev` serves the React app through Vite middleware;
// `npm start` serves the built app from dist/. One process either way.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApp } from './app.js';
import { createYouCamClient } from './youcam.js';
import { createLiveFeatures, createDemoFeatures } from './features.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadDotEnv(path.join(root, '.env'));

const dev = process.argv.includes('--dev');
const apiKey = (process.env.YOUCAM_API_KEY || '').trim();
const forceDemo = process.env.DEMO_MODE === '1';
const features = apiKey && !forceDemo ? createLiveFeatures(createYouCamClient({ apiKey })) : createDemoFeatures();

const app = createApp({
  features,
  accessCode: (process.env.APP_ACCESS_CODE || '').trim(),
  perIpDailyLimit: Number(process.env.PER_IP_DAILY_LIMIT ?? 40),
});

if (dev) {
  const { createServer } = await import('vite');
  const vite = await createServer({ root: path.join(root, 'web'), server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
} else {
  const dist = path.join(root, 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    console.error('dist/ is missing. Run `npm run build` first (or `npm run dev`).');
    process.exit(1);
  }
  app.use(express.static(dist, { maxAge: '1h', index: false }));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  console.log(`Ahead running at http://localhost:${port} (${features.mode} mode${dev ? ', dev' : ''})`);
  if (features.mode === 'demo') console.log('No YOUCAM_API_KEY set: using demo results. Add a key to .env for live analysis.');
});

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
