# WordPress Product Cleanup Documentation

## Overview
This document explains how to use the new WordPress product cleanup functionality that removes HTML tags from product descriptions and automatically categorizes uncategorized products.

## Features
1. **HTML Tag Removal**: Removes HTML tags from product descriptions while preserving meaningful content and formatting
2. **Automatic Categorization**: Assigns categories to uncategorized products based on product attributes
3. **Batch Processing**: Processes products in batches to handle large datasets efficiently
4. **API Integration**: Provides API endpoints for triggering and monitoring cleanup operations

## Implementation Details

### HTML Sanitization
The HTML sanitization utility removes HTML tags while preserving:
- Line breaks (converted from `<br>`, `<p>`, and `<div>` tags)
- Text content
- Decoded HTML entities (`&amp;` becomes `&`, etc.)

Security features:
- Removes `<script>` and `<iframe>` tags completely
- Preserves only safe text content

### Product Categorization
The categorization module analyzes product attributes and assigns categories based on keyword matching:

| Category | Keywords |
|----------|----------|
| ACCESSORIES | accessory, accessories, cover, mat, liner, organizer, bag, case |
| EXTERIOR | bumper, spoiler, wing, body, paint, wrap, decal, sticker |
| INTERIOR | seat, dashboard, console, steering, wheel, pedal, gauge, carpet |
| PERFORMANCE | engine, turbo, supercharger, exhaust, intake, throttle, chip, tuner |
| BODYKIT | bodykit, body kit, widebody, fender, skirt, bumper, lip |
| SUSPENSION | suspension, coilover, spring, damper, strut, shock |
| LIGHTS | light, led, bulb, headlight, taillight, fog, angel, halo |
| AUDIO | audio, speaker, subwoofer, amp, amplifier, headunit, stereo, sound |

## Usage

### Command Line Interface
Run the cleanup script directly from the command line:

```bash
cd Autobacs/Back-end/server
npm run cleanup-wordpress-products
```

You can also specify a batch size:

```bash
node utils/wordpressProductCleanup.js 100
```

### API Endpoints

#### Trigger Cleanup Process
```
POST /api/products/cleanup/wordpress
```

Request body (optional):
```json
{
  "batchSize": 50
}
```

Response:
```json
{
  "success": true,
  "message": "WordPress products cleaned up successfully",
  "summary": {
    "processed": 150,
    "updated": 145,
    "errors": 5,
    "message": "Processed 150 products, updated 145, errors: 5"
  }
}
```

#### Check Cleanup Status
```
GET /api/products/cleanup/status
```

Response:
```json
{
  "success": true,
  "status": "Ready to start cleanup",
  "lastCleanup": null
}
```

## How It Works

1. The system identifies products with HTML tags in their descriptions
2. Products are processed in batches to prevent memory issues
3. HTML tags are removed from descriptions while preserving content
4. Products are analyzed for categorization based on keywords
5. Updated products are saved to the database

## Error Handling

- Products that fail processing are logged with error details
- The system continues processing remaining products even if some fail
- Database connections are properly managed and closed

## Performance Considerations

- Batch processing prevents memory exhaustion
- Small delays between batches prevent overwhelming the database
- Efficient MongoDB queries using bulk operations

## Testing

Unit tests are available in the `tests` directory:
- `wordpressCleanup.test.js` - Tests for HTML sanitization and categorization logic
- `wordpressCleanupIntegration.test.js` - Integration tests for the cleanup process

Run tests with:
```bash
npm test
```