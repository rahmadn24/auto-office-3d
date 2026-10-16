---
name: Autonomous Command HUD
colors:
  surface: '#051424'
  surface-dim: '#051424'
  surface-bright: '#2c3a4c'
  surface-container-lowest: '#010f1f'
  surface-container-low: '#0d1c2d'
  surface-container: '#122131'
  surface-container-high: '#1c2b3c'
  surface-container-highest: '#273647'
  on-surface: '#d4e4fa'
  on-surface-variant: '#c7c4d7'
  inverse-surface: '#d4e4fa'
  inverse-on-surface: '#233143'
  outline: '#908fa0'
  outline-variant: '#464554'
  surface-tint: '#c0c1ff'
  primary: '#c0c1ff'
  on-primary: '#1000a9'
  primary-container: '#8083ff'
  on-primary-container: '#0d0096'
  inverse-primary: '#494bd6'
  secondary: '#4edea3'
  on-secondary: '#003824'
  secondary-container: '#00a572'
  on-secondary-container: '#00311f'
  tertiary: '#ffb95f'
  on-tertiary: '#472a00'
  tertiary-container: '#ca8100'
  on-tertiary-container: '#3e2400'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e1e0ff'
  primary-fixed-dim: '#c0c1ff'
  on-primary-fixed: '#07006c'
  on-primary-fixed-variant: '#2f2ebe'
  secondary-fixed: '#6ffbbe'
  secondary-fixed-dim: '#4edea3'
  on-secondary-fixed: '#002113'
  on-secondary-fixed-variant: '#005236'
  tertiary-fixed: '#ffddb8'
  tertiary-fixed-dim: '#ffb95f'
  on-tertiary-fixed: '#2a1700'
  on-tertiary-fixed-variant: '#653e00'
  background: '#051424'
  on-background: '#d4e4fa'
  surface-variant: '#273647'
typography:
  headline-xl:
    fontFamily: Plus Jakarta Sans
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-xl-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 30px
    fontWeight: '700'
    lineHeight: 38px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.015em
  headline-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 30px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  title-sm:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 26px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
  mono-code:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
  mono-label:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.06em
  label-xs:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.08em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-desktop: 1.5rem
  margin: 1rem
  margin-desktop: 2rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

This design system translates the dual essence of "The Theater & The Brain"—a virtual isometric office simulation fused with real-time autonomous agent operations. The brand targets technical founders, indie hackers, and engineering teams orchestrating multi-agent systems.

The aesthetic fuses cyber-minimalism with high-tactility glassmorphism. It balances the cold precision of high-density terminal interfaces with the inviting, ambient spatial depth of miniature isometric architecture.

Key emotional targets:
- **Mastery & Agency:** Interfaces deliver real-time transparency into complex systemic processes without overwhelming visual noise.
- **Atmospheric Focus:** Dark-slate canvas environments minimize eye fatigue during extended deep-work sessions while directional neon glows anchor situational awareness.
- **Playful Rigor:** Spatial isometric spatialization makes background autonomous tasks legible, tactile, and expressive.

## Colors

The palette is engineered over deep slate structural foundations with high-chroma functional accents mapping directly to organizational agent divisions.

### Structural Canvas
- Canvas Base: `#0c0f17` (Deep space viewport background)
- Canvas Surface / Panel Glass: `#131826` with 65–85% alpha transparency
- Panel Elevated Glass: `#1e2638` with 50% alpha transparency
- Border Micro-Line: `rgba(255, 255, 255, 0.08)` to `rgba(255, 255, 255, 0.14)`

### Agent Division Accents
- **Founder & Product Management (Primary):** Indigo `#6366f1` / Electric Blue `#38bdf8`
- **Engineering & Quality Assurance (Secondary):** Emerald `#10b981` / Bright Cyan `#06b6d4`
- **Infrastructure & DevOps (Tertiary):** Amber `#f59e0b` / Warm Orange `#f97316`
- **Growth & Marketing:** Rose `#f43f5e` / Violet `#a855f7`

### Neutral Hierarchy
- Base Neutral: `#94a3b8`
- High-Emphasis Content: `#f8fafc`
- Mid-Emphasis Subtitles: `#94a3b8`
- Muted Details / Inactive Code: `#475569`

## Typography

