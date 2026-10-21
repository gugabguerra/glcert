import {
  ActionIcon,
  Anchor,
  Button,
  Card,
  Combobox,
  colorsTuple,
  createTheme,
  defaultVariantColorsResolver,
  Drawer,
  Input,
  InputWrapper,
  Menu,
  Modal,
  Overlay,
  Paper,
  Popover,
  Table,
  Tooltip,
  virtualColor,
  type CSSVariablesResolver,
  type MantineColorsTuple,
  type VariantColorsResolver,
} from '@mantine/core';
import { colors, fonts, glVar, radius, shadows, sizes, space } from './tokens';
import classes from './components.module.css';

// Slate ramps, so the places Mantine still reads `gray` or `dark` shades directly (stray borders,
// hovers, skeletons) land on the same family as the tokens instead of Mantine's neutral grey.
const slateLight: MantineColorsTuple = [
  '#f8fafc',
  '#f1f5f9',
  '#e2e8f0',
  '#cbd5e1',
  '#94a3b8',
  '#64748b',
  '#475569',
  '#334155',
  '#1e293b',
  '#0f172a',
];
const slateDark: MantineColorsTuple = [
  '#f1f5f9',
  '#cbd5e1',
  '#94a3b8',
  '#64748b',
  '#334155',
  '#273449',
  '#1e293b',
  '#0f172a',
  '#0b1222',
  '#020617',
];

const isDefaultSize = (size: unknown) => size === undefined || size === 'sm';

// Mantine's primary colour is the accent, because Mantine spends it on state (focus, checked,
// active tab). Filled controls in the primary colour become the neutral `gl-solid` button
// instead, and red controls take the destructive outline. Everything else keeps Mantine's
// defaults until its screen is redesigned.
const variantColorResolver: VariantColorsResolver = (input) => {
  const defaults = defaultVariantColorsResolver(input);
  const { color, variant } = input;

  if (color === 'accent') {
    switch (variant) {
      case 'filled':
        return {
          background: glVar('solid'),
          hover: glVar('solid'),
          color: glVar('on-solid'),
          border: `1px solid ${glVar('solid')}`,
        };
      case 'light':
        return {
          background: glVar('fill-soft'),
          hover: glVar('fill'),
          color: glVar('text-soft'),
          hoverColor: glVar('text'),
          border: '1px solid transparent',
        };
      case 'outline':
        return {
          background: 'transparent',
          hover: glVar('fill-soft'),
          color: glVar('text-soft'),
          hoverColor: glVar('text'),
          border: `1px solid ${glVar('border')}`,
        };
      case 'subtle':
        return {
          background: 'transparent',
          hover: glVar('fill'),
          color: glVar('text-muted'),
          hoverColor: glVar('text'),
          border: '1px solid transparent',
        };
    }
  }

  if (color === 'red' && ['filled', 'light', 'outline', 'subtle'].includes(variant)) {
    return {
      background: 'transparent',
      hover: `color-mix(in srgb, ${glVar('danger')} 10%, transparent)`,
      color: glVar('danger'),
      border: variant === 'subtle' ? '1px solid transparent' : `1px solid ${glVar('danger-line')}`,
    };
  }

  return defaults;
};

