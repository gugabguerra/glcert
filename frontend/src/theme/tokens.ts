// GL Design System v1 tokens (shared with GLdash and GLclip), as updated on 2026-10-18.
// This is the in-repo copy: change a value here, never in a component. Every colour and shadow
// is emitted as a `--gl-<name>` CSS variable for both colour schemes by `cssVariablesResolver`.

type SchemeValue = { dark: string; light: string };

export const colors = {
  bg: { dark: '#0f172a', light: '#f1f5f9' },
  surface: { dark: '#1e293b', light: '#ffffff' },
  sunken: { dark: '#0f172a', light: '#f8fafc' },
  border: { dark: '#33415580', light: '#e2e8f0' },
  'border-strong': { dark: '#64748b80', light: '#cbd5e1' },
  'border-field': { dark: '#475569', light: '#94a3b8' },
  text: { dark: '#f1f5f9', light: '#0f172a' },
  'text-soft': { dark: '#cbd5e1', light: '#334155' },
  'text-muted': { dark: '#94a3b8', light: '#475569' },
  brand: { dark: '#34d399', light: '#047857' },
  'brand-soft': { dark: '#34d3991f', light: '#0478571f' },
  accent: { dark: '#36d3d0', light: '#0d6b63' },
  'accent-soft': { dark: '#36d3d024', light: '#0d6b6324' },
  'accent-line': { dark: '#36d3d0b3', light: '#0d6b63b3' },
  danger: { dark: '#fca5a5', light: '#b91c1c' },
  'danger-line': { dark: '#ef444480', light: '#dc262673' },
  warning: { dark: '#fbbf24', light: '#b45309' },
  success: { dark: '#6ee7b7', light: '#047857' },
  'success-line': { dark: '#10b98180', light: '#10b9818c' },
  fill: { dark: '#33415599', light: '#cbd5e199' },
  'fill-soft': { dark: '#33415566', light: '#cbd5e166' },
  solid: { dark: '#f1f5f9', light: '#0f172a' },
  'on-solid': { dark: '#0f172a', light: '#f8fafc' },
  scrim: { dark: '#02061799', light: '#02061799' },
} satisfies Record<string, SchemeValue>;

export const shadows = {
  shadow: {
    dark: '0 1px 2px #0206174d, 0 1px 4px #0206174d',
    light: '0 1px 2px #0f172a0f, 0 1px 4px #0f172a1a',
  },
  'shadow-hover': { dark: '0 4px 10px -2px #02061773', light: '0 4px 10px -2px #0f172a1f' },
  'shadow-pop': { dark: '0 10px 24px -6px #02061799', light: '0 10px 24px -6px #0f172a33' },
} satisfies Record<string, SchemeValue>;

export const radius = {
  'r-sm': '4px',
  'r-control': '8px',
  'r-card': '12px',
  'r-dialog': '16px',
  'r-pill': '999px',
};

export const space = [4, 6, 8, 10, 12, 14, 16, 20, 24, 32] as const;

export const sizes = {
  'h-control': '32px',
  'h-touch': '40px',
};

export const fonts = {
  sans: "Oxanium, system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
};

export type ColorToken = keyof typeof colors;

/** `var(--gl-<name>)` for a colour token, for inline styles and theme overrides. */
export function glVar(name: ColorToken | keyof typeof shadows | 'link'): string {
  return `var(--gl-${name})`;
}
