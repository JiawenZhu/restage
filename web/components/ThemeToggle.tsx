'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

/*
 * The attribute is already correct before this mounts — layout.tsx sets it in a
 * pre-paint script. This component only reads it back so the control shows the
 * right half as active, and writes on click. Reading in an effect rather than
 * during render keeps the server and client markup identical.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    const current = document.documentElement.getAttribute('data-theme');
    setTheme(current === 'dark' ? 'dark' : 'light');
  }, []);

  const apply = (next: Theme) => {
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('restage-theme', next);
    } catch {
      // A privacy mode that blocks storage should still let the toggle work for
      // this session; it just will not be remembered.
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="flex items-center gap-0.5 rounded-lg border border-line bg-elevated p-0.5"
    >
      {(['light', 'dark'] as const).map((option) => {
        const active = theme === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option === 'light' ? 'Light theme' : 'Dark theme'}
            onClick={() => apply(option)}
            className={`flex h-6 w-7 items-center justify-center rounded-md transition-colors ${
              active ? 'bg-primary text-primary-ink' : 'text-ink-3 hover:text-ink'
            }`}
          >
            {option === 'light' ? <SunIcon /> : <MoonIcon />}
          </button>
        );
      })}
    </div>
  );
}

function SunIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}
