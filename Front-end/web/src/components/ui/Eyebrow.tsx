import { cn } from '@/lib/utils';

/**
 * Small green section label (kickers, category tags, field labels) — readable at a
 * glance on the light store; it used to be a 10px hairline-tracked gold whisper.
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
        'font-display text-[12px] font-semibold uppercase tracking-[0.12em] text-gold',
        className
      )}
    >
      {children}
    </Tag>
  );
}
