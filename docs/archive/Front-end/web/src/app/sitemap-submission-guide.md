# XML Sitemap Submission Guide

## Google Search Console Setup

1. Go to [Google Search Console](https://search.google.com/searchconsole)
2. Add your property: `https://autobacsindia.com`
3. Verify ownership using DNS record or HTML file upload

## Sitemap Submission Process

1. In Google Search Console, navigate to **Sitemaps** section
2. Enter your sitemap URL: `https://autobacsindia.com/sitemap.xml`
3. Click **Submit**

## Sharded Sitemap Support

Our sitemap implementation uses sharding for performance:
- `https://autobacsindia.com/sitemap.xml` (main index)
- `https://autobacsindia.com/sitemap-0.xml` (static routes + categories)
- `https://autobacsindia.com/sitemap-1.xml` (articles)
- `https://autobacsindia.com/sitemap-2.xml` (products page 1)
- `https://autobacsindia.com/sitemap-3.xml` (products page 2)
- etc.

## Verification Steps

1. Check sitemap status in Google Search Console
2. Monitor crawl errors and coverage reports
3. Verify sitemap URLs are returning 200 status
4. Confirm all important pages are included in sitemaps

## Troubleshooting

- If sitemap submission fails, check robots.txt allows crawling
- Verify BASE_URL environment variable is set correctly in production
- Check sitemap generation logs for errors
- Ensure backend API endpoints are accessible from Google's crawlers