The typographic hierarchy implements three distinct roles:
1. **Plus Jakarta Sans** delivers approachable geometric precision for workspace names, viewport mode headings, and critical agent status titles.
2. **Inter** manages ergonomic body density, conversation streams, and analytical feedback.
3. **JetBrains Mono** governs terminal output, status badges, telemetry stats, and token expenditure counts.

Maintain strict casing discipline: all system metadata, telemetry keys, and division badges in `mono-label` or `label-xs` must be rendered in full uppercase with expanded letter spacing.

## Layout & Spacing

The layout is built upon an adaptive viewport architecture divided into two synchronized realms:
1. **The Theater (Spatial Viewport):** An interactive 3D canvas filling the entire parent envelope or primary split.
2. **The Brain (Telemetry HUD):** Floating, glassmorphic docking docks and overlay panels.

### Responsive Rules
- **Desktop (1280px+):** Spatial canvas operates as the central viewport with fixed docking positions (280px agent division sidebar on left; 380px collapsible terminal inspector on right). Gutters adhere to `gutter-desktop` (1.5rem / 24px) with `margin-desktop` (2rem / 32px).
- **Tablet (768px - 1279px):** Inspector slides into an overlay drawer. The agent switcher collapses into an icon-only floating rail.
- **Mobile (<768px):** Theater and Brain toggle via a persistent bottom glass navigation dock. HUD panels render as full-width bottom sheets with 1rem margins.

## Elevation & Depth

Visual depth combines physical isometric layering with glassmorphic spatial tiers:

- **Base Layer (Ground Zero):** Canvas plane `#0c0f17` displaying isometric grid lines (`rgba(255, 255, 255, 0.03)`).
- **Surface Layer (Isometric Objects & Rooms):** Distinct 3D mesh assets radiating division-specific volumetric floor glows (`box-shadow: 0 0 48px -12px [Division Color]`).
- **HUD Glass (Floating Panes):** Background `#131826` rendered at 70% opacity, paired with `backdrop-filter: blur(16px)` and a 1px border of `rgba(255, 255, 255, 0.08)`.
- **Active Focus (Selected Agent / Popover):** Elevation shadow `0 20px 40px -15px rgba(0, 0, 0, 0.7), 0 0 20px 0 rgba(99, 102, 241, 0.15)`, accompanied by crisp micro-borders reflecting light from the top edge (`border-top: 1px solid rgba(255, 255, 255, 0.2)`).

## Shapes

The design system enforces a medium curvature scale (Level 2). This balances the structural rigidity of terminal consoles with the approachable contours of modern workspace tools.

- Standard buttons, input bars, and HUD card corners apply `0.5rem` (8px).
- Larger modal glass frames and floating dock shells apply `1rem` (16px).
- Micro status indicators, division pills, and circular floating viewport controls apply fully rounded geometries (`rounded-full` / `9999px`).

## Components

### Buttons
- **Primary HUD Action:** Solid high-chroma fill (Indigo `#6366f1` or active division accent), dark slate text or high-white text depending on contrast, subtle inner top bevel (`box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.2)`). Hover states produce a localized glow: `box-shadow: 0 0 16px rgba(99, 102, 241, 0.4)`.
- **Secondary Ghost Action:** Transparent glass backdrop with 1px border `rgba(255, 255, 255, 0.12)`, text `#f8fafc`. Hover triggers `background: rgba(255, 255, 255, 0.05)` and border brightening.

### Status Indicators & Division Chips
- Built with `JetBrains Mono` at `label-xs`.
- Prefixed with a pulsating 6px circular dot (`animate-pulse`).
- Background fill uses the division accent color at 10% opacity, border at 25% opacity, and typography matched to 90% accent intensity.

### Agent Console & Code Logs
- Surface styling: `#0c0f17` at 90% opacity, framed by `1px solid rgba(255, 255, 255, 0.06)`.
- Line elements feature dimmed line-number gutters (`#475569`) with active prompt highlights in `#38bdf8`.

### Input Fields
- Dark glass container (`rgba(19, 24, 38, 0.7)`) with crisp `1px solid rgba(255, 255, 255, 0.1)`.
- Focus state shifts border color to the current agent division accent (e.g., Emerald `#10b981` during QA queries) paired with an ambient outer ring: `0 0 0 3px rgba(16, 185, 129, 0.15)`.

### Cards & HUD Windows
- Built with frosted glass layers.
- Card headers incorporate a horizontal hairline separator (`1px solid rgba(255, 255, 255, 0.06)`), miniature window status pips (red, yellow, green), and monospaced diagnostic labels.