@AGENTS.md

## Design System (site/)

TUI-inspired dark theme with semantic color tokens and accessible components.

**Color Palette** (CSS variables):
- `--bg-primary` (#1a1a2e), `--bg-secondary` (#16162a), `--bg-tertiary` (#222240)
- `--text-primary` (#ededf0), `--text-secondary` (#c8c8d4), `--text-muted` (#8888a0)
- `--accent-primary` (#d4845e orange), `--accent-secondary` (#6366f1 indigo)
- `--color-success` (#4ade80), `--color-warning` (#fbbf24), `--color-error` (#ef4444), `--color-info` (#3b82f6)

**Typography**:
- Monospace ('JetBrains Mono'): headings, labels, code, badges
- Sans-serif (system): body, descriptions
- Font weights: 400 (normal), 500 (semibold), 600 (bold), 700 (heavy)
- Line heights: 1.2 (headings), 1.6-1.8 (body)

**Components** (.cc-* classes):
- Cards: `.cc-card`, `.cc-card-title`, `.cc-card-desc`
- Buttons: `.cc-btn-primary`, `.cc-btn-ghost` (with focus-visible states)
- Forms: `.cc-input`, `.cc-textarea`, `.cc-form-group`, `.cc-form-label`
- Status: `.cc-status`, `.cc-status-{success|warning|error|info}`, `.cc-status-dot`
- Advanced: `.cc-progress`, `.cc-spinner`, `.cc-modal`, `.cc-table`, `.cc-toast`
- Badges: `.cc-badge-cli` (❯ icon), `.cc-badge-ide` (◇ icon)

**Layout**:
- Container max-width: 840px, padding: 0 24px
- Grid: 2-column at desktop, 1-column on mobile (640px breakpoint)
- Spacing scale: 8px, 12px, 16px, 20px, 24px, 28px, 48px

**Features**:
- Subtle grid background via `body::before` (40px cells, 0.02 opacity)
- Transitions: `--transition-fast` (150ms), `--transition-normal` (300ms)
- Animations respect `prefers-reduced-motion`
- WCAG AA accessibility: 4.5:1 contrast, semantic HTML, `:focus-visible` states
- Border radius: `--border-radius` (8px), `--border-radius-sm` (6px)

**Build**: esbuild bundles `site/main.js` → `docs/bundle.js`. Tailwind processes `site/input.css` → `docs/styles.css`.
