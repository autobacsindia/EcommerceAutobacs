# Header Navigation Categories Assignment

## Overview

This implementation identifies and assigns products to the header navigation categories ("Body Kits", "Audio", "Lights") in the development e-commerce site based on product attributes, titles, or legacy WordPress category assignments.

## Implementation Details

### Script: `assign-header-categories.js`

The script performs the following operations:

1. **Connects to MongoDB** to access product and category data
2. **Identifies header navigation categories** in the database
3. **Scans all products** for keyword matches in names, descriptions, tags, and brands
4. **Assigns matching products** to the appropriate category
5. **Generates detailed reports** of all reassignments

### Keyword Patterns

#### Body Kits
Keywords: "bumper", "spoiler", "side skirt", "body kit", "fender flare", "hood", "bumper kit", "facelift", "conversion kit", "front bumper", "rear bumper", "body part", "kit", "panel", "skirt"

#### Audio
Keywords: "speaker", "subwoofer", "amplifier", "stereo", "head unit", "sound system", "audio", "sub woofer", "amp", "radio", "car stereo", "sound bar"

#### Lights
Keywords: "fog light", "headlamp", "led", "taillight", "headlight", "light bar", "driving light", "spotlight", "work light", "lighting", "lamp", "bulb", "tail light", "fog lamp", "halogen", "hid", "xenon"

## Results

### Products Reassigned
- **Body Kits**: 360 products reassigned
- **Audio**: 0 products found
- **Lights**: 0 products found

### Sample Reassigned Products
1. Wider ABS fender flares for thar roxx
2. New Bronco Plus Spoiler for Thar Roxx with LED Brake Light
3. Universal Bonnet Scoop Gloss Black for Cars and SUVs
4. Toyota Fortuner Interior Carbon Kit
5. Toyota Hilux Roof Rail with Cross Bar

### Total Impact
- 360 products were successfully assigned to the "Body Kits" header navigation category
- No products were found matching the keywords for "Audio" or "Lights" categories

## Reports Generated

All reports are saved in the `reports-header-nav` directory:

1. `header-nav-reassigned-products.json` - Detailed JSON list of all reassigned products
2. `header-nav-assignment-summary.json` - Summary counts by category
3. `header-nav-assignment-report.txt` - Human-readable detailed report

## Validation

After running the assignment, the category validation script should be run to confirm that products now appear under the header navigation categories. The validation should show an increase in products assigned to "Body Kits" category.

## Next Steps

1. **Expand keyword lists** for "Audio" and "Lights" categories to identify more products
2. **Review unassigned products** to determine if additional keywords or categories are needed
3. **Manually review** products that might belong to "Audio" or "Lights" but weren't caught by automated keyword matching
4. **Periodically rerun** the assignment script as new products are added to the catalog

## Usage

To run the header navigation category assignment:

```bash
npm run assign-header-nav-categories
```

Or directly:

```bash
node assign-header-categories.js
```

## Files Modified

- Products in MongoDB had their `categories` field updated to include the appropriate header navigation category
- No existing product data was deleted or modified beyond category assignments
- Reports were generated for auditing purposes