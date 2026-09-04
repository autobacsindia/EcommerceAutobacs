import { redirect } from 'next/navigation';

/**
 * Legacy /shop URL. Server-side redirect, deliberately — this used to be a
 * client component calling router.replace('/products') in an effect, which
 * answers crawlers with HTTP 200 and an empty shell. It was also submitted in
 * the sitemap at priority 0.8, so the blank page outranked the real listing it
 * pointed at. It is no longer in the sitemap; keep it that way.
 */
export default function ShopPage() {
  redirect('/products');
}
