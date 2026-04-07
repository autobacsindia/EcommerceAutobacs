import { Metadata } from 'next';

// SEO: Prevent indexing but allow following links (preserves link equity)
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: true,
  },
};

export default function CheckoutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
