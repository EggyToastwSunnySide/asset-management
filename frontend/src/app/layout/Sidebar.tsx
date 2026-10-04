import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { Boxes, ChevronLeft, FileOutput, LogOut, Shapes, ShieldCheck } from 'lucide-react'
import { useAppDispatch, useAppSelector, toggleSidebar } from '@/app/store'
import {
  hasAnyPermission,
  hasEveryPermission,
  useAuthActions,
  useCurrentSessionQuery,
  type PermissionKey,
} from '@/features/auth'
import { cn } from '@/utils/cn'
import styles from './Sidebar.module.css'

interface NavItem {
  to: string
  label: string
  icon: ReactNode
  permissions: readonly PermissionKey[]
  mode?: 'all' | 'any'
}

const NAV_ITEMS: NavItem[] = [
  {
    to: '/inventory',
    label: 'Inventory',
    icon: <Boxes />,
    permissions: ['assets.view'],
  },
  {
    to: '/export-profiles',
    label: 'Export profiles',
    icon: <FileOutput />,
    permissions: ['exportProfiles.view'],
  },
  {
    to: '/asset-types',
    label: 'Asset types',
    icon: <Shapes />,
    permissions: ['assets.view'],
  },
  {
    to: '/admin/access',
    label: 'Access control',
    icon: <ShieldCheck />,
    permissions: ['roles.view', 'users.view'],
    mode: 'any',
  },
]

export function Sidebar() {
  const collapsed = useAppSelector((state) => state.ui.sidebarCollapsed)
  const dispatch = useAppDispatch()
  const { data: session } = useCurrentSessionQuery()
  const { signOut, isSigningOut } = useAuthActions()
  const BrandTag = collapsed ? 'button' : 'div'

  const navItems = NAV_ITEMS.filter((item) =>
    item.mode === 'any'
      ? hasAnyPermission(session, item.permissions)
      : hasEveryPermission(session, item.permissions),
  )

  return (
    <aside className={cn(styles.sidebar, collapsed && styles.collapsed)}>
      <div className={styles.top}>
        <BrandTag
          className={cn(styles.brand, collapsed && styles.collapseBtn)}
          {...(collapsed
            ? {
                type: 'button' as const,
                'aria-label': 'Expand sidebar',
                title: 'Expand sidebar',
                onClick: () => dispatch(toggleSidebar()),
              }
            : {})}
        >
          <span className={styles.brandIconStack}>
            <span className={styles.brandMark} aria-hidden="true">
              <svg viewBox="0 0 28 28">
                <rect x="0" y="0" width="28" height="28" rx="7" fill="var(--color-accent)" />
                <rect x="6" y="6" width="16" height="16" rx="2" fill="none" stroke="#ffffff" strokeWidth="1.6" />
                <line x1="6" y1="12.3" x2="22" y2="12.3" stroke="#ffffff" strokeWidth="1.3" />
                <line x1="6" y1="17.6" x2="22" y2="17.6" stroke="#ffffff" strokeWidth="1.3" />
                <line x1="12.6" y1="6" x2="12.6" y2="22" stroke="#ffffff" strokeWidth="1.3" />
              </svg>
            </span>
            <ChevronLeft strokeWidth={2.4} className={styles.collapseHoverIcon} aria-hidden="true" />
          </span>
          <span className={styles.brandWord}>
            Asset<span className={styles.brandWordAccent}>Ledger</span>
          </span>
        </BrandTag>

        {!collapsed && (
          <button
            type="button"
            className={styles.collapseBtn}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            onClick={() => dispatch(toggleSidebar())}
          >
            <ChevronLeft strokeWidth={2.4} className={styles.collapseIcon} />
          </button>
        )}
      </div>

      <nav className={styles.nav} aria-label="Primary navigation">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            title={item.label}
            className={({ isActive }) => cn(styles.navItem, isActive && styles.navItemActive)}
          >
            <span className={styles.navIcon}>{item.icon}</span>
            <span className={styles.navLabel}>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className={styles.footer}>
        <div className={styles.identity}>
          <strong title={session?.user.email}>{session?.user.displayName}</strong>
          <span>{session?.roles.map((role) => role.name).join(', ') || 'No assigned role'}</span>
        </div>
        <button
          type="button"
          className={styles.signOut}
          aria-label="Sign out"
          title="Sign out"
          disabled={isSigningOut}
          onClick={() => void signOut()}
        >
          <LogOut size={17} aria-hidden="true" />
          <span>{isSigningOut ? 'Signing out…' : 'Sign out'}</span>
        </button>
      </div>
    </aside>
  )
}
