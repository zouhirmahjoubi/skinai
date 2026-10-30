// The Still Me companion: Claude (through KIE's Anthropic-compatible API)
// with tools. Facts come from Still Me's own rules in core/, never from the
// model: the model listens, picks tools, plans and explains. Paid YouCam work
// is only ever proposed as a plan; the app runs it after the person taps.

import { rankShelf, shelfContext, evaluateProduct } from '../core/ingredients.js';
import { CATALOG, BROW_PRODUCTS, TYPE_LABEL } from '../core/catalog.js';
import { RED_FLAGS, TREATMENTS } from '../core/treatments.js';
import { questionsFor } from '../core/insights.js';
import { closest } from '../core/color.js';
import { browPatternFor, BROW_PATTERNS, FACE_SHAPE_TIPS, LASH_STYLES, LIP_SHADES } from '../core/brows.js';
import { HAIR_SHADES } from './features.js';

const MAX_ROUNDS = 6;
const MAX_TURNS = 10;

// Units per plan step when YouCam's live price list can't be read.
const STEP_COST = { wig: 2, brows: 1, hair_color: 1, regrowth: 2 };
const STEP_PATH = { wig: ['/s2s/v2.1/task/hair-transfer'], brows: ['/s2s/v2.0/task/makeup-vto'], hair_color: ['/s2s/v2.0/task/hair-color'], regrowth: ['/s2s/v2.0/task/hair-curl', '/s2s/v2.0/task/hair-color'] };

