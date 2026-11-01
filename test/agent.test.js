import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createAgent, createRulesAgent, urgentFlags, lintReply } from '../server/agent.js';
import { createYouCamMcp } from '../server/youcam-mcp.js';
import { createDemoFeatures, createLiveFeatures } from '../server/features.js';
import { createApp } from '../server/app.js';
import { YouCamError } from '../server/errors.js';

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

// Fake Claude route: answers each request from a list of content blocks, recording the bodies.
function fakeClaude(rounds) {
  const bodies = [];
  const fetchImpl = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    assert.match(url, /anthropic/);
    const content = rounds[Math.min(bodies.length - 1, rounds.length - 1)];
    return new Response(JSON.stringify({ content }), { status: 200 });
  };
  return { bodies, fetchImpl };
}
const toolUse = (name, input = {}, id = 't1') => ({ type: 'tool_use', id, name, input });
const says = (text) => [{ type: 'text', text }];
const toolResults = (body) => body.messages.at(-1).content;
const asked = (content) => [{ role: 'user', content }];

const EGFR = { treatments: ['egfr'], phase: { phase: 'during', week: 2 }, notes: [{ id: 'egfr_rash', level: 'call', title: 'Likely the EGFR rash', avoid: ['benzoyl_peroxide'], needs: ['humectant'] }] };

test('the companion falls back from Claude to the Responses model and grounds answers in tools', async () => {
  const { calls, fetchImpl } = fakeKie();
  const agent = createAgent({ apiKey: 'k', features: createDemoFeatures(), fetchImpl });
  const out = await agent.respond({ messages: asked('What moisturiser can I use?'), context: EGFR });
  assert.deepEqual(out.tools, ['find_products']);
  assert.equal(out.model, 'gpt-6-luna');
  assert.equal(out.rulesOnly, undefined);
  assert.equal(out.reply, 'The **Oat Calm Cream** is rated good for you, fragrance free.');
  const toolOutput = JSON.parse(calls.at(-1).body.input.find((i) => i.type === 'function_call_output').output);
  assert.equal(toolOutput.products.length, 2);
  assert.ok(toolOutput.products.every((p) => p.verdict === 'good'), 'ranked by the shelf rules, best first');
  assert.ok(!JSON.stringify(calls[0].body).includes('dataUrl'), 'no photos in the request');
});

