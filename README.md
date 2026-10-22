# Ahead

**Skin and self-image care through cancer treatment, built on the YouCam API.**

Most people starting chemotherapy, radiation or targeted therapy are told their skin, hair and brows will change. Very few are told what that will look like, which changes are normal, or what to buy. Ahead is a mobile web app that fills that gap:

- **Skin Watch.** A weekly selfie is scored on eight signals by YouCam AI Skin Analysis. Ahead filters out photo-to-photo noise, then reads what's left in light of *your* treatment and week: what it commonly means, what to do, and when to tell your care team.
- **Gentle shelf.** Every product's ingredient list is checked against your treatment and your latest check-in. The shelf changes as your skin does.
- **Hair & brows.** Before hair changes, one selfie saves a Hair & Brow Print (hair colour, brow colour, brow shape, face shape). Try wig styles on yourself, recreate your own brows if they thin, and print a fitting sheet for your wig specialist.
- **Care-team summary.** Scores, notes and questions on one printable page for your next appointment.

<p>
  <img src="docs/screenshots/2-today-road-ahead.png" width="200" alt="Today screen with the treatment timeline">
  <img src="docs/screenshots/3-checkin-result-care-team.png" width="200" alt="Check-in result telling the user to contact their care team">
  <img src="docs/screenshots/6-shelf-blocked-products.png" width="200" alt="Shelf blocking benzoyl peroxide for an EGFR-inhibitor rash">
  <img src="docs/screenshots/7-hair-brow-print.png" width="200" alt="Hair and brow print">
</p>

## The problem, specifically

A generic skin app sees a falling "acne" score and sells you benzoyl peroxide. For someone on an EGFR inhibitor (cetuximab, erlotinib, osimertinib and others), an acne-like rash in the first weeks is one of the most common side effects, and **over-the-counter acne products such as benzoyl peroxide and salicylic acid can make it worse**. Care teams want to hear about it early, because they treat it with specific prescriptions.

Ahead encodes that kind of treatment-specific knowledge:

| You're on | Your check-in shows | A generic app says | Ahead says |
| --- | --- | --- | --- |
| EGFR inhibitor, week 2 | "Clear skin" down 12 | Try this acne treatment | Likely the EGFR rash. Tell your care team now. Acne actives are moved to *Not right now* with the reason. |
| Chemotherapy, week 3 | "Hydration" down 8 | Try this serum | Common with chemo. Short lukewarm washes, fragrance-free cream with ceramides. Retinoids and acids go to *Use with care*. |
| Radiation (head/neck), week 3 | "Calm skin" down 13 | Try a calming toner | Common radiation skin reaction. Tell your radiation team, and don't apply products shortly before a session unless they say so. |
| Hormone therapy | "Clear skin" down 15 | Try this acne treatment | Not a typical pattern for your treatment. Keep checking in; mention it if it continues. |
| Anything | A 4-point dip | You're getting worse | Steady: that's within normal photo-to-photo variation. |

Hair is the other half. Wig specialists advise choosing a wig **before** hair loss so it can be matched to your natural colour and style, and many shops won't take a wig back once it has been worn. Ahead lets you try styles on yourself at home, save a colour-accurate record of your hair and brows, and produce a cranial-prosthesis prescription request for insurance.

## YouCam APIs used

| Feature | Endpoint | How Ahead uses it |
| --- | --- | --- |
| File API | `POST /s2s/v2.0/file` + presigned `PUT` | Every photo is registered, then uploaded to the presigned URL (both legs; skipping the PUT fails later as an internal error). |
| AI Skin Analysis v2.1 | `POST/GET /s2s/v2.1/task/skin-analysis` | 8 concerns (`moisture, redness, acne, texture, radiance, age_spot, oiliness, dark_circle`), HD (`hd_*`) when the framed photo is ≥1080 px on the short side, otherwise SD. Never mixed in one request, and HD and SD trend lines are never compared with each other. `format: "json"`, raw masks (`enable_mask_overlay: false`) blended in the app per concern. |
| AI Facial Color Tones Analyzer | `POST/GET /s2s/v2.0/task/skin-tone-analysis` | Hair, brow, skin, eye and lip colour for the Hair & Brow Print. |
| AI Face Attributes & Ratio Analyzer | `POST/GET /s2s/v2.0/task/face-attr-analysis` | `faceShape`, `eyebrowShape`, `eyebrowThickness` for the print, wig tips and brow recreation. |
| AI Hairstyle Virtual Try-On v2.1 | `POST/GET /s2s/v2.1/task/hair-transfer`, `GET /s2s/v2.1/task/template/hair-transfer` | Wig try-on from YouCam's style templates, or from **any shop's wig photo** (`ref_file_url`). "Keep my natural colour" sets `hair_color: "src"`. |
| AI Makeup Virtual Try-On | `POST/GET /s2s/v2.0/task/makeup-vto` | Brow recreation: an `eyebrows` effect with the pattern nearest the user's measured brow shape (`eyebrows.json` catalog), their measured brow colour and thickness. `skin_smooth` is explicitly set to 0 so the rest of the face is not retouched. |
| Units | `GET /s2s/v1.0/client/credit` | Remaining units shown in Settings. |

Request and response shapes follow Perfect Corp's published OpenAPI documents. Polling backs off from 1.5 s to 6 s and always runs to completion, since an abandoned task still consumes units. Result URLs expire after about two hours, so the server downloads masks and try-on images immediately and hands them to the browser.

## How it works