// Words in a message that match the red-flag list: answered with "contact
// your care team now" before anything else, whatever the model says.
const URGENT = [
  /\b(fever|temperature|3[89](\.\d)?\s*°?\s*c\b|10[0-4](\.\d)?\s*°?\s*f\b|chills|shiver)/i,
  /\b(swollen|swelling)\b.*\b(face|lips?|tongue|throat)\b|\b(face|lips?|tongue|throat)\b.*\b(swollen|swelling|puffy)\b|\bhives\b|(can'?t|cannot|trouble|hard to) breath|short(ness)? of breath/i,
  /\bblister|\bpeel(ing)? in sheets|\bweep(ing|s)?\b|\bopen (sore|wound)s?\b/i,
  /\b(spreading|spreads) (fast|quickly)|\bpainful rash\b|\brash\b.*\b(all over|whole body|large area)/i,
  /\bmouth sores?\b|\b(red|sore) eyes?\b/i,
  /\bpus\b|\bred streaks?\b|\binfect(ed|ion)\b/i,
  /\byellow(ing)? (skin|eyes)|\bjaundice/i,
];

/** The red flags a message mentions (from core/treatments RED_FLAGS). */
export function urgentFlags(text = '') {
  return URGENT.map((re, i) => (re.test(text) ? RED_FLAGS[i] : null)).filter(Boolean);
}

// Claims a companion must not make. A reply that makes one gets a fixed
// caution line; dashes are rewritten to match the app's house style.
const CLAIMS = [/\bcure[sd]?\b/i, /\bdiagnos(e|is|ed)\b/i, /\bguarantee/i, /\bwill (prevent|heal|stop)\b/i, /\b(stop|skip|pause) (taking )?(your )?(treatment|medication|medicine|chemo)/i, /\b\d+(\.\d+)?\s?(mg|ml)\b/i];
export function lintReply(text = '') {
  const clean = text
    .replace(/(\d)\s*[–—]\s*(\d)/g, '$1 to $2')
    .replace(/\s*[—–]\s*/g, ', ')
    .trim();
  const flagged = CLAIMS.some((re) => re.test(clean));
  return { text: flagged ? `${clean}\n\nPlease check this with your care team before acting on it.` : clean, flagged };
}

const SYSTEM = `You are Still Me, a companion inside a self-tracking app for people going through cancer treatment who are facing skin, hair and brow changes. You are not a clinician.

How you work:
- Facts about skin changes, products, ingredients, safety and unit costs come only from your tools. Never invent products, ingredients, prices, scores or costs. If a tool has nothing, say so.
- Never diagnose, never suggest changing, pausing or stopping any treatment or medicine, and never give doses. For anything medical, say to ask the care team and offer questions from care_team_questions.
- If the person mentions a red-flag symptom (fever, swelling of face or throat, trouble breathing, blistering, a fast-spreading or painful rash, signs of infection, yellowing), your first sentence tells them to contact their care team now, or their emergency number. Keep the rest short.
- Looks: when someone wants to see a look (wig, brows, lashes, lips, their own hair colour, or how regrowth might look), call wig_ideas and/or brow_plan, then propose_look. Never say a try-on has run: the person runs the plan after seeing its unit cost.
- When the person states a lasting preference (a style they like or dislike, an ingredient they react to), call remember with one short sentence.
- Use what the context says about kept and rejected looks and saved preferences, and say so when it shapes a suggestion.
- Never assume the person's gender or pronouns. Say "you"; write remembered notes without pronouns (e.g. "Prefers short, easy styles").

Style: warm, plain English, short sentences, under 130 words. No em dashes. No marketing words. At most 4 bullet points. Address the person directly.`;

const TOOLS = [
  { name: 'skin_status', description: "The person's latest skin check-in read against their treatment and week: scores, changes beyond photo noise, and the app's notes with what to do. Use for any question about how their skin is doing.", input_schema: { type: 'object', properties: {} } },
  { name: 'find_products', description: "Products from the shop's catalogue ranked for this person by Still Me's ingredient rules (their treatment and latest check-in). Each has a verdict (good, caution, avoid) and reasons.", input_schema: { type: 'object', properties: { need: { type: 'string', enum: Object.keys(TYPE_LABEL), description: 'Kind of product' }, limit: { type: 'integer', minimum: 1, maximum: 6 } }, required: ['need'] } },
  { name: 'check_ingredients', description: 'Checks one product the person pasted or named, from its ingredient (INCI) list, against their treatment and latest check-in.', input_schema: { type: 'object', properties: { name: { type: 'string' }, ingredients: { type: 'string', description: 'The INCI list, comma separated' } }, required: ['ingredients'] } },
  { name: 'care_team_questions', description: 'Questions worth asking the care team now, from the notes and treatment phase.', input_schema: { type: 'object', properties: {} } },
  { name: 'red_flags', description: 'Symptoms that mean contacting the care team straight away.', input_schema: { type: 'object', properties: {} } },
  { name: 'wig_ideas', description: "Wig styles the person can try on (YouCam hairstyle templates), with the face-shape tip and their natural hair colour from their print. Returns template ids for propose_look.", input_schema: { type: 'object', properties: { length: { type: 'string', enum: ['short', 'medium', 'long', 'any'] }, limit: { type: 'integer', minimum: 1, maximum: 8 } } } },
  { name: 'brow_plan', description: 'The brow shape closest to their own (from their print), their measured brow colour, the nearest brow pencil, and the lash and lip options a brow preview can add.', input_schema: { type: 'object', properties: {} } },
  { name: 'unit_costs', description: "Live YouCam unit prices for try-on steps, read from YouCam's MCP server.", input_schema: { type: 'object', properties: {} } },
  {
    name: 'propose_look',
    description: 'Proposes a set of try-ons for the person to run. Shown as a card with the total unit cost and a Run button. Steps: wig (needs template_id from wig_ideas; recolour true to paint it in their own colour), brows (pattern from brow_plan; optional lashes, lips, under_eye), regrowth (how hair might grow back: curlier, in a shade).',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short name for the look, e.g. "Wedding in week 6"' },
        steps: {
          type: 'array',
          minItems: 1,
          maxItems: 4,
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['wig', 'brows', 'regrowth'] },
              template_id: { type: 'string' },
              recolour: { type: 'boolean' },
              pattern: { type: 'string' },
              lashes: { type: 'string', enum: ['none', ...LASH_STYLES.map((l) => l.label)] },
              lips: { type: 'string', enum: ['none', 'mine', ...LIP_SHADES.map((l) => l.id)] },
              under_eye: { type: 'boolean' },
              shade: { type: 'string', enum: Object.keys(HAIR_SHADES) },
              why: { type: 'string', description: 'One short reason, shown to the person' },
            },
            required: ['kind', 'why'],
          },
        },
      },
      required: ['title', 'steps'],
    },
  },
  { name: 'remember', description: 'Saves a lasting preference on the person’s device, so later suggestions use it.', input_schema: { type: 'object', properties: { note: { type: 'string', maxLength: 140 } }, required: ['note'] } },
];

