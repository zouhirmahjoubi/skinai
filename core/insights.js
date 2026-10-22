// Turns a check-in comparison into "watch notes": what changed, what it
// commonly means for *this* person's treatment, what to do, and when to tell
// the care team. A generic skin app sees "acne" and sells acne products; for
// someone on an EGFR inhibitor that is exactly the wrong advice.

import { CONCERN_BY_KEY } from './concerns.js';
import { TREATMENTS, treatmentPhase } from './treatments.js';

const WORSE = new Set(['worse', 'much-worse']);

/**
 * @param {object} profile   { treatments: string[], startDate: 'YYYY-MM-DD' }
 * @param {object} comparison result of compareCheckin()
 * @param {Date}   now
 * @returns {Array<{id, level: 'call'|'watch'|'info'|'good', title, body, careTeam?, concern?, treatment?, avoid: string[], needs: string[]}>}
 */
export function watchNotes(profile, comparison, now = new Date()) {
  const notes = [];
  const treatments = (profile?.treatments || []).filter((t) => TREATMENTS[t]);
  const { week } = treatmentPhase(profile?.startDate, now);

  if (!comparison.baseline) {
    notes.push({
      id: 'baseline',
      level: 'info',
      title: 'Baseline saved',
      body: 'This is your reference photo. Take your next check-in in the same spot and light, so Ahead can tell real skin changes from camera changes.',
      avoid: [],
      needs: [],
    });
    return notes;
  }

  if (!comparison.lighting.comparable) {
    notes.push({
      id: 'lighting',
      level: 'info',
      title: 'Different light from your baseline',
      body: `Your face is about ${Math.round(Math.abs(comparison.lighting.diff) * 100)}% ${comparison.lighting.diff > 0 ? 'brighter' : 'darker'} than in your first photo. Some of today's changes may be the light rather than your skin; retake in your usual spot if you can.`,
      avoid: [],
      needs: [],
    });
  }

  const worsened = comparison.rows.filter((r) => WORSE.has(r.vsBase.status));

  for (const row of worsened) {
    // Every treatment expectation that could explain this change right now.
    const matches = [];
    for (const key of treatments) {
      for (const e of TREATMENTS[key].expect) {
        const concerns = [].concat(e.concern || [], e.alsoConcerns || []);
        if (!concerns.includes(row.key)) continue;
        if (week !== null && week < e.weeks[0] - 1) continue;
        const escalate = Boolean(e.callIf) && (e.callIf === 'worse' || row.vsBase.status === 'much-worse');
        matches.push({ key, e, escalate });
      }
    }
    const drop = `${CONCERN_BY_KEY[row.key].label} down ${Math.abs(row.vsBase.delta)}`;
    if (matches.length) {
      // The escalating explanation leads; other treatments are listed as "also".
      matches.sort((a, b) => Number(b.escalate) - Number(a.escalate));
      const lead = matches[0];
      const avoid = matches.flatMap((m) => m.e.avoid || []);
      const needs = matches.flatMap((m) => m.e.needs || []);
      // One side effect can move several scores (an EGFR rash lowers "clear" and "calm").
      const existing = notes.find((n) => n.expectation === lead.e.id);
      if (existing) {
        // The expectation's primary concern leads the title.
        if (row.key === lead.e.concern) existing.drops.unshift(drop);
        else existing.drops.push(drop);
        if (row.key === lead.e.concern) existing.concern = row.key;
        existing.concerns.push(row.key);
        existing.title = existing.drops.join(' · ');
        existing.level = existing.level === 'call' || lead.escalate ? 'call' : 'watch';
        existing.avoid = [...new Set([...existing.avoid, ...avoid])];
        existing.needs = [...new Set([...existing.needs, ...needs])];
        continue;
      }
      notes.push({
        id: `${lead.e.id}:${row.key}`,
        expectation: lead.e.id,
        level: lead.escalate ? 'call' : 'watch',
        title: drop,
        drops: [drop],
        subtitle: `Common with ${TREATMENTS[lead.key].label.toLowerCase()}: ${lead.e.title.toLowerCase()}`,
        body: lead.e.body,
        also: matches.slice(1).filter((m) => m.key !== lead.key).map((m) => `${TREATMENTS[m.key].label}: ${m.e.title.toLowerCase()}`),
        careTeam: lead.e.careTeam || null,
        concern: row.key,
        concerns: [row.key],
        treatment: lead.key,
        avoid: [...new Set(avoid)],
        needs: [...new Set(needs)],
      });
      continue;
    }
    notes.push({
      id: `unexplained:${row.key}`,
      level: 'watch',
      title: drop,
      concerns: [row.key],
      body: 'This is not a typical pattern for your treatments, so it may come from weather, a new product or the photo itself. Keep checking in; if it keeps going down or bothers you, mention it at your next appointment.',
      concern: row.key,
      avoid: [],
      needs: [],
    });
  }

  const improved = comparison.rows.filter((r) => r.vsBase.status === 'better' || r.vsBase.status === 'much-better');
  if (!worsened.length) {
    notes.push({
      id: 'steady',
      level: 'good',
      title: improved.length ? 'Holding up well' : 'Steady since your baseline',
      body: improved.length
        ? `${improved.map((r) => CONCERN_BY_KEY[r.key].label).join(', ')} ${improved.length > 1 ? 'are' : 'is'} up since your first photo. Keep doing what you are doing.`
        : 'No change bigger than normal photo-to-photo variation. Keep your routine gentle and keep checking in weekly.',
      avoid: [],
      needs: [],
    });
  }

  const rank = { call: 0, watch: 1, info: 2, good: 3 };
  return notes.sort((a, b) => rank[a.level] - rank[b.level]);
}

/** Questions to bring to the next appointment, derived from the notes. */
export function questionsFor(notes) {
  const q = [];
  for (const n of notes) {
    if (n.expectation === 'egfr_rash') q.push('I have an acne-like rash. Should I start a treatment for it, and which moisturiser and sunscreen do you recommend?');
    else if (n.treatment === 'radiation') q.push('My skin is getting red. What should I put on the treated area, and when before my session should I stop applying it?');
    else if (n.treatment === 'immuno') q.push('I have a new rash or itch. Is this an immune-related side effect I should treat?');
    else if (n.concern === 'moisture') q.push('My skin is getting drier. Is there a cream you recommend during treatment?');
    else if (n.concern === 'age_spot') q.push('I am noticing darker patches. Is my treatment making me sun-sensitive?');
  }
  return [...new Set(q)];
}
