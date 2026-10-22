import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createYouCamClient } from '../server/youcam.js';
import { createLiveFeatures, createDemoFeatures } from '../server/features.js';
import { createApp, isPublicHttpsUrl } from '../server/app.js';
import { sniffImage, skinTierFor } from '../server/image-info.js';
import { explain } from '../server/errors.js';

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
  assert.match(hair.image, /^data:image\/jpeg;base64,/);
  await features.browTryOn({ fileId: 'F', pattern: 'SoftArch1', color: '#33241d', intensity: 55 });
  assert.equal(bodies.brow.version, '1.0');
  assert.equal(bodies.brow.effects[0].skinSmoothStrength, 0);
  assert.equal(bodies.brow.effects[1].pattern.name, 'SoftArch1');
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

    const denied = await fetch(`${base}/api/hair/templates`);
    assert.equal(denied.status, 401);

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
  });
});

test('API: per-IP daily limit protects units in live mode', async () => {
  const features = { ...createDemoFeatures(), mode: 'live' };
  const app = createApp({ features, perIpDailyLimit: 1, logger: {} });
  await withServer(app, async (base) => {
    const up = await (await fetch(`${base}/api/upload`, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: jpeg(800, 1000) })).json();
    const call = () => fetch(`${base}/api/print`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fileId: up.fileId }) });
    assert.equal((await call()).status, 200);
    assert.equal((await call()).status, 429);
  });
});

test('only public https reference URLs are accepted', () => {
  assert.ok(isPublicHttpsUrl('https://shop.example.com/wig.jpg'));
  assert.ok(!isPublicHttpsUrl('http://shop.example.com/wig.jpg'));
  assert.ok(!isPublicHttpsUrl('https://localhost/wig.jpg'));
  assert.ok(!isPublicHttpsUrl('https://192.168.1.2/wig.jpg'));
  assert.ok(!isPublicHttpsUrl('not a url'));
});
