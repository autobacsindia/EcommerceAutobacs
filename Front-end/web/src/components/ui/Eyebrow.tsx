import { cn } from '@/lib/utils';

/**
 * Uppercase gold micro-label — the redesign's signature eyebrow/tag.
 * (e.g. section kickers, category tags, field labels.)
 */
export default function Eyebrow({
  children,
  className,
  as: Tag = 'p',
}: {
  children: React.ReactNode;
  className?: string;
  as?: 'p' | 'span' | 'div' | 'h2';
}) {
  return (
    <Tag
      className={cn(
        'font-display text-[10px] uppercase tracking-[0.28em] text-gold',
        className
      )}
    >
      {children}
    </Tag>
  );
}
