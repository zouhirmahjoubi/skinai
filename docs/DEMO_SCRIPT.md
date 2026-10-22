# Demo video script (target 2:50, hard limit 3:00)

Record on a phone, the device Ahead is built for, using screen recording plus a few seconds of the phone in hand at the mirror. Run the server **with your YouCam key** so analysis and try-ons are live. Use no music, or royalty-free music you have the rights to. Don't show third-party logos or brands: the store in the app is fictional, and any wig or hat photo you use must be your own or licensed.

Before recording:
- Run `npm run smoke` once, so every call has been tried live.
- Pick one wig photo of a model facing forward (JPEG, 1024 px or less) and one hat product photo (at least 512 px).
- Load the sample journey in a second browser profile, so you can cut to week 3.

| Time | On screen | Voice-over |
| --- | --- | --- |
| 0:00–0:15 | Phone at the mirror, then Hair & brows with a finished wig try-on; drag the compare slider | "When you start cancer treatment, you're told your skin, hair and brows will change. Nobody shows you what that will look like, which changes matter, or what's safe to buy. Ahead does." |
| 0:15–0:25 | Fast cut of setup: *EGFR inhibitor* + *Chemotherapy*, start date in 3 days, consent | "You tell it your treatment and start date. Everything stays on your phone; photos go to the YouCam API only when you ask." |
| 0:25–1:05 | Make the print (colour swatches, face shape, brow shape) → a wig template marked *Can keep your colour* → compare slider → add the shop wig photo → *Save to my looks* | "Before hair changes, one selfie saves your Hair & Brow Print with YouCam's Facial Color Tones and Face Attributes analysis. Then try wigs on yourself with YouCam Hairstyle Try-On, from YouCam's styles in your own colour, or from any shop's wig photo, before buying a wig most shops won't take back once it's been worn." |
| 1:05–1:20 | Brow preview with the "closest pencil" chip, then a hat photo in the head-coverings section | "If your brows thin, YouCam Makeup Try-On draws your own measured brow shape and colour back on, with retouching switched off, and picks the brow pencil closest to your colour. Not everyone wants a wig, so YouCam Hat Try-On does caps and hats too." |
| 1:20–1:40 | Baseline check-in: oval guide, light check, results; tap a score to show the mask | "Each week, a selfie goes through YouCam AI Skin Analysis: eight signals with detection masks, framed so YouCam's size rule is always met, with the light recorded so photos stay comparable." |
| 1:40–2:20 | Sample journey, week 3: red *Tell your care team* note → Shelf with benzoyl peroxide under *Not right now* and the saved acne gel flagged "Check again" | "Three weeks in, the clear-skin score drops 17 points. A normal skin app would sell you acne cream. On an EGFR inhibitor, that's the drug's rash, and acne products can make it worse. Ahead says call your care team, and the shelf blocks acne actives and fragrance, with the exact ingredient highlighted, including the gel Sam had already saved." |
| 2:20–2:50 | Fitting sheet, insurance letter, care-team summary print preview | "Your looks and print go on a fitting sheet for your wig specialist, with an insurance letter, and a one-page summary, including the products you plan to use, goes to your care team. Ahead: stay a step ahead of what treatment changes." |

YouCam APIs to name aloud: AI Skin Analysis, Facial Color Tones Analyzer, Face Attributes Analyzer, Hairstyle Virtual Try-On, Hat Virtual Try-On, Makeup Virtual Try-On (eyebrows).
