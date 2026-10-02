import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { Boxes, ChevronLeft, FileOutput, Shapes } from 'lucide-react'
import { useAppDispatch, useAppSelector, toggleSidebar } from '@/app/store'
import { cn } from '@/utils/cn'
import styles from './Sidebar.module.css'

interface NavItem {
  to: string
  label: string
  icon: ReactNode
}

const NAV_ITEMS: NavItem[] = [
  {
    to: '/inventory',
    label: 'Inventory',
    icon: <Boxes />,
  },
  {
    to: '/export-profiles',
    label: 'Export profiles',
    icon: <FileOutput />,
  },
  {
    to: '/asset-types',
    label: 'Asset types',
    icon: <Shapes />,
  },
]

export function Sidebar() {
  const collapsed = useAppSelector((state) => state.ui.sidebarCollapsed)
  const dispatch = useAppDispatch()
  const BrandTag = collapsed ? 'button' : 'div'

  return (
    <aside className={cn(styles.sidebar, collapsed && styles.collapsed)}>
      <div className={styles.top}>
        {/* Collapsed, the brand IS the expand control, so it has to be a real
            button — otherwise collapsing the sidebar strands keyboard users
            with no focusable way to bring it back. */}
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

        {!collapsed &&
          <button
            type="button"
            className={styles.collapseBtn}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            onClick={() => dispatch(toggleSidebar())}
          >
            <ChevronLeft strokeWidth={2.4} className={styles.collapseIcon} />
          </button>
        }
      </div>

      <nav className={styles.nav}>
        {NAV_ITEMS.map((item) => (
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

      <div className={styles.footer}>Signed in as Phu &middot; Asset Manager</div>
    </aside>
  )
}
