// The Still Me companion: Claude (through KIE's Anthropic-compatible API)
// with tools. Facts come from Still Me's own rules in core/, never from the
// model: the model listens, picks tools, plans and explains. Paid YouCam work
// is only ever proposed as a plan; the app runs it after the person taps.
// With no model to ask, the rules agent answers from the same tools.

import { rankShelf, shelfContext, evaluateProduct, parseInci, CLASSES } from '../core/ingredients.js';
import { CATALOG, BROW_PRODUCTS, TYPE_LABEL } from '../core/catalog.js';
import { RED_FLAGS, TREATMENTS } from '../core/treatments.js';
import { questionsFor } from '../core/insights.js';
import { closest } from '../core/color.js';
import { browPatternFor, BROW_PATTERNS, FACE_SHAPE_TIPS, LASH_STYLES, LIP_SHADES } from '../core/brows.js';
import { urgentFlags, lintReply } from '../core/safety.js';
import { HAIR_SHADES } from './features.js';

export { urgentFlags, lintReply };

const MAX_ROUNDS = 4;
const MAX_TURNS = 10;
const MAX_CALLS_PER_ROUND = 5;
const MAX_CONVERSATION_CHARS = 60_000;

// Units per plan step when YouCam's live price list can't be read.
const STEP_COST = { wig: 2, brows: 1, hair_color: 1, regrowth: 2 };
const STEP_PATH = { wig: ['/s2s/v2.1/task/hair-transfer'], brows: ['/s2s/v2.0/task/makeup-vto'], hair_color: ['/s2s/v2.0/task/hair-color'], regrowth: ['/s2s/v2.0/task/hair-curl', '/s2s/v2.0/task/hair-color'] };
const LOOK_KINDS = ['wig', 'brows', 'regrowth'];

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
              kind: { type: 'string', enum: LOOK_KINDS },
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
// No name: health data does not travel with one.
function cleanContext(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const str = (v, n = 80) => (typeof v === 'string' ? v.slice(0, n) : undefined);
  const arr = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
  const classes = (v) => arr(v, 10).filter((c) => typeof c === 'string' && Object.hasOwn(CLASSES, c));
  const treatments = arr(raw.treatments, 6).filter((t) => typeof t === 'string' && Object.hasOwn(TREATMENTS, t));
  const phase = raw.phase && typeof raw.phase === 'object' ? { phase: str(raw.phase.phase, 12), week: Number(raw.phase.week) || 0 } : null;
  const notes = arr(raw.notes, 8).filter((n) => n && typeof n === 'object').map((n) => ({
    id: str(n.id, 60), level: str(n.level, 10), title: str(n.title, 160), subtitle: str(n.subtitle, 160), body: str(n.body, 400), careTeam: str(n.careTeam, 400), confirm: str(n.confirm, 300),
    concern: str(n.concern, 30), concerns: arr(n.concerns, 8).map((c) => str(c, 30)), treatment: str(n.treatment, 20), expectation: str(n.expectation, 40),
    avoid: classes(n.avoid), needs: classes(n.needs),
  }));
  const scores = raw.latest?.scores && typeof raw.latest.scores === 'object' ? Object.fromEntries(Object.entries(raw.latest.scores).slice(0, 10).map(([k, v]) => [str(k, 30), { score: Number(v?.score) || null, change: Number.isFinite(Number(v?.change)) ? Number(v.change) : null, status: str(v?.status, 20) }])) : null;
  const p = raw.print || {};
  return {
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

// The usable turns, ending with the person's question.
function readTurns(messages) {
  const turns = (Array.isArray(messages) ? messages : [])
    .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_TURNS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  while (turns.length && turns[0].role !== 'user') turns.shift();
  if (turns.at(-1)?.role !== 'user') throw Object.assign(new Error('Ask a question first.'), { code: 'EmptyQuestion' });
  return turns;
}

// A red flag said one turn ago is still worth raising.
function recentUrgent(turns) {
  const said = new Set(turns.filter((m) => m.role === 'user').slice(-2).flatMap((m) => urgentFlags(m.content)));
  return RED_FLAGS.filter((flag) => said.has(flag));
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

async function costsFor(features, kinds) {
  let live = {};
  try {
    live = (await features?.unitCosts?.()) || {};
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

const newOutcome = () => ({ plan: null, remember: [], tools: [] });

// Each tool returns plain JSON; propose_look and remember also leave something
// for the app (the plan card, the preference to store). Both agents use these.
function toolsFor({ features, ctx, out }) {
  const profile = { treatments: ctx.treatments };
  const shelf = () => shelfContext(profile, ctx.notes);
  const verdictOf = (r) => ({ verdict: r.verdict, reasons: r.reasons.map((x) => `${x.type}: ${x.text}${x.matches?.length ? ` (${x.matches.slice(0, 3).join(', ')})` : ''}`) });
  const styles = async () => {
    try {
      return (await features?.hairTemplates?.()) || [];
    } catch {
      return [];
    }
  };
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
      const all = await styles();
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
    unit_costs: async () => costsFor(features, Object.keys(STEP_COST)),
    propose_look: async ({ title = 'Your look', steps = [] }) => {
      const wanted = Array.isArray(steps) ? steps : [];
      const picked = wanted.slice(0, 4).filter((s) => LOOK_KINDS.includes(s?.kind));
      // Only a style YouCam lists can run, and recolouring needs a hair colour family it knows.
      const listed = new Map((picked.some((s) => s.kind === 'wig') ? await styles() : []).map((t) => [t.id, t]));
      const canRecolour = Object.hasOwn(HAIR_SHADES, String(ctx.print?.hair));
      const clean = picked.map((s) => {
        const style = s.kind === 'wig' ? listed.get(String(s.template_id || '')) : null;
        return {
          kind: s.kind,
          templateId: s.kind === 'wig' ? style?.id || null : undefined,
          title: style?.title,
          recolour: s.kind === 'wig' ? Boolean(s.recolour) && canRecolour : undefined,
          pattern: s.kind === 'brows' ? (BROW_PATTERNS.some((b) => b.label === s.pattern) ? s.pattern : browPatternFor(ctx.print?.browShape)) : undefined,
          lashes: s.kind === 'brows' && LASH_STYLES.some((l) => l.label === s.lashes) ? s.lashes : undefined,
          lips: s.kind === 'brows' && (s.lips === 'mine' || LIP_SHADES.some((l) => l.id === s.lips)) ? s.lips : undefined,
          underEye: s.kind === 'brows' ? Boolean(s.under_eye) : undefined,
          shade: s.kind === 'regrowth' ? (Object.hasOwn(HAIR_SHADES, String(s.shade)) ? s.shade : 'Grey/White') : undefined,
          why: String(s.why || '').slice(0, 160),
        };
      }).filter((s) => s.kind !== 'wig' || s.templateId);
      if (!clean.length) return { error: 'No runnable steps. A wig step needs a template_id from wig_ideas.' };
      const costs = await costsFor(features, [...new Set(clean.map((s) => s.kind))]);
      for (const s of clean) s.units = costs[s.kind].units + (s.kind === 'wig' && s.recolour ? STEP_COST.hair_color : 0);
      out.plan = { title: String(title).slice(0, 80), steps: clean, units: clean.reduce((n, s) => n + s.units, 0), livePrices: Object.values(costs).every((c) => c.live) };
      return { shown_to_person: true, total_units: out.plan.units, steps: clean.length, dropped: wanted.length - clean.length };
    },
    remember: ({ note = '' }) => {
      const n = String(note).trim().slice(0, 140);
      if (n) out.remember.push(n);
      return { saved: Boolean(n) };
    },
  };
}

// ---------------------------------------------------------------------------
// The rules agent: the same tools with no model. The words of a question pick
// the tool, and the tool's answer is written up in short, plain lines.

const URGENT_NOW = 'That can be urgent. Please contact your care team now, or your emergency number.';
const URGENT_EARLIER = 'What you told me a moment ago can be urgent. If you have not yet, please contact your care team now, or your emergency number.';
const FINAL_WORD = 'Your care team has the final word on anything new.';

const CARE_TEAM_WORDS = /\b(?:ask|tell|raise|bring up|say to|questions?)\b[^.?!]*\b(?:care team|team|doctor|oncologist|nurse|consultant)\b/i;
const LOOK_WORDS = /\b(?:wigs?|hair ?styles?|hair ?cuts?|brows?|eyebrows?|lash(?:es)?|regrowth|grow(?:s|ing)? back|try[- ]?ons?|wedding|plans?|(?:(?<!take )(?<!have )(?<!had )(?<!took )a|my|new) looks?|looks? (?:good|nice|like (?:me|myself)))\b/i;
const REGROWTH_WORDS = /\b(?:regrowth|grow(?:s|ing)? back)\b/i;
const PRODUCT_WORDS = /\b(?:moisturi[sz]\w*|creams?|lotions?|balms?|ointments?|clean[sz]ers?|cleanse|face ?wash|soap|sun ?screens?|sun ?creams?|spf|sooth\w*|serums?|toners?|retino\w*|exfoli\w*)\b/i;
const ANY_PRODUCT_WORDS = /\b(?:products?|recommend\w*|buy|shop|what (?:can|should|could) i (?:use|put|try)|anything for|something for|good for|acne|spots?)\b/i;
const INCI_WORD = /\b(?:aqua|water|glycerin|parfum|fragrance|alcohol|acid|oil|extract|butter|sodium|dimethicone|petrolatum|ceramide\w*|retino\w*|panthenol|phenoxyethanol|tocopherol|limonene|linalool|oxide|dioxide|allantoin|squalane|niacinamide|carbomer|glycol|sulfate)\b/i;

// The need a product question is about, most specific words first.
const NEEDS = [
  ['protect', 'a sunscreen', /\b(?:sun ?screens?|sun ?creams?|sun ?block|spf|sun)\b/i],
  ['cleanse', 'a cleanser', /\b(?:clean[sz]\w*|face ?wash|wash|soap)\b/i],
  ['soothe', 'something soothing', /\b(?:sooth\w*|calm\w*|itch\w*|irritat\w*|sting\w*|redness)\b/i],
  ['moisturise', 'a moisturiser', /\b(?:moisturi[sz]\w*|creams?|lotions?|balms?|ointments?|dry|dryness|tight|hydrat\w*)\b/i],
  ['treat', 'a treatment product', /\b(?:acne|spots?|pimples?|blemish\w*|retino\w*|exfoli\w*|serums?|toners?|treatments? (?:products?|creams?|gels?|serums?|for))\b/i],
];
const guessNeed = (question) => NEEDS.find(([, , words]) => words.test(question)) || NEEDS[3];

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const firstSentence = (s) => s.match(/^.+?[.!?](?=\s|$)/)?.[0] || s;
const units = (n) => `${n} ${n === 1 ? 'unit' : 'units'}`;

// The list in a pasted "Is this OK? Water, Glycerin, ..." message, without the lead-in.
function pastedIngredients(question) {
  const firstComma = question.indexOf(',');
  if (firstComma < 0) return null;
  const cut = Math.max(...[':', '?', '!', '.', '\n'].map((c) => question.lastIndexOf(c, firstComma)));
  const list = question.slice(cut + 1).replace(/[?!\s]+$/, '');
  const items = parseInci(list);
  return items.length >= 3 && items.filter((i) => INCI_WORD.test(i)).length >= 2 ? list : null;
}

function ingredientLines(res) {
  if (!res.verdict) return ['I could not read that list. Please try pasting it again.'];
  const reasons = (type) => res.reasons.filter((r) => r.startsWith(`${type}:`)).map((r) => r.slice(type.length + 1).trim());
  const warnings = [...reasons('avoid'), ...reasons('caution')].slice(0, 4);
  const helps = reasons('good').slice(0, 3);
  const lines = [{ avoid: 'Best to leave this one out for now.', caution: 'I would go carefully with this one.', good: 'Nothing in this list stands out as a problem for you.' }[res.verdict]];
  if (warnings.length) lines.push(warnings.map((w) => `- ${w}`).join('\n'));
  if (helps.length) lines.push(`It does have ${helps.map(lowerFirst).join(', ')}.`);
  lines.push(FINAL_WORD);
  return lines;
}

function productLines(res, label) {
  const products = res.products || [];
  const good = products.filter((p) => p.verdict === 'good').slice(0, 2);
  const leaveOut = products.filter((p) => p.verdict === 'avoid').concat(products.filter((p) => p.verdict === 'caution')).slice(0, 2);
  const lines = [good.length
    ? `For ${label}, I would start with ${good.map((p) => `**${p.name}**`).join(' and ')}. Nothing in ${good.length === 1 ? 'it' : 'them'} is on your list to avoid.`
    : `I could not find a clear good fit for ${label} in the shop right now. Your care team may have a suggestion.`];
  const avoid = res.rules?.avoid || [];
  const watch = avoid.length ? avoid : res.rules?.caution || [];
  if (watch.length) lines.push(`${avoid.length ? 'Best to avoid' : 'Go easy on'} ${watch.slice(0, 5).map((c) => lowerFirst(CLASSES[c].label)).join(', ')}.`);
  if (leaveOut.length) lines.push(`In this group, I would leave out ${leaveOut.map((p) => `**${p.name}**`).join(' and ')}.`);
  lines.push(FINAL_WORD);
  return lines;
}

async function lookLines(question, use) {
  const steps = [];
  const parts = [];
  if (REGROWTH_WORDS.test(question)) {
    steps.push({ kind: 'regrowth', why: 'How your hair might grow back: often curlier, and greyer at first.' });
    parts.push('a preview of how your hair might grow back');
  } else {
    const browsOnly = /\b(?:brows?|eyebrows?|lash(?:es)?)\b/i.test(question) && !/\b(?:wigs?|hair\w*|wedding|plans?|looks?)\b/i.test(question);
    if (!browsOnly) {
      const length = question.match(/\b(short|medium|long)\b/i)?.[1].toLowerCase() || 'any';
      const ideas = await use('wig_ideas', { length, limit: 3 });
      const style = ideas.styles?.[0];
      if (style) {
        steps.push({ kind: 'wig', template_id: style.template_id, recolour: true, why: ideas.face_shape_tip || 'An easy style to start with.' });
        parts.push(`the **${style.title}** wig`);
      }
    }
    const brows = await use('brow_plan');
    steps.push({ kind: 'brows', pattern: brows.pattern, why: brows.own_shape ? 'Close to your own brow shape.' : 'A natural shape to start with.' });
    parts.push(`**${brows.pattern_name || 'Natural'}** brows`);
  }
  const title = REGROWTH_WORDS.test(question) ? 'Your regrowth preview' : /\bwedding\b/i.test(question) ? 'Your wedding look' : 'A look to try';
  const plan = await use('propose_look', { title, steps });
  if (plan.error) return ['I could not put a plan together just now. Please try again in a moment.'];
  return [`Here is something to try: ${parts.join(' and ')}.`, `It uses ${units(plan.total_units)}, and nothing runs until you tap Run.`];
}

function careLines(res) {
  const questions = (res.questions || []).slice(0, 4);
  return questions.length
    ? ['Worth asking your care team:', questions.map((q) => `- ${q}`).join('\n')]
    : ['A good place to start with your care team:', '- Which skin changes should I call you about straight away?\n- Who do I call out of hours?'];
}

function statusLines(status, notes) {
  const invite = 'You can also ask me about a product, paste an ingredient list, ask what to raise with your care team, or plan a look.';
  if (!status.checkin && !notes.length) return ['You have no skin check-in yet. A weekly check-in from the Skin tab gives me something to read.', invite];
  if (!notes.length) return ['Your latest check-in is saved, and nothing in it needs a note right now.', invite];
  const lead = notes[0];
  const lines = [`From your latest check-in: **${lead.title || 'a change to watch'}**.${lead.subtitle ? ` ${lead.subtitle}.` : ''}`];
  if (lead.body) lines.push(firstSentence(lead.body));
  const others = notes.slice(1, 3).map((n) => n.title).filter(Boolean);
  if (others.length) lines.push(`Also noted: ${others.join('; ')}.`);
  const next = lead.confirm || lead.careTeam || (lead.level === 'call' ? 'Please tell your care team about this one.' : null);
  if (next) lines.push(next);
  return lines;
}

async function rulesAnswer({ features, ctx, turns, urgent, out = newOutcome() }) {
  const tools = toolsFor({ features, ctx, out });
  const use = async (name, input = {}) => {
    out.tools.push(name);
    try {
      return await tools[name](input);
    } catch (err) {
      return { error: err.message };
    }
  };
  const question = turns.at(-1).content;

  async function answer() {
    const pasted = pastedIngredients(question);
    if (pasted) return ingredientLines(await use('check_ingredients', { ingredients: pasted }));
    if (CARE_TEAM_WORDS.test(question)) return careLines(await use('care_team_questions'));
    const look = LOOK_WORDS.test(question);
    if (PRODUCT_WORDS.test(question) || (ANY_PRODUCT_WORDS.test(question) && !look)) {
      const [need, label] = guessNeed(question);
      return productLines(await use('find_products', { need, limit: 6 }), label);
    }
    if (look) return lookLines(question, use);
    return statusLines(await use('skin_status'), ctx.notes);
  }

  // Red flags first. A flag in this very message is all this answer is about;
  // one from the turn before leads the answer to the new question.
  const urgentNow = urgentFlags(question).length > 0;
  if (urgent.length) await use('red_flags');
  const linted = urgentNow ? { text: '', flagged: false } : lintReply((await answer()).join('\n\n'));
  const lead = urgentNow ? URGENT_NOW : urgent.length ? URGENT_EARLIER : '';
  return { reply: [lead, linted.text].filter(Boolean).join('\n\n'), flagged: linted.flagged, plan: out.plan, remember: out.remember, urgent, tools: out.tools, model: 'rules', rulesOnly: true };
}

// ---------------------------------------------------------------------------

export function createAgent({ apiKey, baseUrl = 'https://api.kie.ai', model = 'claude-sonnet-5-5', fallbackModel = 'gpt-6-luna', features, fetchImpl = fetch, timeoutMs = 60_000, logger = console } = {}) {
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

  /** One turn: { messages: [{ role, content }], context } -> { reply, plan, remember, urgent, tools, rulesOnly? } */
  async function respond({ messages, context } = {}) {
    const ctx = cleanContext(context);
    const turns = readTurns(messages);
    const urgent = recentUrgent(turns);
    const out = newOutcome();
    const tools = toolsFor({ features, ctx, out });
    const facts = `Context from the person's journal (on their device; summarised): ${JSON.stringify({ ...ctx, notes: ctx.notes.map((n) => n.title) })}${urgent.length ? `\nTheir latest messages mention red-flag symptoms: ${urgent.join('; ')}.` : ''}`;
    const items = [{ role: 'user', text: facts }, { role: 'assistant', text: 'Understood. I will use the tools for facts.' }, ...turns.map((m) => ({ role: m.role, text: m.content }))];

    const turn = { route: null };
    let reply = '';
    let answered = false;
    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const step = await callModel(items, turn);
        reply = step.text || reply;
        if (!step.calls.length) {
          answered = true;
          break;
        }
        items.push({ role: 'assistant', text: step.text, calls: step.calls });
        const results = [];
        for (const [i, c] of step.calls.entries()) {
          if (i >= MAX_CALLS_PER_ROUND) {
            results.push({ id: c.id, output: JSON.stringify({ error: `Too many tools at once. Use at most ${MAX_CALLS_PER_ROUND} per step.` }) });
            continue;
          }
          out.tools.push(c.name);
          let result;
          try {
            result = Object.hasOwn(tools, c.name) ? await tools[c.name](c.input) : { error: 'Unknown tool' };
          } catch (err) {
            result = { error: err.message };
          }
          results.push({ id: c.id, output: JSON.stringify(result).slice(0, 8000) });
        }
        items.push({ role: 'tool', results });
        if (JSON.stringify(items).length > MAX_CONVERSATION_CHARS) break;
      }
    } catch (err) {
      logger.warn?.(`[agent] ${err.code || 'error'}: ${err.message}`);
    }

    // No finished answer (both routes down, or out of rounds): a plan already
    // made still stands, otherwise the rules answer rather than an apology.
    const text = answered ? reply : out.plan ? reply || 'Here is a plan for you. Nothing runs until you tap Run.' : '';
    if (!text) return rulesAnswer({ features, ctx, turns, urgent, out });
    const linted = lintReply(text);
    return { reply: linted.text, flagged: linted.flagged, plan: out.plan, remember: out.remember, urgent, tools: out.tools, model: turn.route === 'fallback' ? fallbackModel : model };
  }

  return { respond, model };
}

/** With no model key: useful answers from Still Me's rules alone. */
export function createRulesAgent({ features } = {}) {
  return {
    model: 'rules',
    async respond({ messages, context } = {}) {
      const turns = readTurns(messages);
      return rulesAnswer({ features, ctx: cleanContext(context), turns, urgent: recentUrgent(turns) });
    },
  };
}
