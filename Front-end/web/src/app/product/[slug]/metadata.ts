/**
 * Dynamic Product Metadata Generator
 * 
 * Use this in your [slug]/page.tsx to generate unique OG metadata per product
 * This is the BIGGEST ROI improvement for social sharing
 */

import { Metadata } from 'next';
import { getProduct } from '@/services/productService';

interface ProductPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Generate dynamic metadata for product pages
 * 
 * Each product gets:
 * - Unique title
 * - Unique description
 * - Unique OG image (product image)
 * - Price information
 * - Canonical URL
 */
export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  
  try {
    // Fetch product data
    const product = await getProduct(slug);
    
    // Fallback if product not found
    if (!product) {
      return {
        title: 'Product Not Found',
        description: 'The requested product could not be found',
      };
    }
    
    // Build product URL
    const productUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/product/${slug}`;
    
    // Generate metadata
    return {
      title: product.name,
      description: product.description || `Buy ${product.name} from Autobacs India`,
      
      // Canonical URL
      alternates: {
        canonical: productUrl,
      },
      
      // Open Graph - Dynamic per product
      openGraph: {
        title: product.name,
        description: product.description || `Buy ${product.name} from Autobacs India`,
        url: productUrl,
        type: 'product',
        siteName: 'Autobacs India',
        locale: 'en_IN',
        
        // Product-specific image
        images: [
          {
            url: product.images?.[0] || '/og-image.jpg',
            width: 1200,
            height: 630,
            alt: product.name,
          },
        ],
        
        // Product metadata (Facebook understands this)
        // price: product.price?.toString(),
        // priceCurrency: 'INR',
        // availability: product.stock > 0 ? 'in_stock' : 'out_of_stock',
      },
      
      // Twitter Card - Dynamic per product
      twitter: {
        card: 'summary_large_image',
        title: product.name,
        description: product.description || `Buy ${product.name} from Autobacs India`,
        images: [product.images?.[0] || '/og-image.jpg'],
      },
    };
  } catch (error) {
    console.error('Error generating product metadata:', error);
    
    // Return fallback metadata
    return {
      title: 'Autobacs India',
      description: 'Premium Automotive Accessories',
    };
  }
}
