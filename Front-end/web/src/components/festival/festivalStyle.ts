import type { CSSProperties } from 'react';
import type { FestivalThemeTokens } from '@/lib/festival/themes';

/** Theme tokens as CSS custom properties for the .fx-* rules in app/globals.css. */
export function festivalVars(tokens: FestivalThemeTokens): CSSProperties {
  return {
    '--fx-primary': tokens.colors.primary,
    '--fx-on-primary': tokens.colors.onPrimary,
    '--fx-accent': tokens.colors.accent,
  } as CSSProperties;
}
