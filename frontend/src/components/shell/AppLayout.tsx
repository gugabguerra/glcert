import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Drawer } from '@mantine/core';
import { useLocalStorage, useMediaQuery } from '@mantine/hooks';
import { IconMenu2 } from '@tabler/icons-react';
import { GlcertMark, Sidebar } from './Sidebar';
import { TwoFactorReminder } from './TwoFactorReminder';
import classes from './Shell.module.css';

type SidebarMode = 'auto' | 'expanded' | 'collapsed';

/**
 * Signed-in frame. The sidebar is a rail below 1200px unless the user's toggle says otherwise;
 * the choice is remembered in this browser. Phones get a top bar that opens the full sidebar.
 */
export function AppLayout() {
  const [mode, setMode] = useLocalStorage<SidebarMode>({
    key: 'glcert-sidebar',
    defaultValue: 'auto',
  });
  const narrow = useMediaQuery('(max-width: 1199px)');
  const phone = useMediaQuery('(max-width: 767px)');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const rail = mode === 'collapsed' || (mode === 'auto' && !!narrow);

  // The reminder sits outside the phone/desktop switch, so changing layout never remounts it.
  const reminder = <TwoFactorReminder />;

  if (phone) {
    return (
      <>
        <div className={classes.layout} data-mobile>
          <header className={classes.topBar}>
            <button
              type="button"
              className={classes.iconButton}
              aria-label="Open navigation"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
            >
              <IconMenu2 size={16} stroke={1.8} />
            </button>
            <GlcertMark />
            <span className={classes.wordmark}>GLCert</span>
          </header>
          <Drawer
            opened={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            size={280}
            padding={0}
            withCloseButton={false}
            aria-label="Navigation"
          >
            <Sidebar rail={false} inDrawer onNavigate={() => setDrawerOpen(false)} />
          </Drawer>
          <main className={classes.main}>
            <Outlet />
          </main>
        </div>
        {reminder}
      </>
    );
  }

  return (
    <>
      <div className={classes.layout}>
        <Sidebar rail={rail} onToggleRail={() => setMode(rail ? 'expanded' : 'collapsed')} />
        <main className={classes.main}>
          <Outlet />
        </main>
      </div>
      {reminder}
    </>
  );
}
