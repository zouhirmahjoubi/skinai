import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgent, createDemoAgent, urgentFlags, lintReply } from '../server/agent.js';
import { createYouCamMcp } from '../server/youcam-mcp.js';
import { createDemoFeatures } from '../server/features.js';

test('red-flag words in a message are caught, everyday ones are not', () => {
  assert.equal(urgentFlags('I have a fever of 38.5 C and my lips are swollen').length, 2);
  assert.equal(urgentFlags('the rash on my arms is blistering').length, 1);
  assert.equal(urgentFlags('my skin feels dry and tight').length, 0);
  assert.equal(urgentFlags('which moisturiser is gentle?').length, 0);
});

test('replies lose dashes and get a caution line when they make a medical claim', () => {
  const plain = lintReply('Try the oat cream — it is fragrance free. Use it 2–3 times a day.');
  assert.equal(plain.text, 'Try the oat cream, it is fragrance free. Use it 2 to 3 times a day.');
  assert.equal(plain.flagged, false);
  const claim = lintReply('This will heal the rash.');
  assert.equal(claim.flagged, true);
  assert.match(claim.text, /check this with your care team/);
});

// Fake KIE: the Anthropic route fails, the Responses route asks for one tool, then answers.
function fakeKie() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    if (url.endsWith('/anthropic/v1/messages')) return new Response(JSON.stringify({ type: 'error', error: { message: 'Internal error' } }), { status: 500 });
    const answered = body.input.some((i) => i.type === 'function_call_output');
    const response = answered
      ? { output: [{ type: 'message', content: [{ type: 'output_text', text: 'The **Oat Calm Cream** is rated good for you — fragrance free.' }] }] }
      : { output: [{ type: 'function_call', call_id: 'c1', name: 'find_products', arguments: JSON.stringify({ need: 'moisturise', limit: 2 }) }] };
    // KIE answers the Responses API as an event stream.
    const sse = `event: response.created\ndata: {"type":"response.created"}\n\nevent: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response })}\n\n`;
    return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  return { calls, fetchImpl };
}

test('the companion falls back from Claude to the Responses model and grounds answers in tools', async () => {
  const { calls, fetchImpl } = fakeKie();
  const agent = createAgent({ apiKey: 'k', features: createDemoFeatures(), fetchImpl });
  const context = { treatments: ['egfr'], phase: { phase: 'during', week: 2 }, notes: [{ id: 'egfr_rash', level: 'call', title: 'Likely the EGFR rash', avoid: ['benzoyl_peroxide'], needs: ['humectant'] }] };
  const out = await agent.respond({ messages: [{ role: 'user', content: 'What moisturiser can I use?' }], context });
  assert.deepEqual(out.tools, ['find_products']);
  assert.equal(out.model, 'gpt-6-luna');
  assert.equal(out.reply, 'The **Oat Calm Cream** is rated good for you, fragrance free.');
  const toolOutput = JSON.parse(calls.at(-1).body.input.find((i) => i.type === 'function_call_output').output);
  assert.equal(toolOutput.products.length, 2);
  assert.ok(toolOutput.products.every((p) => p.verdict === 'good'), 'ranked by the shelf rules, best first');
  assert.ok(!JSON.stringify(calls[0].body).includes('dataUrl'), 'no photos in the request');
});