test('when both KIE routes fail, the answer comes from the rules and says so', async () => {
  const urls = [];
  const warned = [];
  const down = async (url) => {
    urls.push(url);
    return new Response(JSON.stringify({ error: { message: 'down' } }), { status: 500 });
  };
  const agent = createAgent({ apiKey: 'k', features: createDemoFeatures(), fetchImpl: down, logger: { warn: (m) => warned.push(m) } });
  const out = await agent.respond({ messages: asked('What moisturiser can I use?'), context: EGFR });
  assert.equal(urls.length, 2, 'both routes were tried');
  assert.equal(out.rulesOnly, true);
  assert.equal(out.model, 'rules');
  assert.deepEqual(out.tools, ['find_products']);
  assert.match(out.reply, /Shelfside Gentle/);
  assert.equal(warned.length, 1, 'the operator still hears about it');

  const offline = createAgent({ apiKey: 'k', features: createDemoFeatures(), logger: {}, fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  assert.equal((await offline.respond({ messages: asked('hello') })).rulesOnly, true);
  await assert.rejects(offline.respond({ messages: [] }), (e) => e.code === 'EmptyQuestion');
  await assert.rejects(offline.respond({ messages: 'not a list' }), (e) => e.code === 'EmptyQuestion');
  await assert.rejects(offline.respond({ messages: [...asked('hi'), { role: 'assistant', content: 'hello' }] }), (e) => e.code === 'EmptyQuestion');
});

test('a route that fails mid-turn also ends in the rules, keeping what the tools already did', async () => {
  let round = 0;
  const fetchImpl = async () => {
    round += 1;
    if (round === 1) return new Response(JSON.stringify({ content: [toolUse('remember', { note: 'Prefers short styles' })] }), { status: 200 });
    return new Response('{}', { status: 500 });
  };
  const out = await createAgent({ apiKey: 'k', features: createDemoFeatures(), fetchImpl, logger: {} }).respond({ messages: asked('I like short styles') });
  assert.equal(out.rulesOnly, true);
  assert.deepEqual(out.remember, ['Prefers short styles']);
  assert.equal(out.tools[0], 'remember');
});

test('a proposed look becomes a plan with unit costs, and nothing runs', async () => {
  const { fetchImpl } = fakeClaude([
    [toolUse('propose_look', { title: 'Wedding', steps: [{ kind: 'wig', template_id: 'demo_pixie', recolour: true, why: 'Short and easy' }, { kind: 'brows', pattern: 'NotAPattern', lips: 'mine', why: 'Your own brows' }, { kind: 'wig', why: 'no template' }] })],
    says('Here is a plan.'),
  ]);
  const agent = createAgent({ apiKey: 'k', features: createDemoFeatures(), fetchImpl });
  const out = await agent.respond({ messages: asked('Plan a wedding look'), context: { print: { browShape: 'Straight', hair: 'Black' } } });
  assert.equal(out.model, 'claude-sonnet-5-5');
  assert.equal(out.plan.steps.length, 2, 'a wig step without a template is dropped');
  assert.equal(out.plan.steps[0].title, 'Soft pixie', 'the step carries the style title');
  assert.equal(out.plan.steps[0].units, 3, 'wig 2 + recolour 1');
  assert.equal(out.plan.steps[1].pattern, 'Straight1', 'an unknown pattern falls back to the print shape');
  assert.equal(out.plan.units, 4);
});

test('propose_look drops invented templates and other kinds of step', async () => {
  const { bodies, fetchImpl } = fakeClaude([
    [toolUse('propose_look', { title: 'Look', steps: [{ kind: 'wig', template_id: 'all_short_feather_cut', why: 'invented' }, { kind: 'hair_color', why: 'not a step' }, { kind: 'constructor', why: 'no' }, { kind: 'wig', template_id: 'demo_bob', why: 'listed' }] })],
    says('Done.'),
  ]);
  const out = await createAgent({ apiKey: 'k', features: createDemoFeatures(), fetchImpl }).respond({ messages: asked('Plan a look') });
  assert.deepEqual(out.plan.steps.map((s) => [s.kind, s.templateId, s.title]), [['wig', 'demo_bob', 'Chin-length bob']]);
  assert.equal(JSON.parse(toolResults(bodies[1])[0].content).dropped, 3);

  // Only invented styles: no plan at all, and the model is told why.
  const none = fakeClaude([[toolUse('propose_look', { title: 'Look', steps: [{ kind: 'wig', template_id: 'made_up', why: 'x' }] })], says('Sorry.')]);
  const empty = await createAgent({ apiKey: 'k', features: createDemoFeatures(), fetchImpl: none.fetchImpl }).respond({ messages: asked('Plan a look') });
  assert.equal(empty.plan, null);
  assert.match(toolResults(none.bodies[1])[0].content, /No runnable steps/);
});

test('recolour needs a hair family the app knows, and units follow', async () => {
  const planFor = async (print) => {
    const { fetchImpl } = fakeClaude([[toolUse('propose_look', { title: 'Look', steps: [{ kind: 'wig', template_id: 'demo_pixie', recolour: true, why: 'x' }] })], says('Done.')]);
    return (await createAgent({ apiKey: 'k', features: createDemoFeatures(), fetchImpl }).respond({ messages: asked('Plan a look'), context: { print } })).plan;
  };
  for (const print of [undefined, {}, { hair: 'Teal' }, { hair: 'constructor' }]) {
    const plan = await planFor(print);
    assert.equal(plan.steps[0].recolour, false, JSON.stringify(print));
    assert.equal(plan.units, 2);
  }
  const known = await planFor({ hair: 'Grey/White' });
  assert.equal(known.steps[0].recolour, true);
  assert.equal(known.units, 3);
});

test('at most 5 tool calls run per round; the rest are answered with an error', async () => {
  const seven = Array.from({ length: 7 }, (_, i) => toolUse('red_flags', {}, `t${i}`));
  const { bodies, fetchImpl } = fakeClaude([seven, says('Please call your team.')]);
  const out = await createAgent({ apiKey: 'k', features: createDemoFeatures(), fetchImpl }).respond({ messages: asked('hello') });
  assert.equal(out.tools.length, 5);
  const results = toolResults(bodies[1]);
  assert.equal(results.length, 7, 'every call still gets an answer');
  assert.ok(results.slice(0, 5).every((r) => JSON.parse(r.content).red_flags));
  assert.ok(results.slice(5).every((r) => JSON.parse(r.content).error));
  assert.equal(out.reply, 'Please call your team.');
});

test('the tool loop stops after 4 rounds, or sooner once the conversation is too long', async () => {
  const { bodies, fetchImpl } = fakeClaude([[...says('Let me check.'), toolUse('red_flags')]]);
  const out = await createAgent({ apiKey: 'k', features: createDemoFeatures(), fetchImpl }).respond({ messages: asked('hello') });
  assert.equal(bodies.length, 4);
  assert.equal(out.rulesOnly, true, 'a model that never finishes gets the rules answer, not its preamble');
  assert.doesNotMatch(out.reply, /Let me check/);

  // Each round adds about 40k characters (5 capped tool outputs of 8000).
  const long = 'x'.repeat(400);
  const context = { latest: { date: '2026-10-30' }, notes: Array.from({ length: 8 }, () => ({ title: long, subtitle: long, body: long, careTeam: long, confirm: long })) };
  const big = fakeClaude([Array.from({ length: 5 }, (_, i) => toolUse('skin_status', {}, `t${i}`))]);
  await createAgent({ apiKey: 'k', features: createDemoFeatures(), fetchImpl: big.fetchImpl }).respond({ messages: asked('hello'), context });
  assert.equal(big.bodies.length, 2);
});

test('a plan made before the model stops still stands', async () => {
  const { fetchImpl } = fakeClaude([[toolUse('propose_look', { title: 'Look', steps: [{ kind: 'brows', why: 'x' }] })]]);
  const out = await createAgent({ apiKey: 'k', features: createDemoFeatures(), fetchImpl }).respond({ messages: asked('Plan a look') });
  assert.equal(out.plan.steps[0].kind, 'brows');
  assert.equal(out.rulesOnly, undefined);
  assert.match(out.reply, /Nothing runs until you tap Run/);
});

test('the context drops the name and keeps what the notes say', async () => {
  const { bodies, fetchImpl } = fakeClaude([[toolUse('skin_status')], says('Steady.')]);
  const context = { name: 'Samira Example', latest: { date: '2026-10-30', tier: 'hd' }, notes: [{ id: 'n', level: 'watch', title: 'Calm down 8', subtitle: 'Sub', body: 'Body', careTeam: 'Tell them', confirm: 'Retake', action: 'Not a note field', avoid: ['constructor', 'retinoid'], needs: ['toString'] }, null] };
  await createAgent({ apiKey: 'k', features: createDemoFeatures(), fetchImpl }).respond({ messages: asked('How is my skin?'), context });
  assert.ok(!JSON.stringify(bodies).includes('Samira'), 'health data does not travel with a name');
  const note = JSON.parse(toolResults(bodies[1])[0].content).notes[0];
  assert.deepEqual({ subtitle: note.subtitle, body: note.body, careTeam: note.careTeam, confirm: note.confirm }, { subtitle: 'Sub', body: 'Body', careTeam: 'Tell them', confirm: 'Retake' });
  assert.equal('action' in note, false);
  assert.deepEqual(note.avoid, ['retinoid']);
  assert.deepEqual(note.needs, []);
  assert.equal(JSON.parse(toolResults(bodies[1])[0].content).notes.length, 1);
});

test('urgent flags cover the last two user turns', async () => {
  const { fetchImpl } = fakeClaude([says('Please call your team.')]);
  const agent = createAgent({ apiKey: 'k', features: createDemoFeatures(), fetchImpl });
  const said = (...lines) => lines.flatMap((content) => [{ role: 'user', content }, { role: 'assistant', content: 'OK.' }]).slice(0, -1);
  assert.equal((await agent.respond({ messages: said('I have a fever', 'Which cream is gentle?') })).urgent.length, 1);
  assert.equal((await agent.respond({ messages: said('I have a fever', 'Which cream is gentle?', 'And a sunscreen?') })).urgent.length, 0);
});

test('without a model key the rules companion still escalates red flags', async () => {
  const out = await createRulesAgent().respond({ messages: asked('I have a temperature of 38.4') });
  assert.equal(out.urgent.length, 1);
  assert.match(out.reply, /care team now/);
  assert.equal(out.rulesOnly, true);
  assert.deepEqual(out.tools, ['red_flags']);

  const earlier = await createRulesAgent().respond({ messages: [{ role: 'user', content: 'I have a fever' }, { role: 'assistant', content: 'Call them.' }, ...asked('What moisturiser can I use?')] });
  assert.match(earlier.reply, /care team now/);
  assert.match(earlier.reply, /Shelfside/, 'the new question still gets an answer');
});

test('the rules agent answers a product question with the top two and what to avoid', async () => {
  const agent = createRulesAgent({ features: createDemoFeatures() });
  const out = await agent.respond({ messages: asked('What moisturiser can I use?'), context: EGFR });
  assert.deepEqual(out.tools, ['find_products']);
  assert.equal(out.plan, null);
  assert.equal(out.rulesOnly, true);
  assert.equal((out.reply.match(/I would start with \*\*.+\*\* and \*\*.+\*\*\./g) || []).length, 1, out.reply);
  assert.match(out.reply, /Shelfside Gentle/);
  assert.match(out.reply, /Best to avoid benzoyl peroxide, fragrance/);
  assert.match(out.reply, /leave out \*\*Shelfside Glow Lavender Dream/);

  const need = async (q) => (await agent.respond({ messages: asked(q) })).reply;
  assert.match(await need('Which sunscreen is OK?'), /For a sunscreen, .*Mineral/);
  assert.match(await need('I need a gentle cleanser'), /For a cleanser, /);
  assert.match(await need('Something soothing please, what can I use?'), /For something soothing, /);
  assert.match(await need('What can I use for my spots?'), /For a treatment product, /);
  assert.match(await need('My face feels tight and has spots. What can I use?'), /For a moisturiser, /);
});

test('the rules agent is honest when nothing in the group is a good fit', async () => {
  const out = await createRulesAgent().respond({ messages: asked('What can I use for acne?'), context: { treatments: ['egfr'], notes: [{ title: 'Rash', level: 'call', avoid: ['benzoyl_peroxide', 'bha', 'aha', 'retinoid', 'drying_alcohol'] }] } });
  assert.match(out.reply, /could not find a clear good fit/);
  assert.match(out.reply, /Best to avoid benzoyl peroxide/);
});

test('the rules agent builds a real plan through propose_look', async () => {
  const agent = createRulesAgent({ features: createDemoFeatures() });
  const out = await agent.respond({ messages: asked('Plan a look for a family wedding in a few weeks.'), context: { print: { browShape: 'Straight', hair: 'Brown', faceShape: 'Oval' } } });
  assert.deepEqual(out.tools, ['wig_ideas', 'brow_plan', 'propose_look']);
  assert.equal(out.plan.title, 'Your wedding look');
  assert.deepEqual(out.plan.steps.map((s) => s.kind), ['wig', 'brows']);
  assert.equal(out.plan.steps[0].templateId, 'demo_pixie');
  assert.equal(out.plan.steps[0].title, 'Soft pixie');
  assert.equal(out.plan.steps[0].recolour, true);
  assert.match(out.plan.steps[0].why, /oval face/);
  assert.equal(out.plan.steps[1].pattern, 'Straight1');
  assert.equal(out.plan.units, 4);
  assert.match(out.reply, /\*\*Soft pixie\*\* wig and \*\*Straight\*\* brows/);
  assert.match(out.reply, /4 units, and nothing runs until you tap Run/);

  const plain = await agent.respond({ messages: asked('Which wig should I try?') });
  assert.equal(plain.plan.steps[0].recolour, false, 'no print, no known hair family');
  assert.equal(plain.plan.units, 3);
  assert.equal((await agent.respond({ messages: asked('Plan a long wig') })).plan.steps[0].templateId, 'demo_layers');
  assert.deepEqual((await agent.respond({ messages: asked('Help me with my brows') })).plan.steps.map((s) => s.kind), ['brows']);
  const regrowth = await agent.respond({ messages: asked('How might my hair grow back?') });
  assert.deepEqual(regrowth.plan.steps.map((s) => [s.kind, s.shade]), [['regrowth', 'Grey/White']]);

  // No style list to read: the brows still make a plan.
  const noList = await createRulesAgent().respond({ messages: asked('Plan a look') });
  assert.deepEqual(noList.plan.steps.map((s) => s.kind), ['brows']);
});

test('the rules agent checks pasted lists, gathers care-team questions and reads the latest notes', async () => {
  const agent = createRulesAgent({ features: createDemoFeatures() });
  const pasted = await agent.respond({ messages: asked('Is this cream OK for me? Water, Glycerin, Fragrance, Salicylic Acid'), context: { treatments: ['egfr'], notes: [{ level: 'call', title: 'Rash', avoid: ['bha'] }] } });
  assert.deepEqual(pasted.tools, ['check_ingredients']);
  assert.match(pasted.reply, /Best to leave this one out/);
  assert.match(pasted.reply, /salicylic acid/);
  assert.match(pasted.reply, /It does have hydrators \(glycerin\)/);
  assert.match((await agent.respond({ messages: asked('Water, Glycerin, Panthenol') })).reply, /Nothing in this list stands out/);

  const care = await agent.respond({ messages: asked('What should I ask my care team this week?'), context: { treatments: ['egfr'], phase: { phase: 'during', week: 1 } } });
  assert.deepEqual(care.tools, ['care_team_questions']);
  assert.match(care.reply, /Worth asking your care team:\n\n- Should I start preventive treatment/);
  assert.match((await agent.respond({ messages: asked('What should I ask my doctor?') })).reply, /A good place to start/);

  const status = await agent.respond({
    messages: asked('How is my skin doing?'),
    context: { treatments: ['egfr'], latest: { date: '2026-10-30', tier: 'hd' }, notes: [{ level: 'call', title: 'Clear down 9', subtitle: 'Acne-like rash, common with EGFR inhibitors', body: 'It looks like acne. It is not acne.', careTeam: 'Tell your care team early.' }, { level: 'info', title: 'Different light from your baseline' }] },
  });
  assert.deepEqual(status.tools, ['skin_status']);
  assert.match(status.reply, /\*\*Clear down 9\*\*\. Acne-like rash/);
  assert.match(status.reply, /It looks like acne\.\n/);
  assert.match(status.reply, /Also noted: Different light/);
  assert.match(status.reply, /Tell your care team early/);
  assert.match((await agent.respond({ messages: asked('hello') })).reply, /no skin check-in yet/);
  assert.match((await agent.respond({ messages: asked('How is my skin?'), context: { latest: { date: '2026-10-30' } } })).reply, /nothing in it needs a note/);
  for (const q of ['How does my skin look?', 'What does a dry patch look like?', 'Take a look at my latest check-in']) {
    assert.deepEqual((await agent.respond({ messages: asked(q) })).tools, ['skin_status'], q);
  }
});

test('rules copy never mentions a demo, a server or a model key, and has no dashes', async () => {
  const agent = createRulesAgent({ features: createDemoFeatures() });
  const context = { ...EGFR, latest: { date: '2026-10-30' }, print: { hair: 'Brown', browShape: 'Straight', faceShape: 'Oval' } };
  const questions = ['I have a fever', 'What moisturiser can I use?', 'What can I use for acne?', 'Plan a look for a wedding', 'How might my hair grow back?', 'What should I ask my care team?', 'How is my skin?', 'hello', 'Water, Glycerin, Fragrance, Salicylic Acid'];
  for (const context_ of [context, {}]) {
    for (const q of questions) {
      const { reply, rulesOnly } = await agent.respond({ messages: asked(q), context: context_ });
      assert.equal(rulesOnly, true);
      assert.ok(reply.length > 0 && reply.length < 900, q);
      assert.doesNotMatch(reply, /demo|server|model key|[—–]/i, q);
    }
  }
});

// A running app on a free port: `api(path, json?, headers?)` posts JSON, or gets without it.
async function withApi(options, fn) {
  const server = createApp({ logger: {}, ...options }).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const api = (path, json, headers = {}) => fetch(`${base}${path}`, json === undefined ? { headers } : { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(json) });
  try {
    await fn(api, base);
  } finally {
    server.close();
  }
}
const liveDemo = (extra = {}) => ({ ...createDemoFeatures(), mode: 'live', ...extra });
const failing = (code) => async () => {
  throw new YouCamError(code, code, 422);
};

test('API: new try-on routes validate before spending, and the companion has its own daily cap', async () => {
  await withApi({ features: liveDemo(), agent: createRulesAgent(), perIpDailyChats: 2 }, async (post) => {
    assert.equal((await (await post('/hair/color', { fileId: 'F', family: 'Purple' })).json()).error.code, 'MissingShade');
    assert.equal((await (await post('/earrings/try-on', { fileId: 'F' })).json()).error.code, 'MissingStyle');
    const ok = await post('/hair/color', { fileId: 'F', family: 'Grey/White' });
    assert.equal(ok.status, 200);
    const ask = (q) => post('/agent', { messages: asked(q), context: {} });
    assert.equal((await ask('hello')).status, 200);
    assert.equal((await ask('hello again')).status, 200);
    assert.equal((await ask('one more')).status, 429, 'a third question passes the per-IP cap');
  });
});

test('API: an empty question gets its chat count back, and a model failure answers 200', async () => {
  await withApi({ features: liveDemo(), agent: createRulesAgent(), perIpDailyChats: 1, dailyChatBudget: 1 }, async (post) => {
    for (const body of [{ messages: [] }, { messages: 'nope' }, {}, { messages: asked('   ') }]) {
      const r = await post('/agent', body);
      assert.equal(r.status, 400);
      assert.equal((await r.json()).error.code, 'EmptyQuestion');
    }
    assert.equal((await post('/agent', { messages: asked('hello') })).status, 200, 'the empty ones did not use up the only chat');
    assert.equal((await post('/agent', { messages: asked('again') })).status, 429);
  });
  const agent = createAgent({ apiKey: 'k', features: createDemoFeatures(), logger: {}, fetchImpl: async () => new Response('{}', { status: 500 }) });
  await withApi({ features: liveDemo(), agent }, async (post) => {
    const r = await post('/agent', { messages: asked('hello') });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).rulesOnly, true);
  });
});

