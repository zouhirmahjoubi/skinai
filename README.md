# Ahead

**Skin, hair and brow care through cancer treatment, built on the YouCam API.**

**Live demo:** https://ahead-skinai.onrender.com (the access code is in the submission).

Most people starting chemotherapy, radiation or targeted therapy are told their skin, hair and brows will change. Very few are told what that will look like, which changes matter, or what is safe to buy. Ahead is a mobile web app for that moment:

- **Hair & Brow Print.** Before hair changes, one selfie records hair colour family, brow colour, brow shape, brow thickness and face shape, using YouCam Facial Color Tones and Face Attributes analysis.
- **Try-before-you-buy for hair loss.**
  - Wig styles on your own face, from YouCam templates or any shop's wig photo.
  - Hats, caps and headbands from any shop.
  - Your own brows drawn back on, with the brow pencil closest to your measured colour.
  - A printable fitting sheet for your wig specialist.
- **Skin Watch.** A weekly selfie is scored on eight signals by YouCam AI Skin Analysis. Ahead filters out photo-to-photo noise, then reads what's left in light of *your* treatment and week: what it commonly means, what to do, and when to tell your care team.
- **Gentle shelf.** Every product's ingredient list is checked against your treatment and latest check-in, and products can be saved to a list your care team can check.
- **Care-team summary.** Scores, notes, questions and planned products on one printable page.

<p>
  <img src="docs/screenshots/7-hair-brow-print.png" width="180" alt="Hair and brow print with measured colours and face shape">
  <img src="docs/screenshots/3-checkin-result-care-team.png" width="180" alt="Check-in result telling the user to contact their care team">
  <img src="docs/screenshots/6-shelf-blocked-products.png" width="180" alt="Shelf moving benzoyl peroxide to Not right now for an EGFR-inhibitor rash">
  <img src="docs/screenshots/2-today-road-ahead.png" width="180" alt="Today screen with the treatment timeline">
</p>

> These screenshots were taken in demo mode and with the labelled sample journey, without a YouCam key. See the demo video for live YouCam results (masks, wig, hat and brow try-ons).

## The problem, specifically

A generic skin app sees a falling "acne" score and sells you benzoyl peroxide. For someone on an EGFR inhibitor (cetuximab, erlotinib, osimertinib and others), an acne-like rash in the first weeks is one of the most common side effects, and **over-the-counter acne products such as benzoyl peroxide and salicylic acid can make it worse**. Care teams want to hear about it early, and guidelines recommend asking about preventive skin care from the first dose.

Ahead encodes that kind of treatment-specific knowledge:

| You're on | Your check-in shows | A generic app says | Ahead says |
| --- | --- | --- | --- |
| EGFR inhibitor, week 2 | "Clear skin" down 12 | Try this acne treatment | Likely the EGFR rash. Tell your care team now. Acne actives are moved to *Not right now* with the reason. |
| Chemotherapy, week 3 | "Hydration" down 8 | Try this serum | Common with chemo. Short lukewarm washes, fragrance-free cream with ceramides. Retinoids and acids go to *Use with care*. |
| Radiation (head/neck), week 3 | "Calm skin" down 13, or "Even tone" down | Try a calming toner | Common radiation skin reaction (on brown or black skin it often shows as darkening). Tell your radiation team and ask what to put on the treated area. |
| Hormone therapy | "Clear skin" down 15 | Try this acne treatment | Not on Ahead's list for your treatment. Keep checking in, and tell your care team if it continues, hurts or spreads. |
| Anything, in different light | A borderline drop | You're getting worse | Retake in your usual light first. Ahead measures face brightness at capture. |
| Anything | A 4-point dip | You're getting worse | Steady: that's within normal photo-to-photo variation. Ahead still reminds you it only sees your face. |

Hair is the other half. Wig specialists advise choosing a wig **before** hair loss, so it can be matched to your natural colour and style, and many shops won't take a wig back once it has been worn. Ahead also prompts people to ask about scalp cooling before their first infusion, and drafts a cranial-prosthesis prescription request for insurance.

## YouCam APIs used

