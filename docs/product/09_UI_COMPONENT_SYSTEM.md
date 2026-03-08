# UI Component System

> Agora — Reusable component specifications for web and mobile

---

## Design Tokens Reference

Before defining components, these are the Agora design tokens already established in the codebase.

| Token | Value | Usage |
|-------|-------|-------|
| Primary | `#2563EB` (Blue 600) | Primary actions, active states, links |
| Success | `#16A34A` (Green 600) | Positive indicators, confirmations |
| Danger | `#DC2626` (Red 600) | Errors, destructive actions, alerts |
| Warning | `#D97706` (Amber 600) | Warnings, pending states |
| Surface | `#F9FAFB` (Gray 50) | Page backgrounds |
| Border | `#E5E7EB` (Gray 200) | Card borders, dividers |
| Text Primary | `#111827` (Gray 900) | Headings, primary text |
| Text Secondary | `#6B7280` (Gray 500) | Labels, secondary text |
| Border Radius | `8px` | Cards, buttons |
| Border Radius SM | `6px` | Badges, chips |

---

## 1. Hero Dashboard Card

**Purpose:** Top-level KPI card displayed at the top of role-specific dashboards. Shows the single most important metric with visual emphasis.

**Variants:**

| Variant | When Used |
|---------|-----------|
| `metric` | Displays a large number with label (e.g., "Total Students: 450") |
| `progress` | Displays a number with a circular or bar progress indicator |
| `trend` | Displays a number with a directional arrow and percentage change |

**States:** `default`, `loading` (skeleton shimmer), `error` (retry prompt), `empty` (zero value with muted styling)

**Props / Fields:**

| Prop | Type | Description |
|------|------|-------------|
| `title` | string | KPI label (e.g., "Collection Rate") |
| `value` | string or number | Primary metric value |
| `subtitle` | string (optional) | Supporting text (e.g., "This month") |
| `trend` | object (optional) | `{ direction: 'up' | 'down' | 'flat', percentage: number }` |
| `icon` | component (optional) | Leading icon |
| `accentColor` | string | Override color for the value and icon |
| `onClick` | function (optional) | Navigation handler |

**Role Accent Behavior:** The card border or icon uses the role's theme accent (e.g., blue for admin, green for teacher, amber for accountant).

**Mobile Simplification:** Rendered as a compact horizontal card with value and trend inline. No subtitle on small screens. Swipeable in a horizontal scroll if multiple cards exist.

---

## 2. Stat Card

**Purpose:** Secondary metric card for supporting KPIs. Used in grids below the hero card.

**Variants:** `default`, `compact`

**States:** `default`, `loading`, `empty`

**Props / Fields:**

| Prop | Type | Description |
|------|------|-------------|
| `label` | string | Metric name |
| `value` | string or number | Metric value |
| `icon` | component (optional) | Category icon |
| `color` | string | Accent color (success, danger, warning, primary) |
| `footer` | string (optional) | Additional context (e.g., "vs. last month") |

**Role Accent Behavior:** Uses the `color` prop. No role-specific override.

**Mobile Simplification:** 2-column grid layout. Footer text hidden on screens < 375px.

---

## 3. Alert Card

**Purpose:** Prominent notification card for actionable alerts (overdue invoices, pending approvals, system warnings).

**Variants:**

| Variant | Color | Icon |
|---------|-------|------|
| `info` | Blue | Info circle |
| `warning` | Amber | Warning triangle |
| `danger` | Red | X circle |
| `success` | Green | Check circle |

**States:** `default`, `dismissed` (hidden with animation)

**Props / Fields:**

| Prop | Type | Description |
|------|------|-------------|
| `title` | string | Alert heading |
| `message` | string | Alert body |
| `variant` | enum | info, warning, danger, success |
| `action` | object (optional) | `{ label: string, onClick: function }` |
| `dismissible` | boolean | Whether user can dismiss |

**Mobile Simplification:** Full-width banner. Action button stacks below the message.

---

## 4. Profile Header

**Purpose:** User or student profile header with avatar, name, role badges, and key metadata.

**Variants:** `student`, `staff`, `parent`

**States:** `default`, `loading`

**Props / Fields:**

| Prop | Type | Description |
|------|------|-------------|
| `avatarUrl` | string (optional) | Profile image URL |
| `name` | string | Full name |
| `code` | string (optional) | Student code or staff code |
| `subtitle` | string | Grade + section, designation, or relation |
| `badges` | array | Status and role badges |
| `actions` | array (optional) | Action buttons (Edit, Message, Export) |
| `metadata` | array | Key-value pairs shown below the name |

**Role Accent Behavior:** Role badges use role-specific colors. Student status badge uses lifecycle colors from `04_LIFECYCLE_STATE_MATRIX.md`.

**Mobile Simplification:** Avatar + name + code in a compact horizontal layout. Metadata collapsed behind a "More" toggle. Actions shown as icon buttons.

---

## 5. Data Table

