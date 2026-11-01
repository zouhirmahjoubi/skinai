import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { urgentFlags, lintReply, ASK_FIRST } from '../core/safety.js';
import { urgentFlags as agentUrgentFlags, lintReply as agentLintReply } from '../server/agent.js';
import { RED_FLAGS, TREATMENTS } from '../core/treatments.js';
import { questionsFor } from '../core/insights.js';
import { CATALOG } from '../core/catalog.js';

// Message -> which RED_FLAGS lines it must raise. Empty means it must stay quiet.
const URGENT_CASES = [
  ['I can’t breathe', [1]],
  ["I can't breathe", [1]],
  ['difficulty breathing', [1]],
  ['struggling to breathe', [1]],
  ['my throat is closing up', [1]],
  ['my rash is spreading', [3]],
  ['my eyes look yellow', [6]],
  ['my skin has turned yellow', [6]],
  ['my lips swelled up', [1]],
  ['my face swelled up overnight', [1]],
  ['38,5 C', [0]],
  ['my temp is 38.5', [0]],
  ['temp 101 tonight', [0]],
  ['high temp tonight', [0]],
  ['the sores in my mouth hurt', [4]],
  ['skin is peeling badly and oozing', [2]],
  ['I have a fever of 38.5 C and my lips are swollen', [0, 1]],
  ['I have a temperature of 38.4', [0]],
  ['the rash on my arms is blistering', [2]],
  // Unsure, or only part of it is calm: these fire.
  ['I’m not sure if I have a fever', [0]],
  ['I don’t have a fever but I can’t stop shivering', [0]],
  ['how can I prevent these blisters from getting worse', [2]],
  ['how do I avoid infection now that my rash is spreading', [3, 5]],
  ['my temperature is 39 after the shower', [0]],
  ['I can’t catch my breath', [1]],
  ['I can barely breathe', [1]],
  ['having a hard time breathing', [1]],
  ['it’s getting harder to breathe', [1]],
  ['gasping for air', [1]],
  ['trouble with my breathing', [1]],
  ['my chest feels tight', [1]],
  ['I hope I don’t have a fever', [0]],
  ['I never had a fever before today', [0]],
  ['I hope it’s not infected', [5]],
  ['My temperature was normal this morning but now it is 39', [0]],
  ['I am above my normal temperature', [0]],
  ['thermometer says 39', [0]],
  ['I am burning up and shaking', [0]],
  // Reports nothing.
  ['Can I store this cream at room temperature?', []],
  ['Can I store this at room temperature before opening?', []],
  ['How do I avoid infection before surgery?', []],
  ['What is a normal temperature?', []],
  ['What temperature should I store this at?', []],
  ['I do not have a fever', []],
  ['I don’t have a fever', []],
  ['no fever or chills so far', []],
  ['How do I avoid infection?', []],
  ['how can I prevent blisters on my hands', []],
  ['my skin feels dry and tight', []],
  ['My face feels tight and has spots. What can I use?', []],
  ['which moisturiser is gentle?', []],
  ['Plan a look for a family wedding in a few weeks.', []],
  ['Is this cream OK for me? Water, Glycerin, Fragrance, Salicylic Acid', []],
  ['My skin has yellow undertones, which wig colour suits me?', []],
];

for (const [message, flags] of URGENT_CASES) {
  test(`urgentFlags: ${message}`, () => {
    assert.deepEqual(urgentFlags(message), flags.map((i) => RED_FLAGS[i]));
  });
}

// Reply -> what must happen to it: replaced by the fixed line, kept with a caution, or left alone.
const LINT_CASES = [
  ['You could stop erlotinib for a few days', 'replace'],
  ['Hold your next dose', 'replace'],
  ['Skip your next cycle', 'replace'],
  ['Take two tablets of ibuprofen for the fever', 'replace'],
  ['No need to call your care team about this fever', 'replace'],
  ['You don’t need to call anyone about this.', 'replace'],
  ['**Hold** your next dose until it settles.', 'replace'],
  ['You should stop taking your medication.', 'replace'],
  ['Pause your treatment for a week.', 'replace'],
  ['Take 400 mg at night.', 'replace'],
  ['Take 5 ml twice a day.', 'replace'],
  ['Don’t take your dose today.', 'replace'],
  ['Cancel your next infusion.', 'replace'],
  ['Put off your next cycle.', 'replace'],
  ['Stop your Tarceva for a few days.', 'replace'],
  ['Skip Keytruda this week.', 'replace'],
  ['Stop your prednisone.', 'replace'],
  ['Avoid taking your medication.', 'replace'],
  ['This will heal the rash.', 'caution'],
  ['This cream cures dryness.', 'caution'],
  ['I can’t diagnose this.', 'caution'],
  ['It comes in a 50 ml tube.', 'keep'],
  ['Skip the scrub on treatment days.', 'keep'],
  ['Stop using the scrub.', 'keep'],
  ['Avoid the treatment area when you wash.', 'keep'],
  ['Do not take this cream on a plane without a bag.', 'keep'],
  ['Hold a cool cloth on it for a minute.', 'keep'],
  ['A gentle routine can reduce treatment side effects.', 'keep'],
  ['You could ask them: should I hold my next dose?', 'keep'],
  ['Use a fragrance-free cream twice a day.', 'keep'],
];

for (const [reply, outcome] of LINT_CASES) {
  test(`lintReply ${outcome}: ${reply}`, () => {
    const out = lintReply(reply);
    assert.equal(out.flagged, outcome !== 'keep');
    if (outcome === 'replace') assert.equal(out.text, ASK_FIRST);
    if (outcome === 'caution') assert.equal(out.text, `${reply}\n\nPlease check this with your care team before acting on it.`);
    if (outcome === 'keep') assert.equal(out.text, reply);
  });
}

test('the fixed line tells them to ask their care team, and dashes are still rewritten', () => {
  assert.match(ASK_FIRST, /ask your care team before changing anything/);
  assert.equal(lintReply('Try the oat cream — it is fragrance free. Use it 2–3 times a day.').text, 'Try the oat cream, it is fragrance free. Use it 2 to 3 times a day.');
});

test('Still Me’s own copy never trips the fixed line', () => {
  const own = [
    ...RED_FLAGS,
    ...CATALOG.map((p) => `I would start with ${p.line} ${p.name}, ${p.size}.`),
    ...Object.values(TREATMENTS).flatMap((t) => t.expect.flatMap((e) => [e.title, e.body, e.careTeam, e.careTeamBefore].filter(Boolean))),
    ...questionsFor([{ expectation: 'egfr_rash' }, { treatment: 'radiation' }, { id: 'unexplained:acne' }, { concern: 'moisture' }, { concern: 'age_spot' }, { expectation: 'chemo_dull' }], { treatments: ['egfr', 'chemo', 'immuno'], phase: { phase: 'before', week: 0 } }),
  ];
  for (const line of own) assert.notEqual(lintReply(line).text, ASK_FIRST, line);
});

test('the rules live in core and stay browser-safe, and the agent still exports them', () => {
  const source = fs.readFileSync(new URL('../core/safety.js', import.meta.url), 'utf8');
  assert.deepEqual(source.match(/^import .*$/gm).map((l) => l.trim()), ["import { RED_FLAGS } from './treatments.js';"]);
  assert.doesNotMatch(source, /\b(process|Buffer|require)\b/);
  assert.equal(agentUrgentFlags, urgentFlags);
  assert.equal(agentLintReply, lintReply);
});