| Feature | Endpoint | How Ahead uses it |
| --- | --- | --- |
| File API | `POST /s2s/v2.0/file` + presigned `PUT` | Every photo is registered, then uploaded to the presigned URL. Both steps are required: skipping the PUT only fails later, as an internal error. |
| AI Skin Analysis v2.1 | `POST/GET /s2s/v2.1/task/skin-analysis` | Measures 8 concerns: moisture, redness, acne, texture, radiance, age_spot, oiliness and dark_circle.<br>• HD (`hd_*`, 16 units) when the framed photo is at least 1080 px on the short side, otherwise SD (12 units).<br>• HD and SD are never mixed in one request, and their trend lines are never compared with each other.<br>• `format: "json"` with raw masks (`enable_mask_overlay: false`); the app blends each concern's mask itself. |
| Delete task | `POST /s2s/v2.0/task/delete` | After a check-in's scores and masks are downloaded, Ahead asks YouCam to delete the task, its input photo and its outputs. |
| AI Facial Color Tones Analyzer | `POST/GET /s2s/v2.0/task/skin-tone-analysis` | Hair colour family, brow, skin, eye and lip colour for the Print. On deeper skin tones the measured skin colour adds a note that redness scores can miss irritation, for treatments whose side effects Ahead reads from redness. It does not change alert levels. |
| AI Face Attributes & Ratio Analyzer | `POST/GET /s2s/v2.0/task/face-attr-analysis` | `faceShape`, `eyebrowShape` and `eyebrowThickness` for the Print, wig tips and brow recreation. |
| AI Hairstyle Virtual Try-On v2.1 | `POST/GET /s2s/v2.1/task/hair-transfer`, `GET /s2s/v2.1/task/template/hair-transfer` | Wig try-on from YouCam templates, or from any shop's wig photo.<br>• "Keep my natural colour" sends `hair_color: "src"`, and is only offered on templates whose `keep_users_color` is true.<br>• Shop photos are re-encoded in the browser to JPEG (1024 px or less) or fetched by the server from a pasted link. Either way they are checked, then uploaded as `ref_file_id`, and keep the wig's own colour. |
| AI Hat Virtual Try-On | `POST/GET /s2s/v2.0/task/hat` | Hats, caps and headbands from any shop's product photo (at least 512 px).<br>• The user picks the styling (`gender`); it is never inferred from the photo.<br>• The output restyles outfit and background, so it is shown as a styled preview, not a before/after slider. |
| AI Makeup Virtual Try-On | `POST/GET /s2s/v2.0/task/makeup-vto` | Brow recreation: an `eyebrows` effect with the pattern nearest the user's measured brow shape (`eyebrows.json` catalog) and their measured brow colour.<br>• `thickness: 0` keeps their own thickness, since makeup-vto thickness is relative to the brow in the photo.<br>• `skin_smooth` is set to 0, so the rest of the face is not retouched.<br>• Brows can be drawn on a photo of today without overwriting the pre-treatment Print.<br>• Optional `eyelashes` (three `eyelashes.json` styles), under-eye `concealer` in the measured skin tone and satin `lip_color` (measured lip colour or two shades) ride in the same task, which costs 1 unit however many effects it applies. |
| Units | `GET /s2s/v1.0/client/credit` | Remaining units (`amount_dec`), shown in Settings and checked at boot. |

