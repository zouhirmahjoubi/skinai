// Turns a check-in comparison into "watch notes": what changed, what it
// commonly means for *this* person's treatment, what to do, and when to tell
// the care team. A generic skin app sees "acne" and sells acne products; for
// someone on an EGFR inhibitor that is exactly the wrong advice.

import { CONCERN_BY_KEY } from './concerns.js';
import { TREATMENTS, treatmentPhase } from './treatments.js';
import { ita } from './color.js';

const WORSE = new Set(['worse', 'much-worse']);

/**
 * @param {object} profile   { treatments: string[], startDate: 'YYYY-MM-DD' }
 * @param {object} comparison result of compareCheckin()
 * @param {Date}   now
 * @param {object} [opts] { skinHex } measured skin colour from the Hair & Brow Print
 * @returns {Array<{id, level: 'call'|'watch'|'info'|'good', title, body, careTeam?, confirm?, concern?, treatment?, avoid: string[], needs: string[]}>}
 */
export function watchNotes(profile, comparison, now = new Date(), { skinHex } = {}) {
  const notes = [];
  const treatments = (profile?.treatments || []).filter((t) => TREATMENTS[t]);
  const { week } = treatmentPhase(profile?.startDate, now);
  // Redness is harder for any camera to see on brown and black skin.
  const tone = ita(skinHex);
  const deeperTone = tone !== null && tone < 10 && treatments.some((t) => t === 'radiation' || t === 'immuno');

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
        existing.title = existing.drops.join(', ');
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
        subtitle: `${lead.e.title}, common with ${TREATMENTS[lead.key].noun}`,
        body: lead.e.body,
        also: matches.slice(1).filter((m) => m.key !== lead.key).map((m) => `${m.e.title.toLowerCase()} (${TREATMENTS[m.key].noun})`),
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
      body: 'Ahead doesn’t have this change on its list for your treatments. It could still come from treatment, or from the weather, a new product or the photo. Keep checking in, and tell your care team if it keeps going down, hurts, itches or spreads.',
      careTeam: treatments.includes('immuno') ? 'On immunotherapy, tell your care team about any new skin change, even if it seems minor.' : null,
      concern: row.key,
      avoid: [],
      needs: [],
    });
  }

  // A borderline drop in different light is not enough to escalate: a lighting
  // change alone can move a score by several points. Keep the advice, but ask
  // for a same-light retake first, unless the drop is large.
  if (!comparison.lighting.comparable) {
    for (const n of notes) {
      if (n.level !== 'call') continue;
      const large = (n.concerns || []).some((k) => comparison.rows.find((r) => r.key === k)?.vsBase.status === 'much-worse');
      if (large) continue;
      n.level = 'watch';
      n.confirm = 'Your light today was different from your baseline, so this may be the camera, not your skin. Retake in your usual spot to confirm. If you can see or feel a new rash, tell your care team anyway.';
    }
  }

  const improved = comparison.rows.filter((r) => r.vsBase.status === 'better' || r.vsBase.status === 'much-better');
  if (!worsened.length) {
    // The camera only sees the face. Name the places these treatments affect
    // that a face photo cannot show, and symptoms no photo can show.
    const blind = [];
    if (treatments.includes('egfr')) blind.push('your scalp, chest or back');
    if (treatments.includes('radiation')) blind.push('your treatment area');
    const where = treatments.includes('immuno') || !blind.length ? 'anywhere on your body' : blind.join(' or ');
    notes.push({
      id: 'steady',
      level: 'good',
      title: improved.length ? 'Your face is holding up well' : 'Your face is steady since your baseline',
      body: improved.length
        ? `${improved.map((r) => CONCERN_BY_KEY[r.key].label).join(', ')} ${improved.length > 1 ? 'are' : 'is'} up since your first photo. Keep your routine gentle and keep checking in weekly.`
        : 'No change on your face bigger than normal photo-to-photo variation. Keep your routine gentle and keep checking in weekly.',
      careTeam: `Still tell your care team about any new rash, itch, soreness or skin change on ${where}, whatever these scores say. Ahead only sees the skin on your face in this photo, and it can’t pick up itch or pain.`,
      avoid: [],
      needs: [],
    });
  }

  if (deeperTone) {
    notes.push({
      id: 'tone',
      level: 'info',
      title: 'Redness can be harder to see on deeper skin',
      body: 'On brown and black skin, irritation or a rash can look darker, purple or grey rather than red, so the Calm skin score can miss it. Tell your team about any darkening, itch or soreness, even if your scores look steady.',
      avoid: [],
      needs: [],
    });
  }

  const rank = { call: 0, watch: 1, info: 2, good: 3 };
  return notes.sort((a, b) => rank[a.level] - rank[b.level]);
}

/**
 * Questions to bring to the next appointment, derived from the notes and,
 * optionally, the treatment phase (some questions only make sense early on).
 */
export function questionsFor(notes, { treatments = [], phase } = {}) {
  const q = [];
  const early = phase && (phase.phase === 'before' || (phase.phase === 'during' && phase.week <= 2));
  if (treatments.includes('egfr') && early && !notes.some((n) => n.expectation === 'egfr_rash')) {
    q.push('Should I start preventive treatment for the EGFR-inhibitor rash from my first dose, and which moisturiser and sunscreen do you recommend?');
  }
  if (treatments.includes('chemo') && phase?.phase === 'before') {
    q.push('Could scalp cooling (a cold cap) work with my chemotherapy, and do I need to arrange it before my first infusion?');
  }
  for (const n of notes) {
    if (n.expectation === 'egfr_rash') q.push('I have an acne-like rash. Should I start a treatment for it, and which moisturiser and sunscreen do you recommend?');
    else if (n.treatment === 'radiation') q.push('The skin in my treated area is changing (redder, darker, dry or itchy). What should I put on it, and is it fine to apply on treatment days?');
    else if (n.treatment === 'immuno' || ((n.id || '').startsWith('unexplained') && treatments.includes('immuno'))) q.push('I have a new rash, itch or skin change. Is this an immune-related side effect I should treat?');
    else if (n.expectation === 'chemo_dull') q.push('My skin looks paler or duller than before. Could my blood count or liver tests explain it?');
    else if (n.concern === 'moisture') q.push('My skin is getting drier. Is there a cream you recommend during treatment?');
    else if (n.concern === 'age_spot') q.push('I am noticing darker patches. Is my treatment making me sun-sensitive?');
  }
  return [...new Set(q)];
}