**Purpose:** Primary data display for lists of records (students, invoices, attendance, etc.).

**Variants:** `default`, `compact` (smaller rows for dense data), `selectable` (with checkboxes)

**States:** `default`, `loading` (skeleton rows), `empty` (empty state component), `error` (retry prompt)

**Props / Fields:**

| Prop | Type | Description |
|------|------|-------------|
| `columns` | array | `{ key, label, sortable, width, render }` |
| `data` | array | Row data objects |
| `pagination` | object | `{ page, pageSize, totalItems, onPageChange }` |
| `sortable` | boolean | Enable column header sorting |
| `onRowClick` | function (optional) | Row click handler |
| `selectedRows` | array (optional) | For selectable variant |
| `onSelectionChange` | function (optional) | Selection change handler |
| `actions` | array (optional) | Per-row action buttons |
| `emptyState` | component | Custom empty state display |

**Role Accent Behavior:** No role-specific styling. Action buttons use standard primary/danger colors.

**Mobile Simplification:** Data table converts to a card list on screens < 768px. Each row renders as a card with key fields visible and secondary fields collapsed. Pagination becomes "Load more" or infinite scroll.

---

## 6. Filter Bar

**Purpose:** Horizontal filter controls above data tables and lists.

**Variants:** `inline` (all filters visible), `collapsible` (filters behind a toggle on mobile)

**States:** `default`, `active` (when filters are applied, show a clear-all button)

**Props / Fields:**

| Prop | Type | Description |
|------|------|-------------|
| `filters` | array | `{ key, label, type, options, defaultValue }` |
| `type` options | enum | `select`, `date`, `dateRange`, `search`, `multiSelect` |
| `onFilterChange` | function | Callback with filter state object |
| `onClear` | function | Reset all filters |
| `activeCount` | number | Number of active filters (shown as badge) |

**Role Accent Behavior:** None.

**Mobile Simplification:** Filters collapse into a bottom sheet or modal. A "Filters" button with active count badge triggers the sheet. Search field remains visible above the list.

---

## 7. Form Section Block

**Purpose:** Groups related form fields with a heading and optional description.

**Variants:** `default`, `card` (wrapped in a card with border)

**States:** `default`, `disabled` (all fields disabled), `error` (section has validation errors)

**Props / Fields:**

| Prop | Type | Description |
|------|------|-------------|
| `title` | string | Section heading |
| `description` | string (optional) | Helper text below heading |
| `children` | ReactNode | Form fields |
| `collapsible` | boolean (optional) | Allow section to collapse |
| `defaultExpanded` | boolean | Initial collapse state |

**Mobile Simplification:** Always full-width. Collapsible sections default to collapsed on mobile to reduce scrolling.

---

## 8. Step Wizard

**Purpose:** Multi-step form flow (import preview, admission form, bulk invoice generation).

**Variants:** `horizontal` (steps shown in a horizontal bar), `vertical` (steps shown in a sidebar)

**States:** Per step: `pending`, `active`, `completed`, `error`

**Props / Fields:**

| Prop | Type | Description |
|------|------|-------------|
| `steps` | array | `{ key, label, description, component }` |
| `currentStep` | number | Active step index |
| `onStepChange` | function | Step navigation handler |
| `allowSkip` | boolean | Whether steps can be skipped |
| `onComplete` | function | Final step completion handler |

**Role Accent Behavior:** None.

**Mobile Simplification:** Steps display as a compact numbered indicator. Step labels hidden; only the current step title is shown. Navigation via Next/Back buttons at the bottom.

---

## 9. Import Preview Table

**Purpose:** Displays parsed import data before execution, highlighting valid and invalid rows.

**Variants:** `preview` (pre-execution), `result` (post-execution with success/failure per row)

**States:** `default`, `loading`, `error`

**Props / Fields:**

| Prop | Type | Description |
|------|------|-------------|
| `columns` | array | Column definitions with mapped field names |
| `rows` | array | Row data with validation status |
| `validCount` | number | Number of valid rows |
| `invalidCount` | number | Number of invalid rows |
| `errors` | array | Per-row error details `{ rowNumber, field, issue }` |
| `onExecute` | function | Confirm and execute handler |
| `onCancel` | function | Cancel handler |

**Row Styling:**
- Valid rows: default background
- Invalid rows: light red background with error icon
- Hover on invalid row: tooltip or inline expansion showing field-level errors

**Mobile Simplification:** Not applicable. Import is a web-only operation. If needed on mobile, show a summary card instead of the full table.

---

## 10. Timeline Card

**Purpose:** Single event in the parent daily timeline feed.

**Variants:**

| Variant | Icon | Color |
|---------|------|-------|
| `attendance` | Checkmark / X | Green (present), Red (absent), Amber (late) |
| `homework` | Book | Primary |
| `score` | Trophy | Primary |
| `event` | Calendar | Primary |
| `notification` | Bell | Gray |
| `fee` | Dollar | Amber (due), Red (overdue) |
| `discipline` | Shield | Amber (minor), Red (major) |

