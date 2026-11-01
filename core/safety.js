// What a message or a reply must never get past: red-flag symptoms in what the
// person writes, and claims a companion must not make. Plain string rules, so
// the browser can import them too (no Node-only imports here).

import { RED_FLAGS } from './treatments.js';

// Curly apostrophes read like straight ones.
const straighten = (text) => String(text ?? '').replace(/[‘’ʼ＇]/g, "'");

// Words in a message that match the red-flag list, one entry per RED_FLAGS line
// and in the same order: answered with "contact your care team now" before
// anything else, whatever the model says. When unsure these fire.
const URGENT = [
  /\bfever|\btemp(?:erature)?s?\b|\bchills\b|\bshiver|\b(?:3[89]|4[01])(?:[.,]\d+)?\s*(?:°\s*c?|deg(?:ree)?s?\b(?:\s*c\b)?|c\b)|\b3[89][.,]\d\b|\b10[0-5](?:[.,]\d+)?\s*(?:°\s*f?|deg(?:ree)?s?\b(?:\s*f\b)?|f\b)|\b10[0-5][.,]\d\b/i,
  /\b(?:swollen|swelling|swell(?:s|ed)?|puffy|puffed)\b.*\b(?:face|lips?|tongue|throat|mouth)\b|\b(?:face|lips?|tongue|throat|mouth)\b.*\b(?:swollen|swelling|swell(?:s|ed)?|puffy|puffed)\b|\bhives\b|\bthroat\b.*\b(?:clos(?:e|es|ed|ing)|tight\w*)\b|\b(?:can't|cant|can ?not|couldn't|could not|unable to|hard to|difficult to|struggl\w+ to|struggl\w+ for|gasp\w* for|trouble|difficulty|problems?)\s+(?:\w+\s+)?breath|\bbreathing\b.*\b(?:hard|difficult|trouble|problems?)\b|\bshort(?:ness)? of breath\b|\bout of breath\b|\bbreathless|\bwheez/i,
  /\bblister|\bpeel(?:s|ing)?\s+(?:badly|off|away|a lot|in (?:sheets|strips|layers))|\bweep(?:s|ing)?\b|\booz(?:e|es|ing)\b|\bopen (?:sore|wound)s?\b|\b(?:skin|rash)\b[^.?!]{0,40}\b(?:open(?:s|ed|ing)? up|bleed(?:s|ing)?|split(?:s|ting)? open|cracked open)\b/i,
  /\b(?:spreading|spreads) (?:fast|quickly)|\bpainful rash\b|\brash\b.*\b(?:all over|whole body|large area|spread\w*|hurts?|painful|burn(?:s|ing)?)\b|\bspread\w*\b.*\brash\b/i,
  /\bmouth (?:sores?|ulcers?)\b|\b(?:sores?|ulcers?)\b[^.?!]*\bmouth\b|\bmouth\b[^.?!]*\bsores?\b|\b(?:red|sore) eyes?\b|\beyes?\s+(?:are|is|look|looks|feel|feels|got|gone|turned|went)\s+(?:\w+\s+)?(?:red|sore)\b/i,
  /\bpus\b|\bred streaks?\b|\binfect(?:ed|ions?)\b|\b(?:redness|warmth)\b[^.?!]*\bspread|\bspread\w*\b[^.?!]*\b(?:redness|warmth)\b/i,
  /\byellow(?:ing)? (?:skin|eyes)\b|\bjaundice|\b(?:skin|eyes?)\b[^.?!]{0,40}\byellow(?:ish|ing)?\b(?!\s+undertone)|\bturn(?:ed|ing)? yellow\b/i,
];

const SYMPTOM = String.raw`(?:fever|temp(?:erature)?|chills?|shivers?|shivering|infections?|blisters?|blistering|hives|swelling|pus|(?:mouth |open )?sores?|ulcers?|(?:painful )?rash(?:es)?|red streaks?|(?:trouble|difficulty|problems?) breathing|shortness of breath)`;
const SYMPTOM_LEAD = String.raw`(?:(?:a|an|any|high|bad|skin|signs? of|symptoms? of)\s+)*`;