// Only the fields the tools need, size-capped: the context comes from the browser.
function cleanContext(raw = {}) {
  const str = (v, n = 80) => (typeof v === 'string' ? v.slice(0, n) : undefined);
  const arr = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
  const treatments = arr(raw.treatments, 6).filter((t) => TREATMENTS[t]);
  const phase = raw.phase && typeof raw.phase === 'object' ? { phase: str(raw.phase.phase, 12), week: Number(raw.phase.week) || 0 } : null;
  const notes = arr(raw.notes, 8).map((n) => ({
    id: str(n.id, 60), level: str(n.level, 10), title: str(n.title, 160), body: str(n.body, 400), action: str(n.action, 300),
    concern: str(n.concern, 30), concerns: arr(n.concerns, 8).map((c) => str(c, 30)), treatment: str(n.treatment, 20), expectation: str(n.expectation, 40),
    avoid: arr(n.avoid, 10).map((c) => str(c, 30)), needs: arr(n.needs, 10).map((c) => str(c, 30)),
  }));
  const scores = raw.latest?.scores && typeof raw.latest.scores === 'object' ? Object.fromEntries(Object.entries(raw.latest.scores).slice(0, 10).map(([k, v]) => [str(k, 30), { score: Number(v?.score) || null, change: Number.isFinite(Number(v?.change)) ? Number(v.change) : null, status: str(v?.status, 20) }])) : null;
  const p = raw.print || {};
  return {
    name: str(raw.name, 40),
    treatments,
    phase,
    latest: raw.latest ? { date: str(raw.latest.date, 10), tier: str(raw.latest.tier, 4), scores } : null,
    notes,
    print: raw.print ? { hair: str(p.hair, 20), browHex: str(p.browHex, 7), skinHex: str(p.skinHex, 7), lipHex: str(p.lipHex, 7), faceShape: str(p.faceShape, 20), browShape: str(p.browShape, 20), browThickness: str(p.browThickness, 20) } : null,
    list: arr(raw.list, 12).map((x) => str(x, 80)),
    looks: arr(raw.looks, 12).map((l) => ({ label: str(l?.label, 80), kept: Boolean(l?.kept) })),
    prefs: arr(raw.prefs, 12).map((x) => str(x, 140)),
  };
}

// The conversation is kept provider-neutral ({ role: 'user', text } |
// { role: 'assistant', text, calls } | { role: 'tool', results }) and turned
// into each API's shape per request.
const toAnthropic = (items) =>
  items.map((m) => {
    if (m.role === 'tool') return { role: 'user', content: m.results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.output })) };
    if (m.role === 'assistant' && m.calls?.length) return { role: 'assistant', content: [...(m.text ? [{ type: 'text', text: m.text }] : []), ...m.calls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.input }))] };
    return { role: m.role, content: m.text };
  });
const toResponses = (items) =>
  items.flatMap((m) => {
    if (m.role === 'tool') return m.results.map((r) => ({ type: 'function_call_output', call_id: r.id, output: r.output }));
    if (m.role === 'assistant') return [...(m.text ? [{ role: 'assistant', content: m.text }] : []), ...(m.calls || []).map((c) => ({ type: 'function_call', call_id: c.id, name: c.name, arguments: JSON.stringify(c.input) }))];
    return [{ role: 'user', content: m.text }];
  });

