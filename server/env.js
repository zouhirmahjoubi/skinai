// Loads KEY=value lines from a .env file into process.env without overriding
// variables already set, so the server and the smoke test read the same file.

import fs from 'node:fs';

export function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2];
    if (!/^['"]/.test(v)) v = v.replace(/\s+#.*$/, '');
    process.env[m[1]] = v.replace(/^(['"])(.*)\1$/, '$2');
  }
}
