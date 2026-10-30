import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createYouCamClient } from '../server/youcam.js';
import { createLiveFeatures, createDemoFeatures, MAX_DEMO_BYTES } from '../server/features.js';
import { fetchRefImage, isPrivateAddress, RefImageError } from '../server/ref-image.js';
import { createApp, isPublicHttpsUrl } from '../server/app.js';
import { sniffImage, skinTierFor } from '../server/image-info.js';
import { explain, YouCamError } from '../server/errors.js';

// Minimal fake of the YouCam HTTP surface, recording every call.
function fakeYouCam(handlers) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const entry = { method: init.method || 'GET', path: u.pathname + u.search, body: init.body, headers: init.headers };
    calls.push(entry);
    const h = handlers.find(([m, re]) => m === entry.method && re.test(entry.path));
    if (!h) return new Response(JSON.stringify({ status: 404, error: 'nope', error_code: 'NotFound' }), { status: 404 });
    const out = await h[2](entry);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchImpl };
}

const noSleep = async () => {};

function jpeg(width, height) {
  const b = Buffer.alloc(64);
  b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], 0);
  let i = 2 + 2 + 0x10;
  b.set([0xff, 0xc0, 0x00, 0x11, 0x08], i);
  b.writeUInt16BE(height, i + 5);
  b.writeUInt16BE(width, i + 7);
  return b;
}

test('reads JPEG and PNG dimensions from headers', () => {
  assert.deepEqual(sniffImage(jpeg(1440, 1080)), { type: 'image/jpeg', ext: 'jpg', width: 1440, height: 1080 });
  const png = Buffer.alloc(32);
  png.writeUInt32BE(0x89504e47, 0);
  png.writeUInt32BE(0x0d0a1a0a, 4);
  png.writeUInt32BE(800, 16);
  png.writeUInt32BE(600, 20);
  assert.equal(sniffImage(png).width, 800);
  assert.equal(sniffImage(Buffer.from('not an image at all, really')), null);
  assert.equal(skinTierFor({ width: 1080, height: 1440 }), 'hd');
  assert.equal(skinTierFor({ width: 720, height: 960 }), 'sd');
  assert.equal(skinTierFor({ width: 400, height: 300 }), null);
});

test('upload registers the file then PUTs the bytes to the presigned URL', async () => {
  const { calls, fetchImpl } = fakeYouCam([
    ['POST', /^\/s2s\/v2\.0\/file$/, () => ({ status: 200, data: { files: [{ file_id: 'F1', requests: [{ method: 'PUT', url: 'https://storage.example/u1', headers: { 'Content-Type': 'image/jpeg' } }] }] } })],
    ['PUT', /^\/u1$/, () => new Response('', { status: 200 })],
  ]);
  const client = createYouCamClient({ apiKey: 'k', fetchImpl, sleep: noSleep });
  const id = await client.uploadImage(Buffer.from('abc'), { contentType: 'image/jpeg', fileName: 'a.jpg' });
  assert.equal(id, 'F1');
  assert.equal(calls[0].headers.Authorization, 'Bearer k');
  assert.deepEqual(JSON.parse(calls[0].body), { files: [{ content_type: 'image/jpeg', file_name: 'a.jpg', file_size: 3 }] });
  assert.equal(calls[1].method, 'PUT');
});

test('skin analysis uses v2.1, json format, and polls until success', async () => {
  let polls = 0;
  const { calls, fetchImpl } = fakeYouCam([
    ['POST', /^\/s2s\/v2\.1\/task\/skin-analysis$/, () => ({ status: 200, data: { task_id: 'T1' } })],
    ['GET', /^\/s2s\/v2\.1\/task\/skin-analysis\/T1$/, () => {
      polls += 1;
      if (polls < 3) return { status: 200, data: { task_status: 'running' } };
      return { status: 200, data: { task_status: 'success', results: { output: [{ type: 'hd_redness', ui_score: 77, raw_score: 72.01, mask_urls: ['https://cdn.example/m.png'] }, { type: 'resize_image', mask_urls: ['https://cdn.example/base.jpg'] }] } } };
    }],
    ['GET', /^\/(m\.png|base\.jpg)$/, () => new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47]), { status: 200, headers: { 'content-type': 'image/png' } })],
    ['POST', /^\/s2s\/v2\.0\/task\/delete$/, () => ({ status: 200 })],
  ]);
  const client = createYouCamClient({ apiKey: 'k', fetchImpl, sleep: noSleep });
  const features = createLiveFeatures(client, { fetchImpl });
  const out = await features.analyzeSkin({ fileId: 'F1', tier: 'hd' });
  const body = JSON.parse(calls[0].body);
  assert.equal(body.format, 'json');
  assert.equal(body.src_file_id, 'F1');
  assert.ok(body.dst_actions.includes('hd_redness') && body.dst_actions.every((a) => a.startsWith('hd_')));
  assert.equal(polls, 3);
  assert.equal(out.scores.redness.ui, 77);
  assert.match(out.scores.redness.mask, /^data:image\/png;base64,/);
  assert.match(out.baseImage, /^data:image\/png;base64,/);
  const del = calls.findIndex((c) => c.path === '/s2s/v2.0/task/delete');
  assert.deepEqual(JSON.parse(calls[del].body), { task_id: 'T1' });
  assert.ok(del > calls.findIndex((c) => c.path === '/m.png'), 'task is deleted after its masks are downloaded');
  assert.equal(out.deleted, true);
});

