import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ClientPage from './ClientPage';
import { getProduct } from '@/services/productService';

interface ProductPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Generate dynamic metadata for product pages
 * 
 * Each product gets unique:
 * - Title
 * - Description
 * - Open Graph image (product image)
 * - Twitter Card
 * - Canonical URL
 */
export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  
  try {
    const product = await getProduct(slug);
    
    if (!product) {
      return {
        title: 'Product Not Found | Autobacs India',
      };
    }
    
    const productUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/product/${slug}`;
    
    return {
      title: `${product.name} | Autobacs India`,
      description: product.description?.substring(0, 160) || `Buy ${product.name} from Autobacs India - Premium automotive accessories`,
      
      // Canonical URL
      alternates: {
        canonical: productUrl,
      },
      
      // Open Graph - Dynamic per product
      openGraph: {
        title: product.name,
        description: product.description?.substring(0, 160) || `Buy ${product.name} from Autobacs India`,
        url: productUrl,
        type: 'product',
        siteName: 'Autobacs India',
        locale: 'en_IN',
        images: [
          {
            url: product.images?.[0] || '/og-image.jpg',
            width: 1200,
            height: 630,
            alt: product.name,
          },
        ],
      },
      
      // Twitter Card - Dynamic per product
      twitter: {
        card: 'summary_large_image',
        title: product.name,
        description: product.description?.substring(0, 160) || `Buy ${product.name} from Autobacs India`,
        images: [product.images?.[0] || '/og-image.jpg'],
      },
    };
  } catch (error) {
    console.error('Error generating product metadata:', error);
    return {
      title: 'Autobacs India',
    };
  }
}

export default async function ProductPage({ params, searchParams }: ProductPageProps) {
  const { slug } = await params;
  
  try {
    const product = await getProduct(slug);
    
    if (!product) {
      notFound();
    }
    
    return <ClientPage product={product} />;
  } catch (error) {
    console.error('Error loading product:', error);
    notFound();
  }
}
