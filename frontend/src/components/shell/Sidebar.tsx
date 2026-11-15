import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Tooltip, useComputedColorScheme, useMantineColorScheme } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import {
  IconAdjustmentsHorizontal,
  IconAlertTriangle,
  IconCertificate,
  IconLayoutSidebar,
  IconList,
  IconLogout,
  IconMoon,
  IconPlus,
  IconShield,
  IconShieldCheck,
  IconSun,
  IconTimeline,
  IconUsers,
} from '@tabler/icons-react';
import { authFetchJson } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import {
  buildAuthorityTree,
  type AuthoritySummary,
  type CertificateSummary,
} from '../../utils/validity';
import classes from './Shell.module.css';

const ICON = { size: 16, stroke: 1.8 } as const;

/**
 * The "key bar" mark: five bars whose outline is a shield; the centre bar splits into a dot and
 * a stem, a keyhole. Masters live in assets/logo/. At 20 px and below it switches to the
 * three-bar cut, which keeps the keyhole readable.
 */
export function GlcertMark({ size = 24 }: { size?: number }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} fill="var(--gl-brand)" aria-hidden="true">
      {size > 20 ? (
        <>
          <rect x="4" y="10" width="6" height="16" rx="3" />
          <rect x="12.5" y="8" width="6" height="27" rx="3" />
          <circle cx="24" cy="10" r="3.4" />
          <rect x="21" y="17" width="6" height="25" rx="3" />
          <rect x="29.5" y="8" width="6" height="27" rx="3" />
          <rect x="38" y="10" width="6" height="16" rx="3" />
        </>
      ) : (
        <>
          <rect x="5" y="10" width="9" height="20" rx="4.5" />
          <circle cx="24" cy="10.5" r="4.5" />
          <rect x="19.5" y="19" width="9" height="23" rx="4.5" />
          <rect x="34" y="10" width="9" height="20" rx="4.5" />
        </>
      )}
    </svg>
  );
}

interface NavItemProps {
  to: string;
  label: string;
  icon: ReactNode;
  current: boolean;
  rail: boolean;
  count?: number;
  /** Extra words for screen readers and the rail tooltip, such as a warning. */
  note?: string;
  trailing?: ReactNode;
  indent?: number;
  onNavigate?: () => void;
}

function NavItem({
  to,
  label,
  icon,
  current,
  rail,
  count,
  note,
  trailing,
  indent = 0,
  onNavigate,
}: NavItemProps) {
  const spoken = [label, count !== undefined ? String(count) : null, note]
    .filter(Boolean)
    .join(', ');
  return (
    <Tooltip label={note ? `${label}: ${note}` : label} position="right" disabled={!rail}>
      <Link
        to={to}
        className={classes.nav}
        aria-current={current ? 'page' : undefined}
        aria-label={spoken}
        onClick={onNavigate}
        style={indent && !rail ? { paddingLeft: 10 + indent * 12 } : undefined}
      >
        {icon}
        <span className={classes.label} data-label>
          {label}
        </span>
        {trailing}
        {count !== undefined && (
          <span className={classes.count} data-label>
            {count}
          </span>
        )}
      </Link>
    </Tooltip>
  );
}

function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <>
      <div className={classes.sectionHeader} data-label>
        <h2 className="gl-section-label">{title}</h2>
        {action}
      </div>
      <span className={classes.divider} aria-hidden="true" />
    </>
  );
}

interface SidebarProps {
  rail: boolean;
  /** Absent in the phone drawer, which has no rail. */
  onToggleRail?: () => void;
  onNavigate?: () => void;
  inDrawer?: boolean;
}