test('task errors surface the engine error code', async () => {
  const { fetchImpl } = fakeYouCam([
    ['POST', /task\/skin-tone-analysis$/, () => ({ status: 200, data: { task_id: 'T2' } })],
    ['GET', /task\/skin-tone-analysis\/T2$/, () => ({ status: 200, data: { task_status: 'error', error: 'error_no_face' } })],
  ]);
  const client = createYouCamClient({ apiKey: 'k', fetchImpl, sleep: noSleep });
  await assert.rejects(client.runTask('skin-tone-analysis', { src_file_id: 'F' }), (err) => err.code === 'error_no_face');
  assert.equal(explain('error_no_face').fix, 'photo');
  assert.equal(explain('CreditInsufficiency').fix, 'setup');
  assert.equal(explain('error_face_angle_left_tilt').fix, 'photo');
});

test('HTTP errors carry YouCam error_code', async () => {
  const { fetchImpl } = fakeYouCam([
    ['POST', /task\/makeup-vto$/, () => new Response(JSON.stringify({ status: 400, error: 'cannot mix HD and SD dst_actions', error_code: 'InvalidParameters' }), { status: 400 })],
  ]);
  const client = createYouCamClient({ apiKey: 'k', fetchImpl, sleep: noSleep });
  await assert.rejects(client.startTask('makeup-vto', {}), (err) => err.code === 'InvalidParameters' && err.status === 400);
});

test('401/429 bodies with only prose map to setup and rate-limit codes', async () => {
  const { fetchImpl } = fakeYouCam([
    ['GET', /client\/credit$/, () => new Response(JSON.stringify({ status: 401, error: 'Invalid API key' }), { status: 401 })],
    ['POST', /task\/makeup-vto$/, () => new Response(JSON.stringify({ status: 429, error: 'Too many requests' }), { status: 429 })],
  ]);
  const client = createYouCamClient({ apiKey: 'k', fetchImpl, sleep: noSleep });
  await assert.rejects(client.unitBalance(), (err) => err.code === 'InvalidApiKey' && explain(err.code).fix === 'setup');
  await assert.rejects(client.startTask('makeup-vto', {}), (err) => err.code === 'RateLimitExceeded');
  for (const c of ['InvalidApiKey', 'InactiveApiKey', 'ExpiredApiKey', 'InvalidAccessToken']) assert.equal(explain(c).fix, 'setup');
});

test('a transient poll failure does not abandon a paid task', async () => {
  let polls = 0;
  const { fetchImpl } = fakeYouCam([
    ['POST', /task\/skin-tone-analysis$/, () => ({ status: 200, data: { task_id: 'T3' } })],
    ['GET', /task\/skin-tone-analysis\/T3$/, () => {
      polls += 1;
      if (polls === 2) return new Response(JSON.stringify({ status: 503, error: 'busy' }), { status: 503 });
      return polls < 3 ? { status: 200, data: { task_status: 'running' } } : { status: 200, data: { task_status: 'success', results: { color: { skin_color: '#aa8877' } } } };
    }],
  ]);
  const client = createYouCamClient({ apiKey: 'k', fetchImpl, sleep: noSleep });
  const out = await client.runTask('skin-tone-analysis', { src_file_id: 'F' });
  assert.equal(out.color.skin_color, '#aa8877');
});

