import Link from 'next/link';
import ProductImage from '@/components/products/ProductImage';
import ProductCardWishlistButton from './ProductCardWishlistButton';
import ProductCardPriceActions from './ProductCardPriceActions';
import { Product, productUrl } from '@/lib/types';
import { cn } from '@/lib/utils';

interface ProductCardProps {
  product: Product;
  className?: string;
}

export default function ProductCard({
  product,
  className,
}: ProductCardProps) {
  const url = productUrl(product);

  if (!url) {
    console.log(`[ProductCard NO URL] ${product.name}:`, {
      slug: product.slug,
      productId: product._id,
    });
  }

  const imageContents = (
    <>
      {product.images && (
        Array.isArray(product.images) && product.images.length > 0 && product.images[0].url ? (
          <ProductImage
            src={product.images[0].url}
            alt={product.images[0].alt || product.name}
            className="object-cover w-full h-full"
          />
        ) : typeof product.images === 'string' && product.images !== '' ? (
          <ProductImage
            src={product.images}
            alt={product.name}
            className="object-cover w-full h-full"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-[#161616]">
            <span className="text-[#555555] text-sm">No image available</span>
          </div>
        )
      )}

      {/* Wishlist toggle — client island, absolutely positioned over the image */}
      <ProductCardWishlistButton productId={product._id} />

      <div className="absolute top-10 left-2 flex gap-1 flex-wrap">
        {product.stock === 'out' && (
          <div className="bg-red-500 text-white px-2 py-1 rounded text-xs font-semibold">Out of Stock</div>
        )}
        {product.stock !== 'out' && (product as any).isNew && (
          <div className="bg-green-500 text-white px-2 py-1 rounded text-xs font-semibold">New</div>
        )}
        {product.originalPrice && product.originalPrice > product.price && (
          <div className="bg-red-500 text-white px-2 py-1 rounded text-xs font-semibold">
            {Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)}% OFF
          </div>
        )}
        {product.isFeatured && product.stock !== 'out' && product.originalPrice && product.originalPrice <= product.price && (
          <div className="bg-blue-500 text-white px-2 py-1 rounded text-xs font-semibold">Popular</div>
        )}
      </div>
    </>
  );

  return (
    <div className={cn(
      'bg-[#0E0E0E] border border-[#252525] rounded-lg overflow-hidden hover:border-[#3B9EE8] transition-all duration-300 group',
      className
    )}>
      {url ? (
        <Link href={url} className="block relative h-48 bg-[#161616]">
          {imageContents}
        </Link>
      ) : (
        <div className="relative h-48 bg-[#161616]">
          {imageContents}
        </div>
      )}

      <div className="p-4">
        <p className="text-xs text-[#3B9EE8] uppercase font-condensed font-bold tracking-widest mb-1">
          {product.categories && product.categories.length > 0 ? (
            product.categories[0].name.toUpperCase()
          ) : typeof product.category === 'object' && product.category !== null ? (
            (product.category as any).name?.toUpperCase() || 'UNCATEGORIZED'
          ) : typeof product.category === 'string' ? (
            product.category.toUpperCase()
          ) : (
            'UNCATEGORIZED'
          )}
        </p>

        {url ? (
          <Link href={url}>
            <h3 className="font-condensed font-bold text-white mb-2 line-clamp-2 hover:text-[#3B9EE8] text-base uppercase tracking-wide">
              {product.name}
            </h3>
          </Link>
        ) : (
          <h3 className="font-condensed font-bold text-white mb-2 line-clamp-2 text-base uppercase tracking-wide">
            {product.name}
          </h3>
        )}

        {product.averageRating > 0 && (
          <div className="flex items-center gap-1 mb-2">
            <div className="flex">
              {[1, 2, 3, 4, 5].map((star) => (
                <svg
                  key={star}
                  className={cn('h-4 w-4', star <= product.averageRating ? 'text-[#EF9F27]' : 'text-[#252525]')}
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
              ))}
            </div>
            <span className="text-sm text-[#C4C4C4]">({product.averageRating.toFixed(1)})</span>
          </div>
        )}

        {/* Price + add-to-cart — client island */}
        <ProductCardPriceActions
          productId={product._id}
          price={product.price}
          originalPrice={product.originalPrice}
          stock={product.stock}
        />
      </div>
    </div>
  );
}