test('API: "constructor" and friends are not hair colours', async () => {
  let regrowthHex = 'unset';
  const features = liveDemo({ regrowth: async ({ hex }) => ((regrowthHex = hex), { image: 'x' }) });
  await withApi({ features }, async (post) => {
    for (const family of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const r = await post('/hair/color', { fileId: 'F', family });
      assert.equal(r.status, 400, family);
      assert.equal((await r.json()).error.code, 'MissingShade');
      assert.equal((await post('/hair/regrowth', { fileId: 'F', family })).status, 200);
      assert.equal(regrowthHex, null, family);
    }
    assert.equal((await post('/hair/color', { fileId: 'F', family: 'constructor', hex: '#112233' })).status, 200, 'a real hex still works');
    await post('/hair/regrowth', { fileId: 'F', family: 'Black' });
    assert.equal(regrowthHex, '#1f1b19');
  });
});

test('API: portrait errors are not blamed on the earring photo', async () => {
  const run = async (code) => {
    let error;
    await withApi({ features: liveDemo({ earringTryOn: failing(code) }) }, async (post) => {
      error = (await (await post('/earrings/try-on', { fileId: 'F', refFileId: 'R' })).json()).error;
    });
    return error;
  };
  for (const code of ['error_no_face', 'error_pose', 'error_face_pose', 'error_large_face_angle', 'error_face_angle_invalid', 'error_face_parsing', 'error_src_face_too_small', 'error_face_position_invalid', 'InvalidFileId']) {
    const error = await run(code);
    assert.equal(error.fix, 'photo', code);
    assert.doesNotMatch(error.message, /earring/i, code);
  }
  const either = await run('error_decode_image');
  assert.equal(either.fix, 'ref');
  assert.match(either.message, /your portrait or the earring photo/);
});