test('unit balance uses amount_dec', async () => {
  const { fetchImpl } = fakeYouCam([['GET', /client\/credit$/, () => ({ status: 200, results: [{ amount: 10, amount_dec: 10.04 }, { amount_dec: 0.5 }] })]]);
  assert.equal(await createYouCamClient({ apiKey: 'k', fetchImpl, sleep: noSleep }).unitBalance(), 10.54);
});

test('hairstyle try-on sends template + hair_color and brow try-on disables smoothing', async () => {
  const bodies = {};
  const { fetchImpl } = fakeYouCam([
    ['POST', /^\/s2s\/v2\.1\/task\/hair-transfer$/, (e) => ((bodies.hair = JSON.parse(e.body)), { status: 200, data: { task_id: 'H' } })],
    ['GET', /^\/s2s\/v2\.1\/task\/hair-transfer\/H$/, () => ({ status: 200, data: { task_status: 'success', results: { url: 'https://cdn.example/h.jpg' } } })],
    ['POST', /^\/s2s\/v2\.0\/task\/makeup-vto$/, (e) => ((bodies.brow = JSON.parse(e.body)), { status: 200, data: { task_id: 'B' } })],
    ['GET', /^\/s2s\/v2\.0\/task\/makeup-vto\/B$/, () => ({ status: 200, data: { task_status: 'success', results: { url: 'https://cdn.example/b.jpg' } } })],
    ['GET', /^\/(h|b)\.jpg$/, () => new Response(Buffer.from([0xff, 0xd8, 0xff]), { status: 200, headers: { 'content-type': 'image/jpeg' } })],
  ]);
  const features = createLiveFeatures(createYouCamClient({ apiKey: 'k', fetchImpl, sleep: noSleep }), { fetchImpl });
  const hair = await features.hairTryOn({ fileId: 'F', templateId: 'female_medium_straight', keepColor: true });
  assert.deepEqual(bodies.hair, { src_file_id: 'F', hair_color: 'src', template_id: 'female_medium_straight' });
  await features.hairTryOn({ fileId: 'F', refFileId: 'R', keepColor: true });
  assert.deepEqual(bodies.hair, { src_file_id: 'F', ref_file_id: 'R' }, 'a reference photo keeps its own colour: no hair_color');
  assert.match(hair.image, /^data:image\/jpeg;base64,/);
  await features.browTryOn({ fileId: 'F', pattern: 'SoftArch1', color: '#33241d', intensity: 55 });
  assert.equal(bodies.brow.version, '1.0');
  assert.equal(bodies.brow.effects[0].skinSmoothStrength, 0);
  assert.equal(bodies.brow.effects[1].pattern.name, 'SoftArch1');
  await features.browTryOn({ fileId: 'F', pattern: 'SoftArch1', color: '#33241d', lashes: { style: 'Natural5' }, lips: { color: '#a85e5e' } });
  assert.deepEqual(bodies.brow.effects.map((e) => e.category), ['skin_smooth', 'eyebrows', 'eyelashes', 'lip_color'], 'extras ride in the same 1-unit task');
});

