# Devpost submission text (draft)

**Name:** Still Me

**Tagline:** Skin, hair and brow care through cancer treatment: see which skin changes matter, keep your own look on record, and try what comes next, so you still look like you.

**Track:** Skin AI and eCommerce VTO together, with a companion agent that uses YouCam's MCP servers.

Built for people starting chemotherapy, radiation or targeted therapy. Still Me stops the shelf from selling acne actives for a drug rash, and lowers the risk of a wig that can't be matched or returned once worn.

## For the judges, in one minute

- **Technological implementation:** 10 YouCam AI features, 6 over REST and 4 through YouCam's hosted MCP servers (beauty and fashion), plus live unit prices read through MCP. A companion agent calls Still Me's own rule engines as tools and proposes try-ons that run only after a tap. Every YouCam task is deleted once its result is downloaded. 72 automated tests, a live smoke test, a public repo.
- **Design:** one journey for one person, from a print of their own hair and brows before treatment, through weekly skin and hair checks, to try-ons and printable pages for the wig fitter, the insurer and the care team. Mobile first.
- **Potential impact:** the moment a generic skin app gets wrong. On an EGFR inhibitor, an acne-like rash is a common side effect, and over-the-counter acne products can make it worse. Still Me reads the same score drop as "tell your care team", and moves those products to *Not right now*.
- **Quality of idea:** YouCam's try-ons used to keep a person recognisable to themselves: their own brows drawn back on, a wig in their own colour, earrings to frame the face, and a preview of how hair often grows back after chemotherapy.

## Inspiration

Skin, hair and brow changes are among the most visible side effects of cancer treatment, and they arrive while people are least able to research them. Patient guides say what *can* happen. They can't tell you whether the change on your face this morning is the expected one, whether the product in your basket will make it worse, or what you'll look like in a wig you can't return once worn. We wanted to meet people at those moments: before their hair changes, in front of the mirror, and before a purchase.

## What it does

- **Hair & Brow Print:** before hair changes, **Facial Color Tones Analyzer** + **Face Attributes Analyzer** record hair colour family, brow and skin colour, brow shape and thickness, and face shape. If the hair colour is misread in bright light, the person can correct it and the fitting sheet marks it.
- **Hair watch (new, via MCP):** a weekly photo of the parting and crown, scored by **Hair Density Detection** and kept by treatment week. When thinning starts, Still Me suggests a short cut and a wig fitting while the print still matches.
- **Wig try-on:** **Hairstyle Virtual Try-On** with YouCam templates or any shop's wig photo, then **Hair Color** (via MCP) paints it in the person's own colour family.
- **Brows, lashes, lips:** **Makeup Virtual Try-On** draws the person's own measured brow shape and colour back on, with skin smoothing off, and picks the closest brow pencil (CIEDE2000).
- **Earrings (new, via MCP):** **Earrings Virtual Try-On** from any shop's product photo, on the person's own unchanged portrait.
- **How your hair might grow back (new, via MCP):** **Wavy Hair** then **Hair Color** on the person's portrait, shown as an illustration, not a prediction.
- **Hats and caps:** **Hat Virtual Try-On**, honestly labelled as a new styled photo.
- **Skin Watch:** a weekly selfie scored by **AI Skin Analysis** (8 concerns, HD or SD, masks). Changes within photo-to-photo noise are ignored and the light is checked; real changes are read against the person's treatment and week, with "tell your care team" when it matters.
- **Gentle shelf and My list:** every product's INCI list is ranked against the person's treatment and latest check-in, with reasons and the offending ingredients highlighted.
- **Ask Still Me (new):** a companion agent. Ask "my face is tight and has spots, what can I use?" and it calls the skin and shelf tools; ask for "a look for my daughter's wedding in week 6" and it plans a wig in your colour, brows and lips with the live unit cost, which you run with one tap, then keep or reject. It remembers what you keep and what you say you prefer, on your device. Red-flag symptoms are caught by rules before the model answers.
- **Fitting sheet, insurance letter and care-team summary:** printable pages for the wig specialist, the insurer ("cranial prosthesis", HCPCS A9282) and the oncology team.

**For retailers:** the measured brow colour picks the closest brow pencil; wig, hat and earring try-ons run on any shop's product photo; and a shop's feed plugs into the shelf, My list and the pencil match. See docs/RETAILER.md.

## How we built it

A React (Vite) mobile web app with an on-device journal (IndexedDB), and a Node/Express server that holds the YouCam key and talks to YouCam two ways:
- over REST: the File API, the async task, poll and delete flow, and the template APIs;
- over MCP: a small streamable-HTTP client for YouCam's beauty and fashion MCP servers, which runs Hair Color, Wavy Hair, Hair Density and Earrings by file id and reads live prices with Get-Feature-Cost.

The companion agent runs on Claude through KIE's Anthropic-compatible API, with an automatic fallback to GPT-6 Luna. Its 10 tools wrap Still Me's framework-free rule modules, which the browser and the tests share:
- a noise-aware trend model;
- a treatment knowledge base;
- a watch-note rule engine;
- an INCI ingredient classifier;
- CIEDE2000 colour matching.

The server keeps unit and chat budgets per IP and per server. A demo mode and a labelled sample journey let anyone explore without spending units, and `npm run smoke` runs the REST calls live.

## Challenges

- **Telling skin change from camera change.** Still Me compares YouCam's raw scores, sets thresholds above published retake variation, keeps HD, SD and sample trend lines apart, and asks for a retake before escalating a borderline change in different light.
- **Framing real photos.** Close-up selfies can be zoomed out inside the oval, and the crop widens to keep HD when the photo allows.
- **An agent that can't make things up.** Facts come only from tools; paid try-ons are proposals until the person taps; replies with medical claims get a caution line; red flags are matched by rules first.
- **MCP in practice.** Some MCP tools want a different request shape from the REST docs (Earrings needs file ids both at the top level and in its info blocks), and every tool streams progress before its result.

## What we learned

The difference between a skin score and a skin *decision* is context. The same drop in "clear skin" means "buy an acne cleanser" for one person and "call your oncologist, and don't buy that cleanser" for another.

## What's next

Clinician-reviewed content per drug, live Shopify or CSV catalog import, multilingual support, and a version co-designed with oncology nurses and patient groups.

## Built with

YouCam API (AI Skin Analysis, Facial Color Tones Analyzer, Face Attributes & Ratio Analyzer, Hairstyle Virtual Try-On, Hat Virtual Try-On, Makeup Virtual Try-On) and YouCam MCP servers (Hair Color, Wavy Hair, Hair Density Detection, Earrings Virtual Try-On, Get-Feature-Cost), Claude and GPT through KIE, React, Vite, Node.js, Express, IndexedDB.

## Testing instructions

See "Testing instructions for judges" in the README. Live demo: `https://ahead-skinai.onrender.com/?code=<access code>`. It runs on a free instance that sleeps when idle, so the first load can take about a minute.