test('API: density pose errors ask for a lowered head, not a straight look', async () => {
  const run = async (code) => {
    let out;
    await withApi({ features: liveDemo({ hairDensity: failing(code) }) }, async (post) => {
      const r = await post('/hair/density', { fileId: 'F' });
      out = { status: r.status, ...(await r.json()).error };
    });
    return out;
  };
  for (const code of ['error_face_angle_invalid', 'error_large_face_angle', 'error_pose', 'error_face_pose', 'error_face_not_forward_facing', 'error_face_position_invalid', 'error_face_position_out_of_boundary', 'error_src_face_out_of_bound', 'error_no_face']) {
    const out = await run(code);
    assert.equal(out.message, 'YouCam couldn’t read that angle. Lower your head about 45° so the camera sees your parting, then try again, a little higher or lower if it still won’t read.', code);
    assert.equal(out.fix, 'photo', code);
    assert.equal(out.code, code);
    assert.equal(out.status, 422, 'still a failed task, refunded');
  }
  const dark = await run('error_lighting_dark');
  assert.match(dark.message, /too dark/);
  assert.equal((await run('TaskFailed')).fix, 'service');
});

test('API: /costs sits behind the access code, the free catalogue does not', async () => {
  await withApi({ features: liveDemo(), accessCode: 'letmein' }, async (api) => {
    assert.equal((await api('/costs')).status, 401);
    assert.equal((await api('/hair/templates')).status, 200);
    assert.equal((await api('/hair/curl-templates')).status, 200);
    const ok = await api('/costs', undefined, { 'x-access-code': 'letmein' });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { costs: {} });
  });
});