test('try-ons and prints delete their YouCam tasks once the result is in hand, and failed ones too', async () => {
  const { calls, fetchImpl } = fakeYouCam([
    ['POST', /^\/s2s\/v2\.0\/task\/hat$/, () => ({ status: 200, data: { task_id: 'HAT' } })],
    ['GET', /^\/s2s\/v2\.0\/task\/hat\/HAT$/, () => ({ status: 200, data: { task_status: 'success', results: { url: 'https://cdn.example/hat.jpg' } } })],
    ['POST', /^\/s2s\/v2\.0\/task\/makeup-vto$/, () => ({ status: 200, data: { task_id: 'BAD' } })],
    ['GET', /^\/s2s\/v2\.0\/task\/makeup-vto\/BAD$/, () => ({ status: 200, data: { task_status: 'error', error: 'error_no_face' } })],
    ['POST', /task\/skin-tone-analysis$/, () => ({ status: 200, data: { task_id: 'TONE' } })],
    ['GET', /task\/skin-tone-analysis\/TONE$/, () => ({ status: 200, data: { task_status: 'success', results: { color: { hair_color_name: 'Black' } } } })],
    ['POST', /task\/face-attr-analysis$/, () => ({ status: 200, data: { task_id: 'FACE' } })],
    ['GET', /task\/face-attr-analysis\/FACE$/, () => ({ status: 200, data: { task_status: 'success', results: { faceshape: 'Oval' } } })],
    ['POST', /^\/s2s\/v2\.0\/task\/delete$/, () => ({ status: 200, data: {} })],
    ['GET', /^\/hat\.jpg$/, () => new Response(Buffer.from([0xff, 0xd8, 0xff]), { status: 200, headers: { 'content-type': 'image/jpeg' } })],
  ]);
  const features = createLiveFeatures(createYouCamClient({ apiKey: 'k', fetchImpl, sleep: noSleep }), { fetchImpl });
  const deletes = () => calls.filter((c) => c.path === '/s2s/v2.0/task/delete').map((c) => JSON.parse(c.body).task_id);

  const hat = await features.hatTryOn({ fileId: 'F', refFileId: 'R', gender: 'female' });
  assert.equal(hat.deleted, true);
  const hatGet = calls.findIndex((c) => c.path === '/hat.jpg');
  assert.ok(hatGet >= 0 && hatGet < calls.findIndex((c) => c.path === '/s2s/v2.0/task/delete'), 'the image is downloaded before the task is deleted');
  await assert.rejects(features.browTryOn({ fileId: 'F' }), (err) => err.code === 'error_no_face');
  const print = await features.print({ fileId: 'F' });
  assert.equal(print.colors.hair_color_name, 'Black');
  assert.equal(print.face.faceShape, 'Oval');
  assert.equal(print.deleted, true);
  assert.deepEqual(deletes(), ['HAT', 'BAD', 'TONE', 'FACE']);
});

test('the first poll waits, since no task is done the moment it starts', async () => {
  const slept = [];
  const { calls, fetchImpl } = fakeYouCam([
    ['POST', /task\/hat$/, () => ({ status: 200, data: { task_id: 'T' } })],
    ['GET', /task\/hat\/T$/, () => ({ status: 200, data: { task_status: 'success', results: {} } })],
  ]);
  const client = createYouCamClient({ apiKey: 'k', fetchImpl, sleep: async (ms) => slept.push([ms, calls.length]) });
  await client.runTask('hat', {});
  assert.deepEqual(slept, [[2000, 1]], 'one wait, after the start and before the first poll');
});

test('brow shapes are the curated list with catalog thumbnails, not every catalog row', async () => {
  const rows = [
    ...Array.from({ length: 20 }, (_, i) => ({ label: `Arrow${i + 2}`, category: 'Arrow', thumbnail: `https://t/a${i}.png` })),
    { label: 'Arrow1', category: 'Arrow', thumbnail: 'https://t/arrow1.png' },
    { label: 'Original2', category: 'Natural', thumbnail: 'https://t/orig2.png' },
  ];
  const fetchImpl = async () => new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } });
  const features = createLiveFeatures(createYouCamClient({ apiKey: 'k', fetchImpl, sleep: noSleep }), { fetchImpl });
  const list = await features.browPatterns();
  assert.deepEqual(list, [
    { label: 'Original2', name: 'Natural', thumb: 'https://t/orig2.png' },
    { label: 'Arrow1', name: 'Angled', thumb: 'https://t/arrow1.png' },
  ]);
});

test('template listing follows next_token pages', async () => {
  const { fetchImpl } = fakeYouCam([
    ['GET', /template\/hair-transfer\?page_size=20$/, () => ({ status: 200, data: { templates: [{ id: 'a', title: 'A', keep_users_color: true }], next_token: 'p2' } })],
    ['GET', /template\/hair-transfer\?page_size=20&starting_token=p2$/, () => ({ status: 200, data: { templates: [{ id: 'b', title: 'B' }] } })],
  ]);
  const features = createLiveFeatures(createYouCamClient({ apiKey: 'k', fetchImpl, sleep: noSleep }), { fetchImpl });
  const list = await features.hairTemplates();
  assert.deepEqual(list.map((t) => [t.id, t.keepsColor]), [['a', true], ['b', false]]);
});

async function withServer(app, fn) {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.close();
  }
}

