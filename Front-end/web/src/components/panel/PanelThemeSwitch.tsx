'use client';

/**
 * Light / Dark / Match my computer, in the panel's top bar.
 *
 * The panel's own choice, remembered per browser (themeChoice.ts): it never
 * changes the storefront, and the storefront's moon button never changes it once
 * it is set. "Match my computer" follows the operating system, live — a Mac that
 * turns dark at sunset turns the panel dark with it (ThemeSync listens).
 */
import { useEffect, useRef, useState } from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { paintTheme } from '@/components/theme/ThemeToggle';
import { resolveTheme, savePanelChoice, savedChoice, type ThemeChoice } from '@/components/theme/themeChoice';

const CHOICES: { value: ThemeChoice; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'Match my computer', icon: Monitor },
];

export default function PanelThemeSwitch() {
  // Read after mount: the server cannot know the browser's choice.
  const [choice, setChoice] = useState<ThemeChoice | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => { setChoice(savedChoice(window.location.pathname)); }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (next: ThemeChoice) => {
    savePanelChoice(next);
    paintTheme(resolveTheme(next));
    setChoice(next);
    setOpen(false);
  };

  const current = CHOICES.find((c) => c.value === choice) ?? CHOICES[0];
  const Icon = current.icon;

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Colours: ${current.label}. Change`}
        title="Light or dark"
        className="grid h-9 w-9 place-items-center rounded-lg text-gray-600 hover:bg-gray-100 hover:text-gray-900"
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
      </button>
      {open && (
        <div
          role="group"
          aria-label="Colours"
          className="absolute right-0 top-full z-30 mt-1 w-56 rounded-xl border border-gray-200 bg-white p-1 shadow-lg"
        >
          <p className="px-2.5 pb-1 pt-1.5 text-xs font-medium text-gray-500">Colours on this browser</p>
          {CHOICES.map(({ value, label, icon: ItemIcon }) => (
            <button
              key={value}
              type="button"
              onClick={() => pick(value)}
              aria-pressed={choice === value}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-gray-50 ${
                choice === value ? 'font-semibold text-gray-900' : 'text-gray-700'
              }`}
            >
              <ItemIcon className="h-4 w-4 shrink-0 text-gray-500" aria-hidden="true" />
              <span className="flex-1">{label}</span>
              {choice === value && <Check className="h-4 w-4 text-blue-600" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