Request and response shapes follow Perfect Corp's published OpenAPI documents, and were cross-checked against the request and response schemas in Perfect Corp's official CLI package (`@youcam_cli/youcam-cli`), using the [REA](https://github.com/morluto/rea) static analyser to map its client modules: every path, version, field and enum Ahead sends matches. Requests time out after 30 s. Polling backs off from 1.5 s to 6 s. Rate-limited polls (429) keep backing off, up to 15 s apart, until a 150 s deadline; network and 502–504 errors are retried four times in a row. A task given up on is counted as billed, since an abandoned task can still consume units. Result URLs expire after about two hours, so the server downloads masks and try-on images immediately and hands them to the browser.

## How it works

```
Phone browser (React, IndexedDB)            Ahead server (Node/Express)           YouCam API
──────────────────────────────────          ───────────────────────────           ──────────
camera / upload → face-oval framing  ──JPEG──▶ /api/upload  ── File API + PUT ──▶  storage
  (face ≈78% of width, 3:4 crop,               /api/skin/analyze ─ task + poll ─▶ skin-analysis
   face-brightness reading)                      └─ download masks, delete task ─▶ task/delete
                                               /api/print ── tone + face-attr ──▶ (parallel)
journal: check-ins, print, looks,  ◀─scores,── /api/hair|hat|brows/try-on ─────▶ hair-transfer,
  saved list (never on the server)    masks     (shop links fetched + checked)     hat, makeup-vto
core/ rule engines run in the browser:
  trends.js · insights.js · ingredients.js · treatments.js · color.js
```

- **Noise-aware trends** (`core/trends.js`). Published retake tests on YouCam skin analysis ([youcam-claim-guard](https://github.com/StuartYo/youcam-claim-guard), "Noise floor") report raw-score SDs of about 1–2 points between photos taken minutes apart in the same light, and up to about 3.75 across evenings.
  - Ahead calls a change real only at 6+ raw points, and "a lot" at 12+.
  - It compares raw scores, not the friendlier `ui_score`.
  - It never compares HD with SD, or the sample journey with real check-ins.
  - It measures face brightness at capture. When the light differs by more than 15% from the baseline, a borderline care-team alert becomes "retake first".
- **Treatment knowledge** (`core/treatments.js`). Five treatment classes, each with:
  - the skin, hair and brow effects patients commonly report, and their typical timing;
  - which concern scores they move;
  - what to avoid and what helps;
  - when a change should go to the care team.
- **Watch notes** (`core/insights.js`). These combine the comparison with the person's treatments, week and measured skin tone. One side effect that moves several scores becomes one note. Anything else is reported as "not on Ahead's list for your treatment", without guessing a cause. A "steady" result still says the camera only sees the face.
- **Ingredient rules** (`core/ingredients.js`).
  - Parses INCI lists into classes: fragrance, essential oils, drying alcohol, retinoids, AHA/BHA, benzoyl peroxide, scrubs, ceramides, humectants, and mineral SPF (only on products labelled SPF 30+).
  - Ranks any catalog into *Good for you now*, *Use with care* and *Not right now*, with reasons and the offending ingredients highlighted.
  - The demo store ("Shelfside") is fictional; a retailer only needs to supply ingredient lists (see [docs/RETAILER.md](docs/RETAILER.md)).
- **Colour matching** (`core/color.js`). CIEDE2000 between measured brow colour and brow-pencil shades. The implementation is checked against the Sharma et al. reference pair in the tests.
- **Capture** (`web/src/components.jsx`).
  - Camera or upload, with a face oval that meets YouCam's "face wider than 60% of the image" rule.
  - On 720p webcams the crop widens just enough to keep SD's 480 px minimum.
  - A live light check, and a ghost of the baseline photo so weekly photos line up.

## Privacy and safety

- Photos, scores, looks and the saved list live in the browser's IndexedDB, which Ahead asks the browser to keep persistent. Journals can be downloaded and restored from Settings. The server is a stateless proxy, and the YouCam key never reaches the browser.
- Photos are sent to YouCam only when the user runs a check-in or try-on, after explicit consent. Ahead asks YouCam to delete each check-in photo and its results as soon as they are downloaded (`POST /s2s/v2.0/task/delete`). Other uploads expire under YouCam's [retention period](https://docs.perfectcorp.com/develop/file_retention_period), up to 30 days.
- Ahead does not diagnose. Every escalation is phrased as "tell your care team", and the red-flag list (including fever thresholds during chemotherapy and signs of an allergic reaction) is open on Today and on every escalated result. The user can export or delete everything from Settings.
- Hardening for public demos:
  - `APP_ACCESS_CODE` gates every route that can spend units. Use a long random value; judges can be given `https://host/?code=...`.
  - `PER_IP_DAILY_UNITS` and `DAILY_UNIT_BUDGET` cap YouCam units per IP and for the whole server per day. Requests answered with a 4xx are refunded: validation errors, and tasks YouCam reports as failed, which it doesn't charge. Server errors, and tasks that timed out or lost contact mid-poll, stay counted, since YouCam may still bill them.
  - `TRUST_PROXY` must match the number of proxies in front of the server, so the per-IP limit can't be bypassed with a forged `X-Forwarded-For`.
  - Uploads are checked by magic bytes and pixel size before any units are spent.
  - Pasted shop links are fetched only from public https hosts (every redirect hop is resolved and private addresses are refused), streamed with a 10 MB cap, counted against the per-IP upload limit, and checked against YouCam's limits. Demo mode never fetches them.
  - Production responses carry a strict Content-Security-Policy, `nosniff`, `X-Frame-Options: DENY` and a camera-only Permissions-Policy.

## Run it

Requires Node 18.17+.

```bash
git clone https://github.com/zouhirmahjoubi/skinai.git
cd skinai
npm install
cp .env.example .env      # add YOUCAM_API_KEY for live analysis
npm run dev               # http://localhost:8787
```

Without `YOUCAM_API_KEY` the app runs in **demo mode**: everything works, but results are simulated and clearly labelled. **Explore a sample journey** on the first screen loads three weeks of an EGFR-inhibitor course, so you can see the care-team escalation and the shelf rules without spending units.

| Command | What it does |
| --- | --- |
| `npm run dev` | Server and Vite dev middleware on one port |
| `npm run build && npm start` | Production build served by the same server |
| `npm test` | Unit tests: YouCam client against a fake API, rule engines, colour maths, HTTP API |
| `npm run smoke -- face.jpg [portrait.jpg] [hat.jpg]` | Live check of every YouCam call with your key (spends units). With `RECORD_DIR=test/fixtures`, it saves redacted responses for `test/live-shape.test.js`. |

Deploy: `render.yaml` is a one-click Render blueprint. Any Node host works: build with `npm run build` and start with `npm start`, with `YOUCAM_API_KEY`, `APP_ACCESS_CODE` and `TRUST_PROXY` set.

## Testing instructions for judges

1. Open https://ahead-skinai.onrender.com with the access code from the submission (`/?code=...`). It runs on a free instance that sleeps when idle, so the first load can take about a minute. Locally, run `npm run dev`.
2. Tap **Explore a sample journey first**. On **Today**, the road-ahead timeline shows week 3 of an EGFR-inhibitor + chemotherapy course.
3. Open **Details** on the red note: the falling "Clear skin" score is read as the EGFR rash, with care-team guidance. Then open **Shelf**: benzoyl peroxide, salicylic acid and fragranced products sit under *Not right now* with reasons, and the acne gel Sam saved in week 1 is flagged "Check again".
4. **Hair & brows** (the sample print has no photo):
   - Tap **Retake** to make your own print.
   - Try a wig style, or add any shop's wig photo.
   - Try a hat photo.
   - Preview your brows, then open the fitting sheet.
5. Run a real check-in: **Skin → Start a check-in**, use the camera or upload a selfie, frame it in the oval, then **Analyse my skin**. It starts its own trend line and is never compared with the sample. Tap a score to see YouCam's detection mask for it.
6. **Today → Open summary** for the printable care-team page.

## Clinical grounding

The wording in `core/treatments.js` is deliberately conservative and draws on:

- NCODA, *Managing EGFR Inhibitor Induced Rash* (Positive Quality Intervention, 2025): don't treat the rash with acne products such as benzoyl peroxide or salicylic acid.
- Lacouture et al., *Clinical practice guidelines for the prevention and treatment of EGFR inhibitor-associated dermatologic toxicities*, Supportive Care in Cancer, 2011 (MASCC).
- Lacouture et al., *Prevention and management of dermatological toxicities related to anticancer agents: ESMO Clinical Practice Guidelines*, Annals of Oncology, 2021: pre-emptive skin care and oral tetracyclines from the start of EGFR-inhibitor therapy.
- Lacouture et al., *STEPP*, Journal of Clinical Oncology, 2010: pre-emptive treatment cut grade 2 or worse skin toxicity from 62% to 29%.
- U.S. Pharmacist, *Epidermal Growth Factor Receptor Inhibitors and Skin Rash*.
- Huntsman Cancer Institute, *Hair loss from chemo: what to expect* (2022); Providence, *Does hair grow back after chemotherapy?*; American Cancer Society, *Cold Caps and Scalp Cooling Systems*: hair loss timing, choosing a wig before hair loss, and scalp cooling.
- Behroozian et al., *MASCC clinical practice guidelines for the prevention and management of acute radiation dermatitis*, Lancet Oncology, 2023; Baumann et al., JAMA Oncology, 2018: thin layers of topicals barely change skin dose. Ahead defers to the patient's own radiation team on what to apply and when.
- Blue Cross Blue Shield of Rhode Island, *Wig Mandate* policy: cranial prosthesis coverage, HCPCS A9282. Original Medicare does not cover wigs, and IRS Publication 502 covers medical expenses.

Ahead is not a medical device and does not provide medical advice.

## Project layout

```
core/        shared, framework-free logic (also unit-tested in Node)
server/      Express API, YouCam client, shop-link fetcher, demo mode, error mapping
web/         React app (Vite): screens/, components.jsx, lib/ (IndexedDB, API, image prep)
test/        node:test suites (plus live-response checks once fixtures are recorded)
scripts/     live smoke test
docs/        screenshots, demo video script, submission text, retailer notes
```

## Licence

MIT. YouCam is a trademark of Perfect Corp.; this project is an independent hackathon entry.