test('API: demo upload -> analyze round trip, validation and access code', async () => {
  const app = createApp({ features: createDemoFeatures(), accessCode: 'letmein', logger: {} });
  await withServer(app, async (base) => {
    const status = await (await fetch(`${base}/api/status`)).json();
    assert.deepEqual(status, { mode: 'demo', accessCodeRequired: true });

    // Free catalogue routes work without the code; anything that can spend units needs it.
    assert.equal((await fetch(`${base}/api/hair/templates`)).status, 200);
    assert.equal((await fetch(`${base}/api/units`)).status, 401);

    const h = { 'x-access-code': 'letmein' };
    const bad = await fetch(`${base}/api/upload`, { method: 'POST', headers: { ...h, 'content-type': 'image/jpeg' }, body: Buffer.from('definitely not a jpeg file') });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error.code, 'NotAnImage');

    const up = await (await fetch(`${base}/api/upload`, { method: 'POST', headers: { ...h, 'content-type': 'image/jpeg' }, body: jpeg(1080, 1440) })).json();
    assert.equal(up.skinTier, 'hd');
    assert.match(up.fileId, /^demo_/);

    const res = await fetch(`${base}/api/skin/analyze`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ fileId: up.fileId, tier: 'hd' }) });
    const out = await res.json();
    assert.equal(out.demo, true);
    assert.equal(Object.keys(out.scores).length, 8);

    const ref = await fetch(`${base}/api/hair/try-on`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ fileId: up.fileId, refUrl: 'http://localhost/x.jpg' }) });
    assert.equal(ref.status, 400);
    assert.equal((await ref.json()).error.fix, 'ref');

    const malformed = await fetch(`${base}/api/print`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: '{nope' });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error.code, 'BadRequest');
  });
});

