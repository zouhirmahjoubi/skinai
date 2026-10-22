# Devpost submission text (draft)

**Name:** Ahead

**Tagline:** Try wigs, brows and hats on yourself before treatment changes how you look, and know which skin changes, and which products, to bring to your care team.

**Track:** eCommerce VTO (wig, hat and brow try-on), with Skin AI interpreting treatment side effects.

Built specifically for people in cancer treatment. Ahead lowers the risk of a purchase that usually can't be returned once worn (a wig), and it stops the shelf from selling acne actives for a drug rash.

## Inspiration

Skin, hair and brow changes are among the most visible side effects of cancer treatment, and they arrive while people are least able to research them. Patient guides say what *can* happen. They can't tell you whether the change on your face this morning is the expected one, whether the product in your basket will make it worse, or what you'll look like in a wig you can't return once worn. We wanted to meet people at those moments: before their hair changes, in front of the mirror, and before a purchase.

## What it does

- **Hair & Brow Print:** before hair changes, **Facial Color Tones Analyzer** + **Face Attributes Analyzer** record hair colour family, brow and skin colour, brow shape and thickness, and face shape.
- **Wig try-on:** **Hairstyle Virtual Try-On** with YouCam templates (in the user's own colour on templates that support it) or any shop's wig photo (in that wig's colour). Shop links are fetched and checked against YouCam's limits before any units are spent.
- **Head coverings:** **Hat Virtual Try-On** for caps, beanies and sun hats from any shop's product photo.
- **Brow recreation:** **Makeup Virtual Try-On** draws the person's own measured brow shape and colour back on, with skin smoothing forced off. It can render on a photo of today without overwriting the pre-treatment print, and it picks the brow pencil closest to the measured colour (CIEDE2000).
- **Skin Watch:** a guided weekly selfie analysed by **YouCam AI Skin Analysis** (8 concerns, HD/SD, detection masks).
  - Changes within normal photo-to-photo variation are ignored, and the light is checked.
  - Real changes are read against the user's treatment and week. For example, a falling "clear skin" score on an EGFR inhibitor is flagged as the drug's typical rash with "tell your care team", not acne advice that could make it worse.
  - After analysis Ahead asks YouCam to delete the photo.
- **Gentle shelf and My list:** each product's INCI list is parsed and ranked against the person's treatment and latest check-in, with reasons and the offending ingredients highlighted. Saved products go on the care-team summary and are re-checked as the skin changes.
- **Fitting sheet, insurance letter and care-team summary:** printable pages for the wig specialist, the insurer ("cranial prosthesis", HCPCS A9282) and the oncology team.

**For retailers:** measured brow colour picks the closest brow pencil. Wig and hat try-ons run on any shop's product photo the shopper adds (picked from the phone or pasted as a link), and a shop's feed plugs into the shelf, My list and the brow-pencil match with id, name, price, INCI list and, for shade products, a hex colour. See docs/RETAILER.md.

## How we built it

A React (Vite) mobile web app with an on-device journal (IndexedDB), and a small Node/Express server that holds the YouCam key and proxies:
- the File API;
- the async task, poll and delete flow;
- the template APIs.

The server keeps a unit budget per IP and per server. The domain logic lives in framework-free modules shared by the browser and the tests:
- a noise-aware trend model;
- a treatment knowledge base;
- a watch-note rule engine;
- an INCI ingredient classifier;
- CIEDE2000 colour matching.

A demo mode and a labelled sample journey let anyone explore without spending units, and `npm run smoke` runs every YouCam call live. Every request Ahead sends was also cross-checked against the request, response and error schemas in Perfect Corp's official CLI package (`@youcam_cli/youcam-cli`), using the REA static analyser to map its client modules; the paths, versions, fields and enums all match. If one half of the print (colours or face shape) fails, the other half is kept, the user is told why, and the units for the failed half are not counted.

## Challenges

- **Telling skin change from camera change.** One selfie is noisy, so Ahead:
  - compares YouCam's raw scores, not the flattering UI score;
  - sets thresholds above published retake variation;
  - keeps HD, SD and sample trend lines apart;
  - measures face brightness at capture, and asks for a retake before escalating a borderline change in different light.
- **Meeting the APIs' photo requirements without friction.**
  - The capture component frames the face so YouCam's "face wider than 60% of the image" rule is met, and still reaches 480 px on 720p webcams.
  - It produces feature-specific variants: 1024 px or less with shoulders for hairstyle, maximum resolution for HD skin.
  - Shop photos are re-encoded in the browser.
- **Being useful without diagnosing.** Every note is phrased as what is commonly reported, with explicit care-team escalation and a red-flag list that is always open on Today.

## What we learned

The difference between a skin score and a skin *decision* is context. The same drop in "clear skin" means "buy an acne cleanser" for one person and "call your oncologist, and don't buy that cleanser" for another.

## What's next

Clinician-reviewed content per drug, live Shopify/CSV catalog import, multilingual support, and a version co-designed with oncology nurses and patient groups.

## Built with

YouCam API (AI Skin Analysis, Facial Color Tones Analyzer, Face Attributes & Ratio Analyzer, Hairstyle Virtual Try-On, Hat Virtual Try-On, Makeup Virtual Try-On), React, Vite, Node.js, Express, IndexedDB.

## Testing instructions

See "Testing instructions for judges" in the README. Live demo: `<deployed URL>/?code=<access code>` (fill in after deploying).
