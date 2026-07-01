import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * Storefront button primitive (obsidian + gold design system).
 *   - gold:  filled gold CTA (primary)
 *   - ghost: gold-outline (secondary)
 *   - line:  hairline-outline neutral (tertiary)
 * Renders an <a> (next/link) when `href` is set, otherwise a <button>.
 *
 * (Distinct from the legacy blue-themed ui/Button — retire that during migration.)
 */
type Variant = 'gold' | 'ghost' | 'line';

const base =
  'inline-flex items-center justify-center gap-2.5 font-display text-[10px] font-semibold uppercase tracking-[0.18em] ' +
  'transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer';

const variants: Record<Variant, string> = {
  gold: 'bg-gold text-obsidian px-7 py-3.5 hover:opacity-90',
  ghost: 'border border-gold text-gold px-7 py-3.5 hover:bg-gold hover:text-obsidian',
  line: 'border border-hairline text-ink px-7 py-3.5 hover:border-gold hover:text-gold',
};

interface CommonProps {
  variant?: Variant;
  className?: string;
  children: React.ReactNode;
}

type NativeButtonProps = CommonProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof CommonProps>;
type AnchorProps = CommonProps & { href: string };

export default function StoreButton(props: NativeButtonProps | AnchorProps) {
  const { variant = 'gold', className, children } = props;
  const classes = cn(base, variants[variant], className);

  if ('href' in props && props.href) {
    return (
      <Link href={props.href} className={classes}>
        {children}
      </Link>
    );
  }

  const { variant: _v, className: _c, children: _ch, ...rest } = props as NativeButtonProps;
  return (
    <button className={classes} {...rest}>
      {children}
    </button>
  );
}