// Phrases that name a symptom without reporting one. They are taken out before
// the checks above, and they are narrow on purpose: "no fever" goes, "not sure
// if I have a fever" and "prevent blisters from getting worse" stay and fire.
const NOT_A_REPORT = [
  new RegExp(String.raw`\b(?:no|without|never had|free of|(?:do|does|did) not (?:have|get)|(?:don't|doesn't|didn't) (?:have|get)|(?:haven't|hasn't) (?:got|had)|not (?:got|had|having))\s+${SYMPTOM_LEAD}${SYMPTOM}\b(?:\s+(?:or|nor)\s+${SYMPTOM_LEAD}${SYMPTOM}\b)*`, 'gi'),
  /\b(?:not|isn't|aren't|wasn't|weren't|hasn't|haven't)\s+(?:been\s+)?(?:swollen|swelling|infected|blistering|blistered|weeping|oozing|spreading)\b/gi,
  new RegExp(String.raw`\b(?:avoid(?:s|ing)?|prevent(?:s|ing)?|(?:reduce|lower)(?:s|ing)? (?:the |my )?risk of|protect(?:s|ing)? (?:me |myself |my skin )?(?:from|against))\s+(?:getting\s+|developing\s+|having\s+|catching\s+)?${SYMPTOM_LEAD}${SYMPTOM}\b(?![^.?!]*\b(?:worse|spread\w*|burst\w*|pop\w*|again|coming back)\b)`, 'gi'),
  // The temperature of a thing, or a normal reading, is not a fever.
  /\b(?:room|water|bath|shower|storage|fridge|freezer|oven|ambient|air|outdoor|outside|cool|cold|warm|wash(?:ing)?|normal)\s+temp(?:erature)?s?\b/gi,
  /\btemp(?:erature)?s?\s+(?:of|in|for)\s+(?:the\s+|my\s+|this\s+)?(?:water|room|bath|shower|fridge)\b/gi,
  /\b(?:what|which)\s+temp(?:erature)?s?\s+(?:should|do|can|to)\s+(?:i\s+)?(?:store|keep|wash)\b/gi,
  /\btemp(?:erature)?\s+(?:is|was|has been|stayed)\s+(?:normal|fine|ok|okay|stable)\b/gi,
  /\bhay fever\b/gi,
];

/** The red flags a message mentions (from core/treatments RED_FLAGS). */
export function urgentFlags(text = '') {
  const said = NOT_A_REPORT.reduce((t, re) => t.replace(re, ' '), straighten(text));
  return URGENT.map((re, i) => (re.test(said) ? RED_FLAGS[i] : null)).filter(Boolean);
}

// What a treatment change looks like: a verb, a few small words, then the
// treatment itself. "your" but not "my", so a question for the care team such
// as "Should I hold my dose?" passes. The small words are a closed list, so
// "skip the scrub on treatment days" and "reduce treatment side effects" pass too.
const CHANGE = String.raw`(?:stop(?:s|ping)?|skip(?:s|ping)?|pause[sd]?|pausing|hold(?:s|ing)?|halt(?:s|ing)?|quit(?:s|ting)?|discontinu(?:e|ing)|drop(?:s|ping)?|delay(?:s|ing)?|postpon(?:e|ing)|defer(?:s|ring)?|miss(?:es|ing)?|cut(?:ting)?(?: back| down)?|lower(?:ing)?|reduc(?:e|ing)|decreas(?:e|ing)|increas(?:e|ing)|doubl(?:e|ing)|halv(?:e|ing)|chang(?:e|ing)|adjust(?:ing)?|com(?:e|ing) off|go(?:ing)? off|get(?:ting)? off|tak(?:e|ing) a break from|tak(?:e|ing) time off)`;
const SMALL_WORDS = String.raw`(?:(?:off on|back on|down on|off|taking|using|having|your|the|this|that|a|an|one|next|today's|tomorrow's|tonight's|this week's|next week's|upcoming|current|remaining|scheduled|planned|weekly|daily|morning|evening|oral|targeted|hormone|cancer)\s+)*`;
const TREATMENT = String.raw`(?:treatments?|therapy|therapies|chemo(?:therapy)?|radio(?:therapy)?|radiation|immunotherapy|medications?|medicines?|meds?|drugs?|prescriptions?|tablets?|pills?|capsules?|injections?|infusions?|doses?|dosages?|cycles?|sessions?|regimen|steroids?|tamoxifen|letrozole|anastrozole|exemestane|fulvestrant|\w+(?:tinib|ciclib|parib|degib|zomib|lisib|mab|platin|taxel|rubicin|fosfamide|citabine|trexate|tecan|lutamide))`;
const NOT_THE_TREATMENT = String.raw`(?![-\s]*(?:related|side|rash|reactions?|effects?|days?|area|field)\b)`;
const PAIN_RELIEF = String.raw`(?:ibuprofen|paracetamol|acetaminophen|tylenol|advil|motrin|nurofen|panadol|aspirin|naproxen|aleve|benadryl)`;
const NO_NEED = String.raw`(?:no need|not necessary|unnecessary|needn't|need not|don't need|do not need|don't have|do not have|don't bother|not worth|no reason)`;

