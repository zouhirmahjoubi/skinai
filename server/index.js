// Entry point. `npm run dev` serves the React app through Vite middleware;
// `npm start` serves the built app from dist/. One process either way.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApp } from './app.js';
import { createYouCamClient } from './youcam.js';
import { createLiveFeatures, createDemoFeatures } from './features.js';
import { createYouCamMcp } from './youcam-mcp.js';
import { createAgent, createDemoAgent } from './agent.js';
import { loadDotEnv } from './env.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadDotEnv(path.join(root, '.env'));

const dev = process.argv.includes('--dev');
// Set here rather than in package.json so `npm start` also works on Windows.
if (!dev) process.env.NODE_ENV ||= 'production';
const apiKey = (process.env.YOUCAM_API_KEY || '').trim();
const forceDemo = process.env.DEMO_MODE === '1';
const features = apiKey && !forceDemo ? createLiveFeatures(createYouCamClient({ apiKey }), { mcp: createYouCamMcp({ apiKey }) }) : createDemoFeatures();
// The companion runs on Claude through KIE's Anthropic-compatible API.
const kieKey = (process.env.KIE_API_KEY || '').trim();
const agent = kieKey ? createAgent({ apiKey: kieKey, model: (process.env.AGENT_MODEL || 'claude-sonnet-5-5').trim(), features }) : createDemoAgent({ features });

// An empty or invalid value falls back to the default instead of switching a limit off.
const envNumber = (name, fallback) => {
  const raw = process.env[name];
  const n = Number(raw);
  return raw !== undefined && raw.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : fallback;
};
const accessCode = (process.env.APP_ACCESS_CODE || '').trim();

const app = createApp({
  features,
  agent,
  accessCode,
  perIpDailyChats: envNumber('PER_IP_DAILY_CHATS', 40),
  dailyChatBudget: envNumber('DAILY_CHAT_BUDGET', 400),
  perIpDailyUnits: envNumber('PER_IP_DAILY_UNITS', 100),
  dailyUnitBudget: envNumber('DAILY_UNIT_BUDGET', 300),
  trustProxy: envNumber('TRUST_PROXY', 1),
  csp: !dev,
});

if (dev) {
  const { createServer } = await import('vite');
  // Vite looks for its config in `root` (web/), so point it at the repo-root
  // vite.config.js; without it the React plugin never loads and JSX fails.
  const vite = await createServer({
    configFile: path.join(root, 'vite.config.js'),
    root: path.join(root, 'web'),
    server: { middlewareMode: true },
    appType: 'spa',
  });
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
  console.log(`Still Me running at http://localhost:${port} (${features.mode} mode${dev ? ', dev' : ''})`);
  if (features.mode === 'demo') console.log('No YOUCAM_API_KEY set: using demo results. Add a key to .env for live analysis.');
  if (features.mode === 'live') {
    if (!accessCode) console.warn('APP_ACCESS_CODE is not set: anyone with the link can spend YouCam units.');
    features
      .units()
      .then((u) => console.log(`YouCam key OK (${u} units left)`))
      .catch((e) => console.error(`YouCam key check FAILED (${e.code}): live calls will fail until YOUCAM_API_KEY is fixed`));
  }
});
