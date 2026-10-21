import type { ReactNode } from 'react';
import { GlcertMark } from './shell/Sidebar';
import classes from './AuthLayout.module.css';

export { classes as authClasses };

/** Frame for signed-out screens: the mark, one card, and a short note under it. */
export function AuthLayout({ children, footnote }: { children: ReactNode; footnote?: ReactNode }) {
  return (
    <main className={classes.screen}>
      <div className={classes.brand}>
        <GlcertMark />
        GLCert
      </div>
      {children}
      {footnote && <p className={classes.footnote}>{footnote}</p>}
    </main>
  );
}
