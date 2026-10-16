import { BookOpen, Globe, Ticket, Megaphone, Gift, Image as ImageIcon, Target, MessageSquareText, ShoppingBag, Tag, FolderTree, Car, ReceiptText } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { MARKETING_BASE } from '@/lib/usePanel';

export type MarketingArea = { href: string; label: string; text: string; icon: LucideIcon };

/**
 * The marketing panel's screens — one list for the sidebar and the dashboard.
 * Each is the admin screen re-exported under /team/marketing; the API
 * (adminOrMarketing / canViewAllOrders) allows the same set: deletes stay with
 * the admin, and orders are view + export only.
 */
export const MARKETING_AREAS: MarketingArea[] = [
  // Catalogue: full edit, no delete. Orders: view and export.
  { href: `${MARKETING_BASE}/products`, label: 'Products', text: 'Add and edit products — names, prices, images, stock and SEO.', icon: ShoppingBag },
  { href: `${MARKETING_BASE}/brands`, label: 'Brands', text: 'Brand pages, logos and which products belong to each brand.', icon: Tag },
  { href: `${MARKETING_BASE}/categories`, label: 'Categories', text: 'The category tree, featured categories and their pages.', icon: FolderTree },
  { href: `${MARKETING_BASE}/vehicles`, label: 'Vehicles', text: 'Car makes and models, and which products fit each one.', icon: Car },
  { href: `${MARKETING_BASE}/orders`, label: 'Orders', text: 'Every order with its status, payment, coupon and source. View and export.', icon: ReceiptText },
  { href: `${MARKETING_BASE}/blog`, label: 'Blog & media', text: 'Write blog posts and news, manage the gallery and videos, approve comments.', icon: BookOpen },
  { href: `${MARKETING_BASE}/seo`, label: 'Page SEO', text: 'Titles, descriptions and share images for the site\'s pages.', icon: Globe },
  { href: `${MARKETING_BASE}/coupons`, label: 'Coupons', text: 'Create discount codes and switch them on or off.', icon: Ticket },
  { href: `${MARKETING_BASE}/campaigns`, label: 'Campaigns', text: 'Festive and member campaigns: offers, product tiers and results.', icon: Megaphone },
  { href: `${MARKETING_BASE}/spin`, label: 'Spin to win', text: 'Spin campaigns, prizes and winners.', icon: Gift },
  { href: `${MARKETING_BASE}/promo-banners`, label: 'Promo banners', text: 'The offer strip across the top of the website.', icon: ImageIcon },
  { href: `${MARKETING_BASE}/leads`, label: 'Leads', text: 'Every enquiry from ads and the website, and where each one is up to.', icon: Target },
  { href: `${MARKETING_BASE}/consultation`, label: 'Consultations', text: 'Specialist consultation requests from the website.', icon: MessageSquareText },
];
