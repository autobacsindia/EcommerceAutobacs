import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * Storefront button primitive — rounded pills in the store's green, matching the
 * home page buttons (`.sh-btn` in store.css).
 *   - gold:  filled green CTA (primary; the variant keeps its historical name)
 *   - ghost: green outline (secondary)
 *   - line:  neutral outline (tertiary)
 * Renders an <a> (next/link) when `href` is set, otherwise a <button>.
 *
 * (Distinct from the legacy blue-themed ui/Button — retire that during migration.)
 */
type Variant = 'gold' | 'ghost' | 'line';

const base =
  'inline-flex items-center justify-center gap-2 rounded-full text-[15px] font-semibold ' +
  'transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer';

const variants: Record<Variant, string> = {
  gold: 'bg-gold text-white px-7 py-3 hover:bg-[#0b6b3c]',
  ghost: 'border border-gold text-gold bg-white px-7 py-3 hover:bg-gold hover:text-white',
  line: 'border border-hairline bg-white text-ink px-7 py-3 hover:border-gold hover:text-gold',
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
