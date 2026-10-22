// Demo retailer catalog. "Shelfside" and its product lines are fictional; the
// ingredient lists are realistic INCI lists so the rule engine has real work
// to do. A retailer would swap this for their own feed (same fields).

export const CATALOG = [
  {
    id: 'sg-cream-cleanser', line: 'Shelfside Gentle', name: 'Barrier Cream Cleanser', type: 'cleanse', size: '200 ml', price: 14,
    ingredients: 'Water, Glycerin, Cetearyl Alcohol, Ceramide NP, Ceramide AP, Ceramide EOP, Phytosphingosine, Cholesterol, Sodium Lauroyl Lactylate, Carbomer, Xanthan Gum, Sodium Hyaluronate, Phenoxyethanol, Ethylhexylglycerin',
  },
  {
    id: 'sg-oat-cream', line: 'Shelfside Gentle', name: 'Oat Calm Cream', type: 'moisturise', size: '120 g', price: 16,
    ingredients: 'Water, Glycerin, Avena Sativa (Oat) Kernel Flour, Petrolatum, Cetyl Alcohol, Dimethicone, Panthenol, Allantoin, Caprylic/Capric Triglyceride, Sodium Hydroxide, Phenoxyethanol',
  },
  {
    id: 'sg-ceramide-night', line: 'Shelfside Gentle', name: 'Ceramide Rich Night Cream', type: 'moisturise', size: '50 ml', price: 22,
    ingredients: 'Water, Glycerin, Butyrospermum Parkii (Shea) Butter, Squalane, Cetearyl Alcohol, Ceramide NP, Ceramide AP, Cholesterol, Phytosphingosine, Sodium Hyaluronate, Tocopherol, Xanthan Gum, Phenoxyethanol',
  },
  {
    id: 'sg-repair-ointment', line: 'Shelfside Gentle', name: 'Repair Ointment', type: 'moisturise', size: '50 g', price: 9,
    ingredients: 'Petrolatum, Mineral Oil, Ceresin, Lanolin Alcohol, Panthenol, Glycerin, Bisabolol',
  },
  {
    id: 'sg-centella-gel', line: 'Shelfside Gentle', name: 'Soothing Centella Gel', type: 'soothe', size: '75 ml', price: 18,
    ingredients: 'Water, Centella Asiatica Extract, Glycerin, Madecassoside, Allantoin, Panthenol, Betaine, Carbomer, Tromethamine, 1,2-Hexanediol',
  },
  {
    id: 'sg-hydration-serum', line: 'Shelfside Gentle', name: 'Hyaluronic Hydration Serum', type: 'soothe', size: '30 ml', price: 19,
    ingredients: 'Water, Sodium Hyaluronate, Glycerin, Panthenol, Pentylene Glycol, Hydroxyethylcellulose, Phenoxyethanol',
  },
  {
    id: 'sg-mineral-spf50', line: 'Shelfside Gentle', name: 'Mineral Shield SPF 50', type: 'protect', size: '50 ml', price: 21,
    ingredients: 'Zinc Oxide 18%, Water, Caprylic/Capric Triglyceride, Glycerin, Dimethicone, Cetearyl Alcohol, Polyhydroxystearic Acid, Tocopherol, Phenoxyethanol',
  },
  {
    id: 'sg-tinted-spf30', line: 'Shelfside Gentle', name: 'Tinted Mineral Moisturiser SPF 30', type: 'protect', size: '40 ml', price: 24,
    ingredients: 'Zinc Oxide 12%, Titanium Dioxide 4%, Water, Glycerin, Dimethicone, Squalane, Panthenol, Iron Oxides (CI 77491, CI 77492, CI 77499), Tocopherol, Phenoxyethanol',
  },
  {
    id: 'sg-lip-balm', line: 'Shelfside Gentle', name: 'Lip Rescue Balm', type: 'moisturise', size: '10 g', price: 6,
    ingredients: 'Petrolatum, Butyrospermum Parkii (Shea) Butter, Squalane, Ceramide NP, Tocopherol',
  },
  {
    id: 'sc-bp-gel', line: 'Shelfside Clinical', name: 'Clear Skin 5% Benzoyl Peroxide Gel', type: 'treat', size: '45 g', price: 11,
    ingredients: 'Benzoyl Peroxide 5%, Water, Carbomer, Glycerin, Sodium Hydroxide, Docusate Sodium',
  },
  {
    id: 'sc-bha-toner', line: 'Shelfside Clinical', name: '2% Salicylic Blemish Toner', type: 'treat', size: '150 ml', price: 13,
    ingredients: 'Water, Alcohol Denat., Salicylic Acid, Hamamelis Virginiana (Witch Hazel) Water, Butylene Glycol, Menthol, Fragrance',
  },
  {
    id: 'sc-retinol', line: 'Shelfside Clinical', name: 'Night Renewal Retinol Serum', type: 'treat', size: '30 ml', price: 28,
    ingredients: 'Water, Glycerin, Squalane, Caprylic/Capric Triglyceride, Retinol, Polysorbate 20, Tocopherol, Bisabolol, Phenoxyethanol',
  },
  {
    id: 'sc-glycolic-pads', line: 'Shelfside Clinical', name: 'Glow Peel Pads 10%', type: 'treat', size: '50 pads', price: 25,
    ingredients: 'Water, Glycolic Acid, Lactic Acid, Alcohol Denat., Aloe Barbadensis Leaf Juice, Sodium Hydroxide, Fragrance',
  },
  {
    id: 'sg-glow-spf30', line: 'Shelfside Glow', name: 'Daily Glow SPF 30 Lotion', type: 'protect', size: '50 ml', price: 17,
    ingredients: 'Avobenzone 3%, Homosalate 10%, Octisalate 5%, Octocrylene 7%, Water, Alcohol Denat., Glycerin, Silica, Fragrance, Limonene, Linalool',
  },
  {
    id: 'sg-vitc', line: 'Shelfside Glow', name: 'Vitamin C Brightening Serum 15%', type: 'treat', size: '30 ml', price: 26,
    ingredients: 'Water, Ascorbic Acid, Propylene Glycol, Alcohol Denat., Ferulic Acid, Tocopherol, Fragrance',
  },
  {
    id: 'sg-apricot-scrub', line: 'Shelfside Glow', name: 'Apricot Polish Face Scrub', type: 'cleanse', size: '150 ml', price: 8,
    ingredients: 'Water, Juglans Regia (Walnut) Shell Powder, Prunus Armeniaca (Apricot) Seed Powder, Sodium Lauryl Sulfate, Glycerin, Fragrance',
  },
  {
    id: 'sg-foaming-gel', line: 'Shelfside Glow', name: 'Fresh Foaming Gel Cleanser', type: 'cleanse', size: '200 ml', price: 10,
    ingredients: 'Water, Sodium Lauryl Sulfate, Cocamidopropyl Betaine, Glycerin, Citric Acid, Fragrance, Citrus Aurantium Dulcis (Orange) Peel Oil',
  },
  {
    id: 'sg-lavender-lotion', line: 'Shelfside Glow', name: 'Lavender Dream Face & Body Lotion', type: 'moisturise', size: '250 ml', price: 12,
    ingredients: 'Water, Glycerin, Cetearyl Alcohol, Lavandula Angustifolia (Lavender) Oil, Parfum, Linalool, Limonene, Carbomer, Phenoxyethanol',
  },
];

export const TYPE_LABEL = { cleanse: 'Cleanse', moisturise: 'Moisturise', soothe: 'Soothe', protect: 'Protect', treat: 'Treat' };