// Telling someone to change treatment, take a dose or not call: nothing of the
// reply survives. The ml in a shop's pack size is not a dose, so a bare "50 ml"
// is left alone.
const ASK_FIRST_CLAIMS = [
  new RegExp(String.raw`\b${CHANGE}\s+${SMALL_WORDS}${TREATMENT}\b${NOT_THE_TREATMENT}`, 'i'),
  /\b\d+(?:[.,]\d+)?\s?(?:mg|mcg|µg|milligrams?|micrograms?)\b/i,
  /\b(?:take|drink|swallow)\s+(?:about\s+|up to\s+)?\d+(?:[.,]\d+)?\s?ml\b/i,
  /\b(?:take|swallow|have|use)\s+(?:a|an|one|two|three|four|five|six|half|another|extra|\d+)\s+(?:\w+\s+)?(?:tablets?|pills?|capsules?|doses?)\b/i,
  new RegExp(String.raw`\b(?:take|taking|try|trying|use|using|have|swallow)\s+(?:\w+\s+){0,3}?${PAIN_RELIEF}\b`, 'i'),
  /\b(?:extra|double|half|higher|lower|smaller|bigger|larger)\s+doses?\b/i,
  new RegExp(String.raw`\b${NO_NEED}(?:\s+to)?\s+(?:call|calling|ring|ringing|phone|phoning)\b|\bno need for (?:a |an )?(?:call|visit|doctor)\b`, 'i'),
  new RegExp(String.raw`\b${NO_NEED}(?:\s+to)?\s+(?:contact|contacting|tell|telling|see|seeing|speak to|speaking to|talk to|talking to|bother|bothering|ask|asking|alert|alerting|inform|informing)\b[^.?!]{0,30}\b(?:team|doctor|nurse|oncologist|consultant|clinic|hospital|gp|them)\b`, 'i'),
];
// Softer claims keep the reply and get a caution line.
const CAUTION_CLAIMS = [/\bcure[sd]?\b/i, /\bdiagnos(e|is|ed)\b/i, /\bguarantee/i, /\bwill (prevent|heal|stop)\b/i];

export const ASK_FIRST = 'Please ask your care team before changing anything about your treatment.';
const CAUTION = 'Please check this with your care team before acting on it.';

/** Checks a reply before it reaches the person; dashes are rewritten to match the app's house style. */
export function lintReply(text = '') {
  const clean = String(text ?? '')
    .replace(/(\d)\s*[–—]\s*(\d)/g, '$1 to $2')
    .replace(/\s*[—–]\s*/g, ', ')
    .trim();
  const read = straighten(clean).replace(/[*_`]/g, '');
  if (ASK_FIRST_CLAIMS.some((re) => re.test(read))) return { text: ASK_FIRST, flagged: true };
  const flagged = CAUTION_CLAIMS.some((re) => re.test(read));
  return { text: flagged ? `${clean}\n\n${CAUTION}` : clean, flagged };
}