test('a proposed look becomes a plan with unit costs, and nothing runs', async () => {
  let round = 0;
  const fetchImpl = async (url) => {
    round += 1;
    const content = round === 1
      ? [{ type: 'tool_use', id: 't1', name: 'propose_look', input: { title: 'Wedding', steps: [{ kind: 'wig', template_id: 'all_short_feather_cut', recolour: true, why: 'Short and easy' }, { kind: 'brows', pattern: 'NotAPattern', lips: 'mine', why: 'Your own brows' }, { kind: 'wig', why: 'no template' }] } }]
      : [{ type: 'text', text: 'Here is a plan.' }];
    assert.match(url, /anthropic/);
    return new Response(JSON.stringify({ content, stop_reason: round === 1 ? 'tool_use' : 'end_turn' }), { status: 200 });
  };
  const agent = createAgent({ apiKey: 'k', features: createDemoFeatures(), fetchImpl });
  const out = await agent.respond({ messages: [{ role: 'user', content: 'Plan a wedding look' }], context: { print: { browShape: 'Straight', hair: 'Black' } } });
  assert.equal(out.model, 'claude-sonnet-5-5');
  assert.equal(out.plan.steps.length, 2, 'a wig step without a template is dropped');
  assert.equal(out.plan.steps[0].units, 3, 'wig 2 + recolour 1');
  assert.equal(out.plan.steps[1].pattern, 'Straight1', 'an unknown pattern falls back to the print shape');
  assert.equal(out.plan.units, 4);
});

test('without a model key the demo companion still escalates red flags', async () => {
  const out = await createDemoAgent().respond({ messages: [{ role: 'user', content: 'I have a temperature of 38.4' }] });
  assert.equal(out.urgent.length, 1);
  assert.match(out.reply, /care team now/);
});

test('API: new try-on routes validate before spending, and the companion has its own daily cap', async () => {
  const { createApp } = await import('../server/app.js');
  const app = createApp({ features: { ...createDemoFeatures(), mode: 'live' }, agent: createDemoAgent(), perIpDailyChats: 2, logger: {} });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const post = (path, json) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(json) });
  try {
    assert.equal((await (await post('/hair/color', { fileId: 'F', family: 'Purple' })).json()).error.code, 'MissingShade');
    assert.equal((await (await post('/earrings/try-on', { fileId: 'F' })).json()).error.code, 'MissingStyle');
    const ok = await post('/hair/color', { fileId: 'F', family: 'Grey/White' });
    assert.equal(ok.status, 200);
    const ask = (q) => post('/agent', { messages: [{ role: 'user', content: q }], context: {} });
    assert.equal((await ask('hello')).status, 200);
    assert.equal((await ask('hello again')).status, 200);
    assert.equal((await ask('one more')).status, 429, 'a third question passes the per-IP cap');
  } finally {
    server.close();
  }
});

test('MCP: tool results come from the SSE stream, failed tasks carry their engine code', async () => {
  const sent = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    sent.push({ url, method: body.method, session: init.headers['mcp-session-id'] });
    const headers = { 'content-type': 'text/event-stream', 'mcp-session-id': 'S1' };
    if (body.method === 'initialize') return new Response(`data: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18' } })}\n\n`, { headers });
    if (body.method === 'notifications/initialized') return new Response('', { status: 202, headers });
    const tool = body.params.name;
    const text = tool === 'AI-Hair-Density-Detection'
      ? JSON.stringify({ error_message: 'YcoApiException - AI Hair Density Detection Polling failed: error_face_angle_invalid. The face angle is not within the supported range.' })
      : JSON.stringify({ status: 200, data: { task_status: 'success', task_id: 'T9', results: { url: 'https://cdn.example/r.jpg' } } });
    const progress = { jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info', data: { msg: 'Task Created.' } } };
    const final = { jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text }] } };
    return new Response(`data: ${JSON.stringify(progress)}\n\ndata: ${JSON.stringify(final)}\n\n`, { headers });
  };
  const mcp = createYouCamMcp({ apiKey: 'k', fetchImpl });
  const run = await mcp.runTool('beauty', 'AI-Hair-Color-Virtual-Try-On', { src_file_id: 'F', palettes: [{ color: '#1f1b19' }] });
  assert.deepEqual(run, { taskId: 'T9', results: { url: 'https://cdn.example/r.jpg' } });
  await assert.rejects(mcp.runTool('beauty', 'AI-Hair-Density-Detection', { src_file_id: 'F' }), (err) => err.code === 'error_face_angle_invalid');
  assert.equal(sent.filter((s) => s.method === 'initialize').length, 1, 'one session per server');
  assert.ok(sent.filter((s) => s.method === 'tools/call').every((s) => s.session === 'S1'));
});