test('API: unit budgets per IP and per server, refunded when a task fails', async () => {
  const features = { ...createDemoFeatures(), mode: 'live' };
  const app = createApp({ features, perIpDailyUnits: 46, dailyUnitBudget: 0, logger: {} });
  await withServer(app, async (base) => {
    const up = await (await fetch(`${base}/api/upload`, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: jpeg(800, 1000) })).json();
    const post = (p, b) => fetch(`${base}/api${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
    assert.equal((await post('/skin/analyze', {})).status, 400); // validation error: refunded
    assert.equal((await post('/print', { fileId: up.fileId })).status, 200); // 30 units
    assert.equal((await post('/skin/analyze', { fileId: up.fileId, tier: 'hd' })).status, 200); // +16 = 46
    const over = await post('/print', { fileId: up.fileId });
    assert.equal(over.status, 429);
    assert.equal((await over.json()).error.code, 'DailyLimit');
  });
  const shared = createApp({ features, perIpDailyUnits: 0, dailyUnitBudget: 31, logger: {} });
  await withServer(shared, async (base) => {
    const post = () => fetch(`${base}/api/print`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fileId: 'x' }) });
    assert.equal((await post()).status, 200);
    const r = await post();
    assert.equal(r.status, 429);
    assert.equal((await r.json()).error.code, 'DemoBudget');
  });
});

test('API: security headers, and CSP only when enabled', async () => {
  await withServer(createApp({ features: createDemoFeatures(), logger: {}, csp: true }), async (base) => {
    const r = await fetch(`${base}/api/status`);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  });
  await withServer(createApp({ features: createDemoFeatures(), logger: {} }), async (base) => {
    assert.equal((await fetch(`${base}/api/status`)).headers.get('content-security-policy'), null);
  });
});

test('API: shop wig links are checked before any units are spent', async () => {
  let uploaded = 0;
  const demo = createDemoFeatures();
  const features = { ...demo, mode: 'live', upload: async (b, i) => ((uploaded += 1), demo.upload(b, i)), hairTryOn: async (o) => ({ image: 'x', body: o }) };
  const big = { buf: jpeg(2048, 2048), info: { type: 'image/jpeg', ext: 'jpg', width: 2048, height: 2048 } };
  const refFetch = async (url, { maxLongSide }) => {
    if (Math.max(big.info.width, big.info.height) > maxLongSide) throw new RefImageError('error_exceed_max_image_size', 'too big');
    return big;
  };
  await withServer(createApp({ features, refFetch, logger: {} }), async (base) => {
    const r = await fetch(`${base}/api/hair/try-on`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fileId: 'F', refUrl: 'https://shop.example/wig.jpg' }) });
    assert.equal(r.status, 400);
    const e = (await r.json()).error;
    assert.equal(e.fix, 'ref');
    assert.equal(e.code, 'error_exceed_max_image_size');
    assert.equal(uploaded, 0);
  });
});

test('API: hat try-on needs a styling choice and a product photo', async () => {
  await withServer(createApp({ features: createDemoFeatures(), logger: {} }), async (base) => {
    const post = (b) => fetch(`${base}/api/hat/try-on`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
    assert.equal((await (await post({ fileId: 'F', refFileId: 'R' })).json()).error.code, 'MissingGender');
    assert.equal((await (await post({ fileId: 'F', gender: 'female' })).json()).error.code, 'MissingStyle');
    const ok = await (await post({ fileId: 'F', refFileId: 'R', gender: 'female' })).json();
    assert.equal(ok.demo, true);
  });
});

test('API: brow try-on forwards lashes, under-eye and lips', async () => {
  const demo = createDemoFeatures();
  let got;
  const features = { ...demo, browTryOn: async (o) => ((got = o), { image: 'x' }) };
  await withServer(createApp({ features, logger: {} }), async (base) => {
    const extras = { lashes: { style: 'Natural3' }, underEye: { color: '#b98a6e' }, lips: { color: '#a85e5e' } };
    const r = await fetch(`${base}/api/brows/try-on`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fileId: 'F', pattern: 'SoftArch1', ...extras }) });
    assert.equal(r.status, 200);
    assert.deepEqual({ lashes: got.lashes, underEye: got.underEye, lips: got.lips }, extras);
  });
});

test('demo file store stays under its byte cap', async () => {
  const demo = createDemoFeatures();
  const info = { type: 'image/jpeg', ext: 'jpg', width: 800, height: 1000 };
  const ids = [];
  for (let i = 0; i < 12; i++) ids.push((await demo.upload(Buffer.alloc(10 * 1024 * 1024, i), info)).fileId);
  assert.ok(demo.storedBytes() <= MAX_DEMO_BYTES);
  assert.ok((await demo.hairTryOn({ fileId: ids[11] })).image, 'newest photo is kept');
  assert.equal((await demo.hairTryOn({ fileId: ids[0] })).image, null, 'oldest photo was evicted');
});

test('only public https reference URLs are accepted', () => {
  assert.ok(isPublicHttpsUrl('https://shop.example.com/wig.jpg'));
  assert.ok(!isPublicHttpsUrl('http://shop.example.com/wig.jpg'));
  assert.ok(!isPublicHttpsUrl('https://localhost/wig.jpg'));
  assert.ok(!isPublicHttpsUrl('https://192.168.1.2/wig.jpg'));
  assert.ok(!isPublicHttpsUrl('not a url'));
});

test('reference links: private hosts, redirects to them, and oversize photos are refused', async () => {
  assert.ok(isPrivateAddress('10.1.2.3') && isPrivateAddress('169.254.169.254') && isPrivateAddress('::1') && isPrivateAddress('::ffff:127.0.0.1'));
  assert.ok(!isPrivateAddress('93.184.216.34'));
  const lookup = async (host) => (host === 'internal.example' ? [{ address: '10.0.0.5' }] : [{ address: '93.184.216.34' }]);
  const img = jpeg(2048, 1536);
  const fetchImpl = async (url) => {
    if (url.includes('/redirect')) return new Response(null, { status: 302, headers: { location: 'https://internal.example/x.jpg' } });
    return new Response(img, { status: 200, headers: { 'content-type': 'image/jpeg' } });
  };
  await assert.rejects(fetchRefImage('https://internal.example/x.jpg', { fetchImpl, lookup }), (e) => e.code === 'InvalidRefUrl');
  await assert.rejects(fetchRefImage('https://shop.example/redirect', { fetchImpl, lookup }), (e) => e.code === 'InvalidRefUrl');
  await assert.rejects(fetchRefImage('https://shop.example/wig.jpg', { fetchImpl, lookup, maxLongSide: 1024 }), (e) => e.code === 'error_exceed_max_image_size');
  const ok = await fetchRefImage('https://shop.example/wig.jpg', { fetchImpl, lookup });
  assert.equal(ok.info.width, 2048);
});

test('reference links: a chunked body is capped while streaming, and wig links must be JPEG', async () => {
  const lookup = async () => [{ address: '93.184.216.34' }];
  let cancelled = false;
  const endless = () =>
    new Response(
      new ReadableStream({
        pull(c) {
          c.enqueue(new Uint8Array(1024 * 1024));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { status: 200 },
    );
  await assert.rejects(fetchRefImage('https://shop.example/huge', { fetchImpl: async () => endless(), lookup }), (e) => e.code === 'exceed_max_filesize');
  assert.ok(cancelled, 'the oversize body is cancelled');

  const png = Buffer.alloc(33);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 0);
  png.writeUInt32BE(800, 16);
  png.writeUInt32BE(800, 20);
  const fetchPng = async () => new Response(png, { status: 200 });
  await assert.rejects(fetchRefImage('https://shop.example/wig.png', { fetchImpl: fetchPng, lookup, types: ['image/jpeg'] }), (e) => e.code === 'error_decode_image');
  assert.equal((await fetchRefImage('https://shop.example/hat.png', { fetchImpl: fetchPng, lookup })).info.type, 'image/png');
});

test('a task that may still be billed is not refunded', async () => {
  const fail = (billed) => async () => {
    const e = new YouCamError('slow down', 'RateLimitExceeded', 429);
    if (billed) e.billed = true;
    throw e;
  };
  const post = (base) => fetch(`${base}/api/print`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fileId: 'F' }) });
  const demo = createDemoFeatures();
  await withServer(createApp({ features: { ...demo, mode: 'live', print: fail(false) }, perIpDailyUnits: 30, logger: {} }), async (base) => {
    assert.equal((await post(base)).status, 429);
    assert.equal((await (await post(base)).json()).error.code, 'RateLimitExceeded', 'refunded: the second try reaches YouCam');
  });
  await withServer(createApp({ features: { ...demo, mode: 'live', print: fail(true) }, perIpDailyUnits: 30, logger: {} }), async (base) => {
    assert.equal((await post(base)).status, 429);
    assert.equal((await (await post(base)).json()).error.code, 'DailyLimit', 'billed: the units stay spent');
  });

  // The client marks a poll it gives up on as billed.
  const { fetchImpl } = fakeYouCam([
    ['POST', /task\/hat$/, () => ({ status: 200, data: { task_id: 'T' } })],
    ['GET', /task\/hat\/T$/, () => new Response('{}', { status: 400 })],
  ]);
  const client = createYouCamClient({ apiKey: 'k', fetchImpl, sleep: noSleep });
  await assert.rejects(client.runTask('hat', {}), (e) => e.billed === true);
});

test('try-on errors about the portrait are not blamed on the product photo', async () => {
  const fail = (code) => async () => {
    throw new YouCamError(code, code, 422);
  };
  const demo = createDemoFeatures();
  const run = async (route, code, body) => {
    const features = { ...demo, mode: 'live', hairTryOn: fail(code), hatTryOn: fail(code) };
    let error;
    await withServer(createApp({ features, logger: {} }), async (base) => {
      const r = await fetch(`${base}/api/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fileId: 'F', refFileId: 'R', ...body }) });
      error = (await r.json()).error;
    });
    return error;
  };
  assert.equal((await run('hat/try-on', 'error_no_face', { gender: 'female' })).fix, 'photo');
  assert.equal((await run('hat/try-on', 'error_src_face_too_small', { gender: 'female' })).fix, 'photo');
  assert.equal((await run('hair/try-on', 'error_face_pose')).fix, 'photo');
  assert.equal((await run('hair/try-on', 'error_no_shoulder')).fix, 'photo');
  const ambiguous = await run('hair/try-on', 'error_no_face');
  assert.equal(ambiguous.fix, 'ref');
  assert.match(ambiguous.message, /your portrait or in the wig photo/);
});