test('API: catalogue reads share one request, and a failure is held for a minute', async () => {
  for (const [route, feature] of [['/hair/templates', 'hairTemplates'], ['/hair/curl-templates', 'curlTemplates']]) {
    let reads = 0;
    let fail = true;
    let release;
    const gate = new Promise((r) => { release = r; });
    const features = liveDemo({
      [feature]: async () => {
        reads += 1;
        await gate;
        if (fail) throw new YouCamError('down', 'McpUnavailable', 502);
        return [{ id: 'a' }];
      },
    });
    const realNow = Date.now;
    let now = realNow();
    Date.now = () => now;
    try {
      await withApi({ features }, async (api) => {
        const first = [api(route), api(route), api(route)];
        await new Promise((r) => setTimeout(r, 30));
        release();
        for (const r of await Promise.all(first)) assert.equal(r.status, 502);
        assert.equal(reads, 1, 'concurrent reads share one request');
        assert.equal((await api(route)).status, 502);
        assert.equal(reads, 1, 'a failure is answered from memory');
        now += 61_000;
        fail = false;
        const after = await api(route);
        assert.equal(after.status, 200);
        assert.equal(reads, 2, 'after a minute it asks again');
        assert.equal((await api(route)).status, 200);
        assert.equal(reads, 3, 'a success is left to the feature cache');
      });
    } finally {
      Date.now = realNow;
    }
  }
});

