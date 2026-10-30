# Plugging in a retailer

Still Me's shopping features run on plain product data. To use your own catalog instead of the fictional "Shelfside" store, replace the arrays in `core/catalog.js` (or load them from your feed) with the same fields.

| Field | Used for |
| --- | --- |
| `id`, `name`, `line`, `price`, `size`, `type` (`cleanse`, `moisturise`, `soothe`, `protect`, `treat`) | Display and "My list" |
| `ingredients` (INCI list as printed on the pack) | `core/ingredients.js` classifies it and decides *Good for you now*, *Use with care* or *Not right now* for each shopper, with reasons. No per-product labelling is needed. |
| `spf` (optional) or "SPF 30" in the name | Zinc oxide and titanium dioxide only count as sunscreen on products labelled SPF 30 or higher |
| `hex` (shade products such as brow pencils) | `core/color.js` ranks shades by CIEDE2000 distance to the colour measured by YouCam's Facial Color Tones Analyzer |

## Why try-before-buy matters here

Wigs and many head coverings can't be returned once worn, for hygiene reasons, and people often have to buy them in the two to four weeks before chemotherapy hair loss starts. Running YouCam Hairstyle and Hat try-on on the shop's product photo, which the shopper adds from their phone or pastes as a link, lets someone narrow the choice at home before a fitting or an order. Product photos are not read from the feed yet; an optional `photo` URL per wig or hat would let a "Try on" button pass it straight to the try-on.

## Where products appear

- **Shelf:** ranked for the shopper's treatment and latest check-in. Saving adds the product to **My list**.
- **Care-team summary:** "Products I plan to use: are these OK?", with each product's full ingredient list and anything Still Me flags.
- **Fitting sheet:** the chosen brow pencil, the saved wig and hat try-ons, and the shopper's measured colours.