```
Phone browser (React, IndexedDB)            Ahead server (Node/Express)           YouCam API
──────────────────────────────────          ───────────────────────────           ──────────
camera / upload → face-oval framing  ──JPEG──▶ /api/upload  ── File API + PUT ──▶  storage
  (face ≈78% of width, 3:4 crop,               /api/skin/analyze ─ task + poll ─▶ skin-analysis
   face-brightness reading)                    /api/print ── tone + face-attr ──▶ (parallel)
                                               /api/hair/try-on ───────────────▶ hair-transfer
journal: check-ins, print, looks  ◀─scores,──  /api/brows/try-on ──────────────▶ makeup-vto
  (never stored on the server)      masks       downloads signed results, no storage
core/ rule engines run in the browser:
  trends.js · insights.js · ingredients.js · treatments.js
```

- **Noise-aware trends** (`core/trends.js`). Public retake tests on YouCam skin analysis show raw scores moving about 1 to 2 points between photos taken minutes apart in the same light, and up to about 4 across evenings. Ahead calls a change real only at 6+ raw points ("a lot" at 12+). It compares raw scores, not the friendlier `ui_score`, and it measures face brightness at capture and warns when lighting differs by more than 15% from the baseline.
- **Treatment knowledge** (`core/treatments.js`). Five treatment classes, each with the skin, hair and brow effects patients commonly report and their typical timing, which concern score they move, what to avoid and what helps, and when a change should go to the care team.
- **Watch notes** (`core/insights.js`). These combine the comparison with the person's treatments and week. One side effect that moves several scores becomes one note; anything else is reported as "not typical for your treatment" rather than guessed at.
- **Ingredient rules** (`core/ingredients.js`). Parses INCI lists (handling parenthesised names and percentages) into classes such as fragrance, essential oils, drying alcohol, retinoids, AHA/BHA, benzoyl peroxide, scrubs, ceramides, humectants and mineral SPF. Ranks any catalog into *Good for you now*, *Use with care* and *Not right now*, each with reasons and highlighted ingredients. The demo store ("Shelfside") is fictional; a retailer only needs to supply ingredient lists.
- **Capture** (`web/src/components.jsx`). Camera or upload, with a face oval that guarantees YouCam's "face wider than 60% of the image" requirement, a live light check, and a ghost of the baseline photo so weekly photos line up.

## Privacy and safety

- Photos, scores and looks live in the browser's IndexedDB. The server is a stateless proxy; the YouCam key never reaches the browser.
- Photos are sent to YouCam only when the user runs a check-in or try-on, after explicit consent. YouCam retains uploaded files for a limited period ([File Retention Period](https://docs.perfectcorp.com/develop/file_retention_period)).
- Ahead does not diagnose. Every escalation is phrased as "tell your care team", red-flag symptoms are always one tap away, and the user can export or delete everything from Settings.
- For public demos: `APP_ACCESS_CODE` gates the API, `PER_IP_DAILY_LIMIT` caps paid tasks per IP per day, uploads are checked by magic bytes and pixel size before any units are spent, and reference URLs must be public `https://` (no private hosts).

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
| `npm test` | Unit tests: YouCam client against a fake API, rule engines, HTTP API |
| `npm run smoke -- face.jpg [portrait.jpg]` | Live check of every YouCam call with your key (spends units) |

Deploy: `render.yaml` is a one-click Render blueprint. Any Node host works: build with `npm run build` and start with `npm start`, with `YOUCAM_API_KEY` (and optionally `APP_ACCESS_CODE`) set.

## Testing instructions for judges

1. Open the deployed link (or run locally). If asked, enter the access code from the submission's testing notes under **Settings**.
2. Tap **Explore a sample journey first**. On **Today**, the road-ahead timeline shows week 3 of an EGFR-inhibitor + chemotherapy course.
3. Open **Details** on the red note: the falling "Clear skin" score is read as the EGFR rash, with care-team guidance. Then open **Shelf**: benzoyl peroxide, salicylic acid and fragranced products sit under *Not right now* with reasons.
4. Run a real check-in: **Skin → Start a check-in**, use the camera or upload a selfie, frame it in the oval, then **Analyse my skin**. Tap a score to see YouCam's detection mask for it.
5. **Hair & brows**: make a print, try a wig style (or paste any shop's wig image URL), preview your brows, then open the fitting sheet.
6. **Today → Open summary** for the printable care-team page.

## Clinical grounding

The wording in `core/treatments.js` is deliberately conservative and draws on:

- NCODA, *Managing EGFR Inhibitor Induced Rash* (Positive Quality Intervention, 2025): don't treat the rash with acne products such as benzoyl peroxide or salicylic acid.
- Lacouture et al., *Clinical practice guidelines for the prevention and treatment of EGFR inhibitor-associated dermatologic toxicities*, Supportive Care in Cancer, 2011 (MASCC).
- U.S. Pharmacist, *Epidermal Growth Factor Receptor Inhibitors and Skin Rash*.
- Huntsman Cancer Institute, *Hair loss from chemo: what to expect* (2022), and Providence, *Does hair grow back after chemotherapy?*: hair loss timing; choose a wig before hair loss.
- *Understanding radiation dermatitis*, American Nurse; and radiation dermatitis guideline reviews (don't apply topicals shortly before a session).
- Blue Cross Blue Shield of Rhode Island, *Wig Mandate* policy: cranial prosthesis coverage, HCPCS A9282.

Ahead is not a medical device and does not provide medical advice.

## Project layout

```
core/        shared, framework-free logic (also unit-tested in Node)
server/      Express API, YouCam client, demo mode, error mapping
web/         React app (Vite): screens/, components.jsx, lib/ (IndexedDB, API, image prep)
test/        node:test suites
scripts/     live smoke test
docs/        screenshots, demo video script, submission text
```

## Licence

MIT. YouCam is a trademark of Perfect Corp.; this project is an independent hackathon entry.