test('rate-limited polls keep backing off until the deadline instead of giving up', async () => {
  let polls = 0;
  const limited = () => new Response(JSON.stringify({ status: 429, error: 'Too many requests' }), { status: 429 });
  const { fetchImpl } = fakeYouCam([
    ['POST', /task\/hat$/, () => ({ status: 200, data: { task_id: 'R' } })],
    ['GET', /task\/hat\/R$/, () => (++polls <= 7 ? limited() : { status: 200, data: { task_status: 'success', results: { url: 'https://x/y.jpg' } } })],
  ]);
  const client = createYouCamClient({ apiKey: 'k', fetchImpl, sleep: noSleep });
  assert.equal((await client.runTask('hat', {})).url, 'https://x/y.jpg');

  const always = fakeYouCam([
    ['POST', /task\/hat$/, () => ({ status: 200, data: { task_id: 'R' } })],
    ['GET', /task\/hat\/R$/, limited],
  ]);
  const slow = createYouCamClient({ apiKey: 'k', fetchImpl: always.fetchImpl, sleep: noSleep, pollTimeoutMs: 30 });
  await assert.rejects(slow.runTask('hat', {}), (e) => e.code === 'RateLimitExceeded' && e.billed === true);
});

test('a print with one failed half keeps the other, says why, and refunds the failed half', async () => {
  const { fetchImpl } = fakeYouCam([
    ['POST', /task\/skin-tone-analysis$/, () => ({ status: 200, data: { task_id: 'TONE' } })],
    ['GET', /task\/skin-tone-analysis\/TONE$/, () => ({ status: 200, data: { task_status: 'error', error: 'error_pose' } })],
    ['POST', /task\/face-attr-analysis$/, () => ({ status: 200, data: { task_id: 'FACE' } })],
    ['GET', /task\/face-attr-analysis\/FACE$/, () => ({ status: 200, data: { task_status: 'success', results: { faceshape: 'Oval', eyebrow: { left_shape: 'Straight' } } } })],
  ]);
  const live = createLiveFeatures(createYouCamClient({ apiKey: 'k', fetchImpl, sleep: noSleep }), { fetchImpl });
  const out = await live.print({ fileId: 'F' });
  assert.equal(out.colors, null);
  assert.equal(out.face.faceShape, 'Oval');
  assert.equal(out.partial, true);
  assert.equal(out.errors.colors.code, 'error_pose');
  assert.equal(out.errors.colors.fix, 'photo');
  assert.equal(out.errors.face, null);

  // The route refunds the 20 skin-tone units: two prints fit in a 40-unit allowance.
  const features = { ...createDemoFeatures(), mode: 'live', print: () => live.print({ fileId: 'F' }) };
  await withServer(createApp({ features, perIpDailyUnits: 40, logger: {} }), async (base) => {
    const post = () => fetch(`${base}/api/print`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fileId: 'F' }) });
    const first = await (await post()).json();
    assert.equal(first.errors.colors.code, 'error_pose');
    assert.equal('billed' in first.errors.colors, false);
    assert.equal((await post()).status, 200);
    assert.equal((await post()).status, 429);
  });
});