export function Sidebar({ rail, onToggleRail, onNavigate, inDrawer }: SidebarProps) {
  const { user, hasRole, logout } = useAuth();
  const { pathname } = useLocation();
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme('dark');
  const isViewer = hasRole('viewer');
  const isAdmin = hasRole('admin');

  // Same query keys as the pages, so the sidebar shares their cache and their invalidations.
  // The server already limits both lists to what this user may see.
  const { data: certificates = [] } = useQuery<CertificateSummary[]>({
    queryKey: ['certificates'],
    queryFn: () => authFetchJson('/api/certificates'),
  });
  const { data: authorities = [] } = useQuery<AuthoritySummary[]>({
    queryKey: ['cas'],
    queryFn: () => authFetchJson('/api/ca'),
    enabled: !isViewer,
  });
  const tree = buildAuthorityTree(authorities, certificates);

  const onAuthority = tree.some((n) => pathname === `/ca/${n.authority.id}`);
  const nav = { rail, onNavigate };

  const roleLabel = user ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : '';
  const displayName = user?.name || user?.email || '';
  const nextScheme = scheme === 'dark' ? 'light' : 'dark';

  return (
    <aside
      className={classes.sidebar}
      data-rail={rail || undefined}
      data-drawer={inDrawer || undefined}
      aria-label="Navigation"
    >
      <div className={classes.brand}>
        <Link to="/" className={classes.brandLink} aria-label="GLcert home" onClick={onNavigate}>
          <GlcertMark />
        </Link>
        <span className={classes.wordmark} data-label>
          GLcert
        </span>
        {onToggleRail && (
          <Tooltip label={rail ? 'Expand sidebar' : 'Collapse sidebar'} position="right">
            <button
              type="button"
              className={classes.iconButton}
              aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!rail}
              onClick={onToggleRail}
            >
              <IconLayoutSidebar {...ICON} />
            </button>
          </Tooltip>
        )}
      </div>

      <nav className={classes.section} aria-label="Workspace">
        {!isViewer && (
          <NavItem
            to="/"
            label="Timeline"
            icon={<IconTimeline {...ICON} />}
            current={pathname === '/'}
            {...nav}
          />
        )}
        <NavItem
          to="/certificates"
          label="Certificates"
          icon={<IconCertificate {...ICON} />}
          count={certificates.length}
          current={pathname.startsWith('/certificates')}
          {...nav}
        />
        {!isViewer && (
          <NavItem
            to="/ca"
            label="Authorities"
            icon={<IconShieldCheck {...ICON} />}
            count={authorities.length}
            current={pathname.startsWith('/ca') && !onAuthority}
            {...nav}
          />
        )}
      </nav>

      {!isViewer && tree.length > 0 && (
        <div className={classes.section}>
          <SectionHeader
            title="Authorities"
            action={
              isAdmin && (
                <Link
                  to="/ca/new"
                  className={`${classes.iconButton} ${classes.addButton}`}
                  aria-label="New authority"
                  onClick={onNavigate}
                >
                  <IconPlus size={14} stroke={1.8} />
                </Link>
              )
            }
          />
          {tree.map(({ authority, depth, certificateCount, outliving }) => {
            const warns = outliving.length > 0;
            const note = warns
              ? `${outliving.length} ${outliving.length === 1 ? 'certificate outlives' : 'certificates outlive'} it`
              : undefined;
            return (
              <NavItem
                key={authority.id}
                to={`/ca/${authority.id}`}
                label={authority.name}
                icon={
                  <span className={classes.caIcon} aria-hidden="true">
                    <IconShield {...ICON} />
                    {warns && <span className={classes.warningDot} />}
                  </span>
                }
                count={certificateCount}
                note={note}
                indent={depth}
                trailing={
                  warns && (
                    <span className={classes.warning} data-label aria-hidden="true">
                      <IconAlertTriangle size={14} stroke={1.8} />
                    </span>
                  )
                }
                current={pathname === `/ca/${authority.id}`}
                {...nav}
              />
            );
          })}
        </div>
      )}

      {isAdmin && (
        <nav className={classes.section} aria-label="Admin">
          <SectionHeader title="Admin" />
          <NavItem
            to="/settings"
            label="Settings"
            icon={<IconAdjustmentsHorizontal {...ICON} />}
            current={pathname === '/settings'}
            {...nav}
          />
          <NavItem
            to="/users"
            label="Users"
            icon={<IconUsers {...ICON} />}
            current={pathname === '/users'}
            {...nav}
          />
          <NavItem
            to="/audit"
            label="Audit log"
            icon={<IconList {...ICON} />}
            current={pathname === '/audit'}
            {...nav}
          />
        </nav>
      )}

      <div className={classes.footer}>
        <Tooltip label={displayName} position="right" disabled={!rail}>
          <Link
            to="/profile"
            className={classes.account}
            aria-label={`Your account, ${displayName}`}
            aria-current={pathname === '/profile' ? 'page' : undefined}
            onClick={onNavigate}
          >
            <span className={classes.avatar} aria-hidden="true">
              {displayName.charAt(0).toUpperCase()}
            </span>
            <span className={classes.who} data-label>
              <span className={classes.name}>{displayName}</span>
              <span className="gl-second-line">{roleLabel}</span>
            </span>
          </Link>
        </Tooltip>
        <Tooltip label={`Switch to ${nextScheme} theme`} position="right">
          <button
            type="button"
            className={classes.iconButton}
            data-bordered
            aria-label={`Switch to ${nextScheme} theme`}
            onClick={() => setColorScheme(nextScheme)}
          >
            {scheme === 'dark' ? <IconMoon {...ICON} /> : <IconSun {...ICON} />}
          </button>
        </Tooltip>
        <Tooltip label="Sign out" position="right">
          <button
            type="button"
            className={classes.iconButton}
            data-bordered
            aria-label="Sign out"
            onClick={logout}
          >
            <IconLogout {...ICON} />
          </button>
        </Tooltip>
      </div>
    </aside>
  );
}
