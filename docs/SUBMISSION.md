# Devpost submission text (draft)

**Name:** Ahead

**Tagline:** Skin, hair and brow care through cancer treatment: know what's normal, what to buy, and when to call your care team.

**Track:** eCommerce VTO, with Skin AI at the core (both are used).

## Inspiration

Skin, hair and brow changes are among the most visible side effects of cancer treatment, and they arrive while people are least able to research them. Patient guides say what *can* happen. They can't tell you whether the change on your face this morning is the expected one, whether the product in your basket will make it worse, or what you'll look like in a wig you can't return once worn. We wanted to meet people at those moments: in front of the mirror, before a purchase, before their hair changes.

## What it does

- **Skin Watch:** a guided weekly selfie analysed by **YouCam AI Skin Analysis** (8 concerns, HD/SD, detection masks). Ahead ignores changes within normal photo-to-photo variation and checks the light, then interprets real changes against the user's treatment and week. For example, a falling "clear skin" score on an EGFR inhibitor is flagged as the drug's typical rash, with "tell your care team" guidance, instead of acne advice that could make it worse.
- **Gentle shelf:** each product's INCI list is parsed and ranked against the person's treatment and latest check-in into *Good for you now*, *Use with care* and *Not right now*, with reasons and the offending ingredients highlighted. Retailers plug in their own catalog.
- **Hair & Brow Print:** before hair changes, **Facial Color Tones Analyzer** + **Face Attributes Analyzer** record hair, brow and skin colour, brow shape and thickness, and face shape.
- **Wig try-on:** **Hairstyle Virtual Try-On** with YouCam templates, or any shop's wig photo, optionally kept in the user's natural colour.
- **Brow recreation:** **Makeup Virtual Try-On** draws the person's own measured brow shape and colour back on, with skin smoothing forced off.
- **Fitting sheet, insurance letter and care-team summary:** printable pages for the wig specialist, the insurer ("cranial prosthesis", HCPCS A9282) and the oncology team.

## How we built it

A React (Vite) mobile web app with an on-device journal (IndexedDB), and a small Node/Express server that holds the YouCam key and proxies the File API, the async task/poll flow and the template APIs. The domain logic lives in framework-free modules shared by browser and tests: a noise-aware trend model, a treatment knowledge base, a watch-note rule engine and an INCI ingredient classifier. A demo mode and a labelled sample journey let anyone explore without spending units, and `npm run smoke` verifies every live YouCam call.

## Challenges

- **Telling skin change from camera change.** One selfie is noisy. We compare YouCam's raw scores (not the flattering UI score), set thresholds above published retake variation, keep HD and SD trend lines separate, and measure face brightness at capture to warn about lighting.
- **Meeting the APIs' photo requirements without friction.** The capture component frames the face in an oval sized so YouCam's "face wider than 60% of the image" rule is always met, and produces feature-specific variants (≤1024 px with shoulders for hairstyle, maximum resolution for HD skin).
- **Being useful without diagnosing.** Every note is phrased as what is commonly reported, with explicit care-team escalation and always-visible red-flag symptoms.

## What we learned

The difference between a skin score and a skin *decision* is context. The same drop in "clear skin" means "buy an acne cleanser" for one person and "call your oncologist, don't buy that cleanser" for another.

## What's next

Clinician-reviewed content per drug, retailer catalog connectors, multilingual support, and a version co-designed with oncology nurses and patient groups.

## Built with

YouCam API (AI Skin Analysis, Facial Color Tones Analyzer, Face Attributes & Ratio Analyzer, Hairstyle Virtual Try-On, Makeup Virtual Try-On), React, Vite, Node.js, Express, IndexedDB.

## Testing instructions

See "Testing instructions for judges" in the README. If the deployed demo is protected, the access code is: `<fill in>`.