test('engine errors that could be either photo name both, and internal errors are not blamed on a photo', async () => {
  const fail = (code) => async () => {
    throw new YouCamError(code, code, 422);
  };
  const run = async (route, code, body = {}) => {
    const features = { ...createDemoFeatures(), mode: 'live', hairTryOn: fail(code), hatTryOn: fail(code) };
    let error;
    await withServer(createApp({ features, logger: {} }), async (base) => {
      const r = await fetch(`${base}/api/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fileId: 'F', refFileId: 'R', gender: 'female', ...body }) });
      error = (await r.json()).error;
    });
    return error;
  };
  const pose = await run('hat/try-on', 'error_pose');
  assert.equal(pose.fix, 'ref');
  assert.match(pose.message, /your portrait or the head-covering photo/);
  assert.match((await run('hat/try-on', 'error_nsfw_content_detected')).message, /safety filter/);
  assert.match((await run('hair/try-on', 'error_download_image')).message, /your portrait or the wig photo/);
  const internal = await run('hair/try-on', 'unknown_internal_error');
  assert.equal(internal.fix, 'service');
  assert.equal(explain('exceed_nsfw_retry_limits').fix, 'service');
  assert.doesNotMatch(explain('error_download_image').message, /link/);
});

test('hair try-on only accepts string style and photo ids', async () => {
  let called = 0;
  const features = { ...createDemoFeatures(), hairTryOn: async () => ((called += 1), { image: 'x' }) };
  await withServer(createApp({ features, logger: {} }), async (base) => {
    const post = (b) => fetch(`${base}/api/hair/try-on`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fileId: 'F', ...b }) });
    assert.equal((await (await post({ templateId: {} })).json()).error.code, 'MissingStyle');
    assert.equal((await (await post({ refFileId: 123 })).json()).error.code, 'MissingStyle');
    assert.equal(called, 0);
    assert.equal((await post({ templateId: 'demo_bob' })).status, 200);
  });
});

test('unit balance reads are shared for a few seconds', async () => {
  let reads = 0;
  const features = { ...createDemoFeatures(), units: async () => ((reads += 1), 42) };
  await withServer(createApp({ features, logger: {} }), async (base) => {
    const all = await Promise.all([1, 2, 3].map(() => fetch(`${base}/api/units`).then((r) => r.json())));
    assert.deepEqual(all.map((x) => x.units), [42, 42, 42]);
    await fetch(`${base}/api/units`);
    assert.equal(reads, 1);
  });
});