test('API: only 8 uploads at a time, and the slot comes back', async () => {
  let release;
  let gate = new Promise((r) => { release = r; });
  const demo = createDemoFeatures();
  const features = { ...demo, upload: async (buf, info) => { await gate; return demo.upload(buf, info); } };
  const body = Buffer.alloc(64);
  body.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], 0);
  body.set([0xff, 0xc0, 0x00, 0x11, 0x08], 20);
  body.writeUInt16BE(1000, 25);
  body.writeUInt16BE(800, 27);
  await withApi({ features }, async (_, base) => {
    const upload = () => fetch(`${base}/upload`, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body });
    const held = Array.from({ length: 8 }, upload);
    await new Promise((r) => setTimeout(r, 50));
    const busy = await upload();
    assert.equal(busy.status, 429);
    const { error } = await busy.json();
    assert.equal(error.code, 'Busy');
    assert.equal(error.fix, 'service');
    assert.doesNotMatch(error.message, /demo|server/i);
    release();
    gate = Promise.resolve();
    for (const r of await Promise.all(held)) assert.equal(r.status, 200);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal((await upload()).status, 200);
  });
});

test('API: 20 wrong access codes from an IP, then 429 for the hour', async () => {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    await withApi({ features: createDemoFeatures(), accessCode: 'letmein' }, async (api) => {
      const tryCode = (code) => api('/units', undefined, code ? { 'x-access-code': code } : {});
      for (let i = 0; i < 5; i++) assert.equal((await tryCode('')).status, 401, 'no code at all is not a guess');
      for (let i = 0; i < 20; i++) assert.equal((await tryCode(`wrong${i}`)).status, 401);
      const limited = await tryCode('wrong');
      assert.equal(limited.status, 429);
      assert.equal((await limited.json()).error.code, 'AccessCodeLimit');
      assert.equal((await tryCode('letmein')).status, 429, 'a throttled IP cannot confirm a right code');
      assert.equal((await tryCode('')).status, 401);
      assert.equal((await api('/status')).status, 200);
      now += 61 * 60 * 1000;
      assert.equal((await tryCode('letmein')).status, 200, 'the hour passes');
    });
  } finally {
    Date.now = realNow;
  }
});

test('API: the content security policy limits form posts', async () => {
  await withApi({ features: createDemoFeatures(), csp: true }, async (api) => {
    assert.match((await api('/status')).headers.get('content-security-policy'), /form-action 'self'/);
  });
});

test('API: by default a forged X-Forwarded-For does not get past a per-IP limit', async () => {
  await withApi({ features: liveDemo(), agent: createRulesAgent(), perIpDailyChats: 1 }, async (post) => {
    assert.equal((await post('/agent', { messages: asked('hello') }, { 'x-forwarded-for': '1.1.1.1' })).status, 200);
    assert.equal((await post('/agent', { messages: asked('hello') }, { 'x-forwarded-for': '2.2.2.2' })).status, 429);
  });
});

