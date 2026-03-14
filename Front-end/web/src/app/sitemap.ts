import { MetadataRoute } from 'next'
import { getServerApiBase } from '@/lib/server-api';

// Configuration
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

type ChangeFrequency = 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const routes: MetadataRoute.Sitemap = [
    {
      url: BASE_URL,
      lastModified: new Date(),
      changeFrequency: 'daily' as ChangeFrequency,
      priority: 1,
    },
    {
      url: `${BASE_URL}/about`,
      lastModified: new Date(),
      changeFrequency: 'monthly' as ChangeFrequency,
      priority: 0.5,
    },
    {
      url: `${BASE_URL}/contact`,
      lastModified: new Date(),
      changeFrequency: 'monthly' as ChangeFrequency,
      priority: 0.5,
    },
    {
      url: `${BASE_URL}/shop`,
      lastModified: new Date(),
      changeFrequency: 'daily' as ChangeFrequency,
      priority: 0.8,
    },
  ];

  try {
    // Fetch Categories
    // Use caching strategies appropriate for sitemap
    const categoriesRes = await fetch(`${getServerApiBase()}/categories`, { next: { revalidate: 3600 } });
    
    if (categoriesRes.ok) {
      const categoriesData = await categoriesRes.json();
      // Handle response structure: { categories: [...] } or [...]
      const categories = Array.isArray(categoriesData) ? categoriesData : (categoriesData.categories || []);
      
      const categoryUrls = categories.map((category: any) => ({
        url: `${BASE_URL}/categories/${category.slug || category._id}`,
        lastModified: new Date(category.updatedAt || new Date()),
        changeFrequency: 'weekly' as ChangeFrequency,
        priority: 0.7,
      }));
      
      routes.push(...categoryUrls);
    }

    // Fetch Products
    // We fetch a reasonable limit to avoid timeout. 
    // In a large production app, this should be split into multiple sitemaps (sitemap index).
    const productsRes = await fetch(`${getServerApiBase()}/products?limit=1000`, { next: { revalidate: 3600 } });
    
    if (productsRes.ok) {
      const productsData = await productsRes.json();
      const products = productsData.products || [];
      
      const productUrls = products.map((product: any) => ({
        url: `${BASE_URL}/products/${product._id}`,
        lastModified: new Date(product.updatedAt || new Date()),
        changeFrequency: 'daily' as ChangeFrequency,
        priority: 0.6,
      }));
      
      routes.push(...productUrls);
    }
  } catch (error) {
    console.error('Sitemap generation error:', error);
    // Continue with static routes even if API fails
  }

  return routes;
}