// KIE may answer the Responses API as a server-sent event stream; the final
// response.completed event holds the whole response.
function responsesBody(text) {
  if (!text.trimStart().startsWith('event:') && !text.trimStart().startsWith('data:')) return JSON.parse(text);
  let done = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    try {
      const ev = JSON.parse(line.slice(5));
      if (ev.type === 'response.completed' || ev.type === 'response.failed') done = ev.response;
    } catch {
      /* partial frame */
    }
  }
  return done;
}

export function createAgent({ apiKey, baseUrl = 'https://api.kie.ai', model = 'claude-sonnet-5-5', fallbackModel = 'gpt-6-luna', features, fetchImpl = fetch, timeoutMs = 60_000 } = {}) {
  const fail = (message, status) => Object.assign(new Error(message), { code: status === 429 ? 'RateLimitExceeded' : 'AgentUnavailable' });

  async function viaAnthropic(items) {
    const res = await fetchImpl(`${baseUrl}/anthropic/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}`, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 900, system: SYSTEM, tools: TOOLS, messages: toAnthropic(items) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.content) throw fail(data?.error?.message || data?.msg || `Model request failed (${res.status})`, res.status);
    return {
      text: data.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim(),
      calls: data.content.filter((c) => c.type === 'tool_use').map((c) => ({ id: c.id, name: c.name, input: c.input || {} })),
    };
  }

  async function viaResponses(items) {
    const res = await fetchImpl(`${baseUrl}/openai/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: fallbackModel,
        instructions: SYSTEM,
        input: toResponses(items),
        tools: TOOLS.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.input_schema })),
        max_output_tokens: 1200,
        store: false,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let data = null;
    try {
      data = responsesBody(text);
    } catch {
      data = null;
    }
    if (!res.ok || !data?.output) throw fail(data?.error?.message || `Model request failed (${res.status})`, res.status);
    return {
      text: data.output.filter((o) => o.type === 'message').flatMap((o) => o.content || []).filter((c) => c.type === 'output_text').map((c) => c.text).join('\n').trim(),
      calls: data.output.filter((o) => o.type === 'function_call').map((o) => {
        let input = {};
        try {
          input = JSON.parse(o.arguments || '{}');
        } catch {
          input = {};
        }
        return { id: o.call_id, name: o.name, input };
      }),
    };
  }

  // Claude first; if KIE's Claude route fails, the turn goes to the fallback
  // model, and the rest of that turn stays with whichever answered.
  async function callModel(items, turn) {
    if (turn.route) return turn.route === 'fallback' ? viaResponses(items) : viaAnthropic(items);
    try {
      const out = await viaAnthropic(items);
      turn.route = 'claude';
      return out;
    } catch (err) {
      if (!fallbackModel) throw err;
      const out = await viaResponses(items);
      turn.route = 'fallback';
      return out;
    }
  }

  async function costsFor(kinds) {
    let live = {};
    try {
      live = (await features.unitCosts?.()) || {};
    } catch {
      live = {};
    }
    const out = {};
    for (const k of kinds) {
      const paths = STEP_PATH[k] || [];
      const sum = paths.reduce((n, p) => n + (Number(live[p]?.units) || 0), 0);
      out[k] = { units: paths.every((p) => live[p]) ? sum : STEP_COST[k], live: paths.every((p) => live[p]) };
    }
    return out;
  }

  // Each tool returns plain JSON for the model; propose_look and remember also
  // leave something for the app (the plan card, the preference to store).
  function toolsFor(ctx, out) {
    const profile = { treatments: ctx.treatments };
    const shelf = () => shelfContext(profile, ctx.notes);
    const verdictOf = (r) => ({ verdict: r.verdict, reasons: r.reasons.map((x) => `${x.type}: ${x.text}${x.matches?.length ? ` (${x.matches.slice(0, 3).join(', ')})` : ''}`) });
    return {
      skin_status: () => (ctx.latest ? { checkin: ctx.latest, notes: ctx.notes, treatments: ctx.treatments.map((t) => TREATMENTS[t].label), phase: ctx.phase } : { checkin: null, note: 'No skin check-in yet. Suggest a weekly check-in from the Skin tab.' }),
      find_products: ({ need, limit = 4 }) => ({
        rules: shelf(),
        products: rankShelf(CATALOG.filter((p) => p.type === need), shelf())
          .slice(0, Math.min(6, Number(limit) || 4))
          .map((r) => ({ name: `${r.product.line} ${r.product.name}`, price: r.product.price, size: r.product.size, ...verdictOf(r) })),
        note: 'Catalogue products are from the demo shop.',
      }),
      check_ingredients: ({ name = 'This product', ingredients = '' }) => ({ name: String(name).slice(0, 80), ...verdictOf(evaluateProduct({ name, ingredients: String(ingredients).slice(0, 4000) }, shelf())) }),
      care_team_questions: () => ({ questions: questionsFor(ctx.notes, { treatments: ctx.treatments, phase: ctx.phase }) }),
      red_flags: () => ({ red_flags: RED_FLAGS }),
      wig_ideas: async ({ length = 'any', limit = 6 }) => {
        const all = (await features.hairTemplates().catch(() => [])) || [];
        const want = String(length).toLowerCase();
        const pick = all.filter((t) => want === 'any' || `${t.category} ${t.title} ${t.id}`.toLowerCase().includes(want));
        const shape = String(ctx.print?.faceShape || '').toLowerCase();
        return {
          styles: (pick.length ? pick : all).slice(0, Math.min(8, Number(limit) || 6)).map((t) => ({ template_id: t.id, title: t.title, length: t.category, keeps_own_colour: Boolean(t.keepsColor) })),
          face_shape: ctx.print?.faceShape || null,
          face_shape_tip: FACE_SHAPE_TIPS[shape] || null,
          natural_hair_colour: ctx.print?.hair || null,
          recolour_note: 'recolour: true paints a template in their own colour family (1 more unit).',
        };
      },
      brow_plan: () => {
        const pattern = browPatternFor(ctx.print?.browShape);
        const pencil = ctx.print?.browHex ? closest(BROW_PRODUCTS, ctx.print.browHex)[0] : null;
        return {
          own_shape: ctx.print?.browShape || null,
          pattern,
          pattern_name: BROW_PATTERNS.find((b) => b.label === pattern)?.name || 'Natural',
          other_patterns: BROW_PATTERNS.map((b) => ({ pattern: b.label, name: b.name })),
          brow_colour: ctx.print?.browHex || null,
          nearest_pencil: pencil?.dE != null ? `${pencil.item.name} (colour difference ${pencil.dE.toFixed(1)})` : null,
          lashes: LASH_STYLES.map((l) => ({ id: l.label, name: l.name })),
          lips: [{ id: 'mine', name: 'Their own measured lip colour' }, ...LIP_SHADES.map((l) => ({ id: l.id, name: l.name }))],
        };
      },
      unit_costs: async () => costsFor(Object.keys(STEP_COST)),
      propose_look: async ({ title = 'Your look', steps = [] }) => {
        const clean = (Array.isArray(steps) ? steps : []).slice(0, 4).filter((s) => STEP_COST[s?.kind]).map((s) => ({
          kind: s.kind,
          templateId: s.kind === 'wig' ? String(s.template_id || '').slice(0, 128) || null : undefined,
          recolour: s.kind === 'wig' ? Boolean(s.recolour) : undefined,
          pattern: s.kind === 'brows' ? (BROW_PATTERNS.some((b) => b.label === s.pattern) ? s.pattern : browPatternFor(ctx.print?.browShape)) : undefined,
          lashes: s.kind === 'brows' && LASH_STYLES.some((l) => l.label === s.lashes) ? s.lashes : undefined,
          lips: s.kind === 'brows' && (s.lips === 'mine' || LIP_SHADES.some((l) => l.id === s.lips)) ? s.lips : undefined,
          underEye: s.kind === 'brows' ? Boolean(s.under_eye) : undefined,
          shade: s.kind === 'regrowth' ? (HAIR_SHADES[s.shade] ? s.shade : 'Grey/White') : undefined,
          why: String(s.why || '').slice(0, 160),
        })).filter((s) => s.kind !== 'wig' || s.templateId);
        if (!clean.length) return { error: 'No runnable steps. A wig step needs a template_id from wig_ideas.' };
        const costs = await costsFor([...new Set(clean.map((s) => s.kind))]);
        for (const s of clean) s.units = costs[s.kind].units + (s.kind === 'wig' && s.recolour ? STEP_COST.hair_color : 0);
        out.plan = { title: String(title).slice(0, 80), steps: clean, units: clean.reduce((n, s) => n + s.units, 0), livePrices: Object.values(costs).every((c) => c.live) };
        return { shown_to_person: true, total_units: out.plan.units, steps: clean.length };
      },
      remember: ({ note = '' }) => {
        const n = String(note).trim().slice(0, 140);
        if (n) out.remember.push(n);
        return { saved: Boolean(n) };
      },
    };
  }

  /** One turn: { messages: [{ role, content }], context } -> { reply, plan, remember, urgent, tools } */
  async function respond({ messages = [], context = {} } = {}) {
    const ctx = cleanContext(context);
    const turns = messages
      .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-MAX_TURNS)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
    while (turns.length && turns[0].role !== 'user') turns.shift();
    const last = turns[turns.length - 1];
    if (!last || last.role !== 'user') throw Object.assign(new Error('Ask a question first.'), { code: 'EmptyQuestion' });

    const urgent = urgentFlags(last.content);
    const out = { plan: null, remember: [], tools: [] };
    const tools = toolsFor(ctx, out);
    const facts = `Context from the person's journal (on their device; summarised): ${JSON.stringify({ ...ctx, notes: ctx.notes.map((n) => n.title) })}${urgent.length ? `\nThe last message mentions red-flag symptoms: ${urgent.join('; ')}.` : ''}`;
    const items = [{ role: 'user', text: facts }, { role: 'assistant', text: 'Understood. I will use the tools for facts.' }, ...turns.map((m) => ({ role: m.role, text: m.content }))];

    const turn = { route: null };
    let reply = '';
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const step = await callModel(items, turn);
      reply = step.text || reply;
      if (!step.calls.length) break;
      items.push({ role: 'assistant', text: step.text, calls: step.calls });
      const results = [];
      for (const c of step.calls) {
        out.tools.push(c.name);
        let result;
        try {
          result = tools[c.name] ? await tools[c.name](c.input) : { error: 'Unknown tool' };
        } catch (err) {
          result = { error: err.message };
        }
        results.push({ id: c.id, output: JSON.stringify(result).slice(0, 8000) });
      }
      items.push({ role: 'tool', results });
    }
    const linted = lintReply(reply || 'Sorry, I could not answer that. Try asking in a different way.');
    return { reply: linted.text, flagged: linted.flagged, plan: out.plan, remember: out.remember, urgent, tools: out.tools, model: turn.route === 'fallback' ? fallbackModel : model };
  }

  return { respond, model };
}

/** Without a model key: the rules alone, clearly labelled. */
export function createDemoAgent({ features } = {}) {
  return {
    model: 'demo',
    async respond({ messages = [], context = {} } = {}) {
      const ctx = cleanContext(context);
      const last = [...messages].reverse().find((m) => m?.role === 'user')?.content || '';
      const urgent = urgentFlags(last);
      const qs = questionsFor(ctx.notes, { treatments: ctx.treatments, phase: ctx.phase }).slice(0, 2);
      const lines = [urgent.length ? 'That can be urgent. Contact your care team now, or your emergency number.' : 'Demo mode: the companion needs a model key on the server, so this answer comes from Still Me’s rules alone.'];
      if (ctx.notes[0]) lines.push(`Your latest check-in: ${ctx.notes[0].title}`);
      if (qs.length) lines.push(`Worth asking your care team: ${qs.join(' ')}`);
      void features;
      return { reply: lines.join('\n\n'), flagged: false, plan: null, remember: [], urgent, tools: [], demo: true };
    },
  };
}