test('a missing hashed asset is a plain 404, not the app page', async () => {
  // index.js can't be booted here (it loads .env), so this checks its line and how that line behaves.
  const source = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  assert.ok(source.includes("app.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '1y', index: false, fallthrough: false }));"));
  assert.ok(source.indexOf("app.use('/assets', express.static") < source.indexOf('app.use(express.static(dist'), 'before the general static');
  assert.ok(source.includes("envNumber('TRUST_PROXY', 0)"));

  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'still-me-dist-'));
  fs.mkdirSync(path.join(dist, 'assets'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>app</title>');
  fs.writeFileSync(path.join(dist, 'assets', 'index-abc123.js'), 'export {};');
  const app = express();
  app.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '1y', index: false, fallthrough: false }));
  app.use('/assets', (err, req, res, next) => res.status(err.status || 500).type('text/plain').send('Not found'));
  app.use(express.static(dist, { maxAge: '1h', index: false }));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const found = await fetch(`${base}/assets/index-abc123.js`);
    assert.equal(found.status, 200);
    assert.match(found.headers.get('cache-control'), /max-age=31536000.*immutable/);
    const missing = await fetch(`${base}/assets/gone-xyz789.js`);
    assert.equal(missing.status, 404);
    assert.match(missing.headers.get('content-type'), /text\/plain/);
    assert.match(await (await fetch(`${base}/today`)).text(), /<title>app/, 'other paths still get the app');
  } finally {
    server.close();
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

// Fake MCP server: initialize works, and `onCall` answers each tools/call as a Response.
function fakeMcp(onCall) {
  const sent = [];
  const headers = { 'content-type': 'text/event-stream', 'mcp-session-id': 'S1' };
  const frame = (m) => `data: ${JSON.stringify(m)}\n\n`;
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    sent.push({ url, method: body.method, session: init.headers['mcp-session-id'] });
    if (body.method === 'initialize') return new Response(frame({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18' } }), { headers });
    if (body.method === 'notifications/initialized') return new Response('', { status: 202, headers });
    return onCall(body, { headers, frame, final: (text) => frame({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text }] } }) });
  };
  return { sent, fetchImpl };
}
const progress = (taskId) => ({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info', data: { msg: 'Task Created.', extra: { task_id: taskId } } } });

test('MCP: tool results come from the SSE stream, failed tasks carry their engine code', async () => {
  const { sent, fetchImpl } = fakeMcp((body, { headers, frame, final }) => {
    const tool = body.params.name;
    const text = tool === 'AI-Hair-Density-Detection'
      ? JSON.stringify({ error_message: 'YcoApiException - AI Hair Density Detection Polling failed: error_face_angle_invalid. The face angle is not within the supported range.' })
      : JSON.stringify({ status: 200, data: { task_status: 'success', task_id: 'T9', results: { url: 'https://cdn.example/r.jpg' } } });
    return new Response(frame({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info', data: { msg: 'Task Created.' } } }) + final(text), { headers });
  });
  const mcp = createYouCamMcp({ apiKey: 'k', fetchImpl });
  const run = await mcp.runTool('beauty', 'AI-Hair-Color-Virtual-Try-On', { src_file_id: 'F', palettes: [{ color: '#1f1b19' }] });
  assert.deepEqual(run, { taskId: 'T9', results: { url: 'https://cdn.example/r.jpg' } });
  await assert.rejects(mcp.runTool('beauty', 'AI-Hair-Density-Detection', { src_file_id: 'F' }), (err) => err.code === 'error_face_angle_invalid' && err.taskId === undefined);
  assert.equal(sent.filter((s) => s.method === 'initialize').length, 1, 'one session per server');
  assert.ok(sent.filter((s) => s.method === 'tools/call').every((s) => s.session === 'S1'));
});

test('MCP: a failed task carries the id from its progress notifications', async () => {
  const failed = JSON.stringify({ error_message: 'YcoApiException - Polling failed: error_no_face. No face.' });
  const { fetchImpl } = fakeMcp((body, { headers, frame, final }) => new Response(frame(progress('T7')) + final(failed), { headers }));
  const mcp = createYouCamMcp({ apiKey: 'k', fetchImpl });
  await assert.rejects(mcp.runTool('beauty', 'AI-Hair-Density-Detection', {}), (err) => err instanceof YouCamError && err.code === 'error_no_face' && err.taskId === 'T7' && err.status === 422);
  await assert.rejects(mcp.callTool('beauty', 'AI-Hair-Density-Detection', {}), (err) => err.taskId === 'T7');

  // A task status in the payload, and a success with its id only in the stream.
  const status = fakeMcp((body, { headers, frame, final }) => new Response(frame(progress('T8')) + final(JSON.stringify({ data: { task_status: 'error', error: 'error_pose' } })), { headers }));
  await assert.rejects(createYouCamMcp({ apiKey: 'k', fetchImpl: status.fetchImpl }).runTool('beauty', 'X', {}), (err) => err.code === 'error_pose' && err.taskId === 'T8');
  const ok = fakeMcp((body, { headers, frame, final }) => new Response(frame(progress('T10')) + final(JSON.stringify({ data: { task_status: 'success', results: { url: 'u' } } })), { headers }));
  assert.equal((await createYouCamMcp({ apiKey: 'k', fetchImpl: ok.fetchImpl }).runTool('beauty', 'X', {})).taskId, 'T10');
});

test('MCP: network and timeout errors become McpUnavailable, billed when a task was in flight', async () => {
  const dropped = fakeMcp(() => {
    throw new TypeError('fetch failed');
  });
  await assert.rejects(createYouCamMcp({ apiKey: 'k', fetchImpl: dropped.fetchImpl }).runTool('beauty', 'X', {}), (err) => err instanceof YouCamError && err.code === 'McpUnavailable' && err.status === 502 && err.billed === true);

  // The stream times out after the task has started: its id is not lost.
  const timedOut = fakeMcp((body, { headers, frame }) => {
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(frame(progress('T11'))));
      },
      pull(c) {
        c.error(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
      },
    });
    return new Response(stream, { headers });
  });
  await assert.rejects(createYouCamMcp({ apiKey: 'k', fetchImpl: timedOut.fetchImpl }).runTool('beauty', 'X', {}), (err) => err.code === 'McpUnavailable' && err.billed === true && err.taskId === 'T11');

  // Nothing was running while the session was being set up.
  const noSession = async () => {
    throw new TypeError('fetch failed');
  };
  await assert.rejects(createYouCamMcp({ apiKey: 'k', fetchImpl: noSession }).runTool('beauty', 'X', {}), (err) => err.code === 'McpUnavailable' && err.status === 502 && err.billed === undefined);

  const unreadable = fakeMcp((body, { headers }) => new Response('data: {not json\n\n', { headers }));
  await assert.rejects(createYouCamMcp({ apiKey: 'k', fetchImpl: unreadable.fetchImpl }).runTool('beauty', 'X', {}), (err) => err.code === 'McpUnavailable' && err.billed === true);
});

test('MCP: expired sessions are still retried once', async () => {
  let calls = 0;
  const { sent, fetchImpl } = fakeMcp((body, { headers, final }) => {
    calls += 1;
    if (calls === 1) return new Response('', { status: 404 });
    return new Response(final(JSON.stringify({ data: { task_status: 'success', task_id: 'T1', results: {} } })), { headers });
  });
  assert.equal((await createYouCamMcp({ apiKey: 'k', fetchImpl }).runTool('beauty', 'X', {})).taskId, 'T1');
  assert.equal(sent.filter((s) => s.method === 'initialize').length, 2);
});

test('MCP features delete a failed task, then report the same error', async () => {
  const deleted = [];
  const client = { deleteTask: async (id) => deleted.push(id) };
  const err = Object.assign(new YouCamError('no face', 'error_no_face', 422), { taskId: 'T7' });
  const mcp = { runTool: async () => { throw err; } };
  const features = createLiveFeatures(client, { mcp });
  await assert.rejects(features.hairColor({ fileId: 'F', hex: '#000000' }), (e) => e === err);
  await assert.rejects(features.hairDensity({ fileId: 'F' }), (e) => e === err);
  assert.deepEqual(deleted, ['T7', 'T7']);

  // No id, nothing to delete.
  const plain = createLiveFeatures(client, { mcp: { runTool: async () => { throw new YouCamError('down', 'McpUnavailable', 502); } } });
  await assert.rejects(plain.earringTryOn({ fileId: 'F', refFileId: 'R' }), (e) => e.code === 'McpUnavailable');
  assert.equal(deleted.length, 2);
});

test('regrowth: a failure after the curls were charged is billed, a failure before is not', async () => {
  const fetchImpl = async () => new Response(Buffer.from([0xff, 0xd8, 0xff]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  const deleted = [];
  const client = { deleteTask: async (id) => deleted.push(id), uploadImage: async () => 'CURLED' };
  let step = 0;
  const secondFails = {
    runTool: async () => {
      step += 1;
      if (step === 1) return { taskId: 'CURLS', results: { url: 'https://cdn.example/c.jpg' } };
      throw Object.assign(new YouCamError('no face', 'error_no_face', 422), { taskId: 'COLOUR' });
    },
  };
  const features = createLiveFeatures(client, { mcp: secondFails, fetchImpl });
  await assert.rejects(features.regrowth({ fileId: 'F', templateId: 't', hex: '#000000' }), (e) => e.code === 'error_no_face' && e.billed === true);
  assert.deepEqual(deleted, ['CURLS', 'COLOUR']);

  const uploadFails = createLiveFeatures({ ...client, uploadImage: async () => { throw new YouCamError('down', 'Upload', 502); } }, { mcp: { runTool: async () => ({ taskId: 'C', results: { url: 'https://cdn.example/c.jpg' } }) }, fetchImpl });
  await assert.rejects(uploadFails.regrowth({ fileId: 'F', templateId: 't', hex: '#000000' }), (e) => e.billed === true);

  const firstFails = createLiveFeatures(client, { mcp: { runTool: async () => { throw new YouCamError('no face', 'error_no_face', 422); } }, fetchImpl });
  await assert.rejects(firstFails.regrowth({ fileId: 'F', templateId: 't', hex: '#000000' }), (e) => e.code === 'error_no_face' && e.billed === undefined);
});