export const theme = createTheme({
  colors: {
    gray: slateLight,
    dark: slateDark,
    accentDark: colorsTuple(colors.accent.dark),
    accentLight: colorsTuple(colors.accent.light),
    accent: virtualColor({ name: 'accent', dark: 'accentDark', light: 'accentLight' }),
  },
  primaryColor: 'accent',
  variantColorResolver,
  white: '#ffffff',
  black: colors.text.light,
  fontFamily: fonts.sans,
  fontFamilyMonospace: fonts.mono,
  fontSmoothing: true,
  cursorType: 'pointer',
  respectReducedMotion: true,
  headings: {
    fontFamily: fonts.sans,
    fontWeight: '500',
    sizes: {
      h1: { fontSize: '20px', lineHeight: '28px' },
      h2: { fontSize: '16px', lineHeight: '24px', fontWeight: '600' },
      h3: { fontSize: '14px', lineHeight: '20px' },
      h4: { fontSize: '12px', lineHeight: '16px' },
    },
  },
  fontSizes: { xs: '12px', sm: '13px', md: '14px', lg: '16px', xl: '20px' },
  spacing: { xs: '8px', sm: '12px', md: '16px', lg: '24px', xl: '32px' },
  radius: {
    xs: radius['r-sm'],
    sm: radius['r-control'],
    md: radius['r-card'],
    lg: radius['r-dialog'],
    xl: radius['r-dialog'],
  },
  defaultRadius: 'sm',
  shadows: {
    xs: glVar('shadow'),
    sm: glVar('shadow'),
    md: glVar('shadow-hover'),
    lg: glVar('shadow-pop'),
    xl: glVar('shadow-pop'),
  },
  components: {
    Button: Button.extend({
      // Explicit, so a bare <Button> goes through variantColorResolver instead of falling back
      // to the primary colour in Mantine's CSS.
      defaultProps: { variant: 'filled' },
      classNames: { root: classes.button },
      vars: (_theme, props) =>
        isDefaultSize(props.size)
          ? {
              root: {
                '--button-height': sizes['h-control'],
                '--button-padding-x': '14px',
                '--button-fz': '14px',
              },
            }
          : { root: {} },
    }),
    ActionIcon: ActionIcon.extend({
      defaultProps: { variant: 'subtle' },
    }),
    Anchor: Anchor.extend({
      defaultProps: { underline: 'always' },
      classNames: { root: classes.anchor },
    }),
    // Field labels use the design system's field-label style: small, regular, muted.
    InputWrapper: InputWrapper.extend({
      classNames: { label: classes.fieldLabel },
    }),
    Input: Input.extend({
      vars: (_theme, props) => {
        const wrapper: Record<string, string> = {};
        if (isDefaultSize(props.size)) {
          wrapper['--input-height'] = sizes['h-control'];
          wrapper['--input-fz'] = '14px';
        }
        if (props.variant === undefined || props.variant === 'default') {
          wrapper['--input-bg'] = glVar('sunken');
          // Left unset on error so Mantine's error border still shows.
          if (!props.error) wrapper['--input-bd'] = glVar('border-field');
        }
        return { wrapper };
      },
    }),
    Paper: Paper.extend({
      defaultProps: { radius: 'md' },
      classNames: { root: classes.paper },
    }),
    Card: Card.extend({
      defaultProps: { radius: 'md' },
      classNames: { root: classes.paper },
    }),
    Table: Table.extend({
      vars: () => ({
        table: {
          '--table-border-color': glVar('border'),
          '--table-hover-color': glVar('fill-soft'),
          '--table-striped-color': glVar('fill-soft'),
        },
      }),
    }),
    Popover: Popover.extend({
      defaultProps: { radius: 'md', shadow: 'lg' },
      classNames: { dropdown: classes.dropdown },
    }),
    Menu: Menu.extend({
      defaultProps: { radius: 'md', shadow: 'lg' },
      classNames: { dropdown: classes.dropdown },
    }),
    Combobox: Combobox.extend({
      defaultProps: { radius: 'md', shadow: 'lg' },
      classNames: { dropdown: classes.dropdown },
    }),
    Tooltip: Tooltip.extend({
      vars: () => ({
        tooltip: { '--tooltip-bg': glVar('solid'), '--tooltip-color': glVar('on-solid') },
      }),
    }),
    // Dialogs and drawers appear at once, with no shadow; the scrim separates them.
    Modal: Modal.extend({
      defaultProps: { radius: 'lg', padding: 20, transitionProps: { duration: 0 } },
      classNames: { content: classes.dialog },
    }),
    Drawer: Drawer.extend({
      defaultProps: { padding: 20, transitionProps: { duration: 0 } },
      classNames: { content: classes.dialog },
    }),
    Overlay: Overlay.extend({
      vars: () => ({ root: { '--overlay-bg': glVar('scrim') } }),
    }),
  },
});

function schemeVariables(scheme: 'dark' | 'light'): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [name, value] of Object.entries(colors)) vars[`--gl-${name}`] = value[scheme];
  for (const [name, value] of Object.entries(shadows)) vars[`--gl-${name}`] = value[scheme];
  return {
    ...vars,
    // Point Mantine's own semantic variables at the tokens, so every existing page picks up the
    // palette before its redesign lands. Raised surfaces (Paper, Modal, dropdowns) read
    // `--mantine-color-body`, so it is the surface; the page ground is set on <body> in global.css.
    '--mantine-color-body': glVar('surface'),
    '--mantine-color-text': glVar('text'),
    '--mantine-color-bright': glVar('text'),
    '--mantine-color-dimmed': glVar('text-muted'),
    '--mantine-color-placeholder': glVar('text-muted'),
    '--mantine-color-anchor': glVar('link'),
    '--mantine-color-error': glVar('danger'),
    '--mantine-color-success': glVar('success'),
    '--mantine-color-default': 'transparent',
    '--mantine-color-default-hover': glVar('fill-soft'),
    '--mantine-color-default-color': glVar('text-soft'),
    '--mantine-color-default-border': glVar('border'),
    '--mantine-color-disabled': glVar('fill-soft'),
    '--mantine-color-disabled-color': glVar('text-muted'),
    '--mantine-color-disabled-border': glVar('border'),
    // Mantine's "light" accent (active nav, light badges) becomes the selected-segment pair.
    '--mantine-color-accent-light': glVar('accent-soft'),
    '--mantine-color-accent-light-hover': glVar('accent-soft'),
    '--mantine-color-accent-light-color': glVar('accent'),
    '--mantine-primary-color-contrast': scheme === 'dark' ? colors.bg.dark : colors.surface.light,
  };
}

export const cssVariablesResolver: CSSVariablesResolver = () => {
  const variables: Record<string, string> = {
    '--gl-link': glVar('brand'),
    '--gl-font-sans': fonts.sans,
    '--gl-font-mono': fonts.mono,
  };
  for (const [name, value] of Object.entries(radius)) variables[`--gl-${name}`] = value;
  for (const [name, value] of Object.entries(sizes)) variables[`--gl-${name}`] = value;
  for (const step of space) variables[`--gl-space-${step}`] = `${step}px`;
  return { variables, dark: schemeVariables('dark'), light: schemeVariables('light') };
};