**States:** `default`, `loading`

**Props / Fields:**

| Prop | Type | Description |
|------|------|-------------|
| `type` | enum | Event type (determines icon and color) |
| `time` | string | Time of the event |
| `title` | string | Event title |
| `subtitle` | string (optional) | Supporting detail |
| `data` | object | Type-specific payload |
| `onTap` | function (optional) | Detail navigation handler |

**Role Accent Behavior:** None. Colors are determined by event type.

**Mobile Simplification:** This is primarily a mobile component. On web, rendered in a single-column feed. Each card is tappable to expand or navigate.

---

## 11. Status Badge

**Purpose:** Inline colored badge showing entity status.

**Variants:** Derived from entity lifecycle states. See `04_LIFECYCLE_STATE_MATRIX.md` for the full color mapping.

**States:** `default` only (badges are static indicators).

**Props / Fields:**

| Prop | Type | Description |
|------|------|-------------|
| `status` | string | Status code (e.g., `active`, `overdue`, `expelled`) |
| `entity` | string | Entity type for color resolution (e.g., `student`, `invoice`, `staff`) |
| `size` | enum | `sm`, `md` |

**Color Mapping Summary:**

| Color | Status Values |
|-------|--------------|
| Green | `active`, `present`, `paid`, `completed`, `admitted` |
| Amber | `partial`, `on_leave`, `late`, `warning`, `under_review`, `waitlisted` |
| Red | `overdue`, `absent`, `expelled`, `terminated`, `suspended`, `failed`, `critical` |
| Blue | `issued`, `upcoming`, `current`, `validating`, `executing`, `accepted` |
| Gray | `inactive`, `draft`, `graduated`, `withdrawn`, `transferred_out`, `cancelled`, `resigned`, `leave`, `queued`, `revoked`, `expired`, `rejected` |

**Mobile Simplification:** Same rendering. `sm` size used in list items, `md` in detail views.

---

## 12. Empty State

**Purpose:** Shown when a list or section has no data.

**Variants:** `no_data` (initial state), `no_results` (search/filter returned nothing), `error` (failed to load)

**States:** `default`

**Props / Fields:**

| Prop | Type | Description |
|------|------|-------------|
| `variant` | enum | no_data, no_results, error |
| `title` | string | Heading (e.g., "No students found") |
| `message` | string | Explanatory text |
| `icon` | component (optional) | Illustration or icon |
| `action` | object (optional) | `{ label, onClick }` for CTA button |

**Role Accent Behavior:** None.

**Mobile Simplification:** Centered vertically in the available space. Illustration scaled down.

---

## 13. Chart Card

**Purpose:** Wraps a chart (line, bar, donut, area) in a card with a title and optional filters.

**Variants:** `line`, `bar`, `donut`, `area`

**States:** `default`, `loading` (skeleton), `empty` (no data message), `error`

**Props / Fields:**

| Prop | Type | Description |
|------|------|-------------|
| `title` | string | Chart heading |
| `chartType` | enum | line, bar, donut, area |
| `data` | array | Chart data points |
| `xKey` | string | X-axis field name |
| `yKey` | string or array | Y-axis field name(s) |
| `colors` | array (optional) | Custom color palette |
| `height` | number | Chart height in pixels |
| `legend` | boolean | Show legend |

**Role Accent Behavior:** None. Colors are determined by data series.

**Mobile Simplification:** Chart height reduced. Legend moved below the chart. Touch-enabled tooltips replace hover tooltips.

---

## 14. Section Summary Strip

**Purpose:** Horizontal summary bar shown at the top of list pages, displaying aggregate counts.

**Variants:** `default`

**States:** `default`, `loading`

**Props / Fields:**

| Prop | Type | Description |
|------|------|-------------|
| `items` | array | `{ label, value, color, onClick }` |

**Example:**
```
| Total: 450 | Active: 420 | Inactive: 15 | Graduated: 10 | Withdrawn: 5 |
```

**Role Accent Behavior:** None.

**Mobile Simplification:** Horizontal scrollable strip. Each item is a compact chip.

---

## 15. Quick Action Panel

**Purpose:** Floating or docked panel with contextual quick actions.

**Variants:** `sidebar` (docked right), `floating` (FAB on mobile), `dropdown` (triggered by button)

**States:** `default`, `expanded`, `collapsed`

**Props / Fields:**

| Prop | Type | Description |
|------|------|-------------|
| `actions` | array | `{ label, icon, onClick, variant, disabled }` |
| `variant` | enum | sidebar, floating, dropdown |

**Role Accent Behavior:** Actions are filtered based on the user's role. Only actions the user has permission for are displayed.

**Mobile Simplification:** Rendered as a floating action button (FAB) in the bottom-right corner. Tapping the FAB expands a radial or vertical action menu. Each action shows an icon and short label.
