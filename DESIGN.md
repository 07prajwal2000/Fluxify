---
name: Fluxify Core
colors:
  surface: "#111417"
  surface-dim: "#111417"
  surface-bright: "#37393d"
  surface-container-lowest: "#0c0e11"
  surface-container-low: "#191c1f"
  surface-container: "#1d2023"
  surface-container-high: "#272a2e"
  surface-container-highest: "#323538"
  on-surface: "#e1e2e7"
  on-surface-variant: "#ccc3d7"
  inverse-surface: "#e1e2e7"
  inverse-on-surface: "#2e3134"
  outline: "#968da1"
  outline-variant: "#4a4455"
  surface-tint: "#d3bbff"
  primary: "#d3bbff"
  on-primary: "#3f008d"
  primary-container: "#a576ff"
  on-primary-container: "#37007c"
  inverse-primary: "#7432df"
  secondary: "#c7c6c9"
  on-secondary: "#303032"
  secondary-container: "#464749"
  on-secondary-container: "#b5b5b7"
  tertiary: "#c4c7ca"
  on-tertiary: "#2d3134"
  tertiary-container: "#8d9195"
  on-tertiary-container: "#262a2d"
  error: "#ffb4ab"
  on-error: "#690005"
  error-container: "#93000a"
  on-error-container: "#ffdad6"
  primary-fixed: "#ebddff"
  primary-fixed-dim: "#d3bbff"
  on-primary-fixed: "#250059"
  on-primary-fixed-variant: "#5b00c5"
  secondary-fixed: "#e3e2e4"
  secondary-fixed-dim: "#c7c6c9"
  on-secondary-fixed: "#1b1c1e"
  on-secondary-fixed-variant: "#464749"
  tertiary-fixed: "#e0e3e6"
  tertiary-fixed-dim: "#c4c7ca"
  on-tertiary-fixed: "#181c1f"
  on-tertiary-fixed-variant: "#43474a"
  background: "#111417"
  on-background: "#e1e2e7"
  surface-variant: "#323538"
typography:
  display-lg:
    fontFamily: Hanken Grotesk
    fontSize: 48px
    fontWeight: "800"
    lineHeight: "1.1"
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Hanken Grotesk
    fontSize: 36px
    fontWeight: "800"
    lineHeight: "1.2"
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Hanken Grotesk
    fontSize: 32px
    fontWeight: "700"
    lineHeight: "1.3"
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: "400"
    lineHeight: "1.6"
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: "400"
    lineHeight: "1.5"
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: "500"
    lineHeight: "1.2"
    letterSpacing: 0.05em
  code-snippet:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: "400"
    lineHeight: "1.5"
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 64px
  gutter: 24px
  container-max: 1200px
---

## Brand & Style

The design system is engineered for a developer-centric SaaS environment, blending technical precision with modern accessibility. It targets engineers, architects, and product leads who value efficiency and clarity.

The aesthetic is **Corporate / Modern** with a technical edge. It leverages high-quality whitespace, a refined dark/light color logic, and subtle structural metaphors like "connected nodes" to reflect the nature of API orchestration. The interface should feel robust, high-performance, and intelligently organized, mirroring the capabilities of an AI-powered backend tool.

## Colors

The palette is anchored by the signature brand purple, used strategically for primary actions and key brand moments.

### Implementation Rules

- **Dark Mode (Default):** Use the secondary color (`#101113`) for the main background. Use the tertiary color for card surfaces and input backgrounds to create depth.
- **Light Mode:** Use a pure white background with light gray (`#F8F9FA`) for containers.
- **Accent:** The primary purple is used for primary buttons, active states, and focus indicators.
- **Functional:** Success, Warning, and Error colors should be high-chroma but balanced to ensure legibility against dark surfaces.

## Typography

This design system uses a triple-font strategy to balance impact, readability, and technical identity.

- **Hanken Grotesk** is used for headlines, providing a sharp, contemporary "tech-giant" feel.
- **Inter** handles all body copy and UI text, ensuring maximum legibility across all screen densities.
- **JetBrains Mono** is utilized for labels, metadata, and code blocks, reinforcing the developer-centric nature of the platform.

Maintain tight line heights for headlines to ensure they feel "locked in," while providing generous leading for body text to improve readability in documentation and long-form descriptions.

## Layout & Spacing

This design system follows a **Fixed Grid** model for marketing pages and a **Fluid Flex** model for the application dashboard.

- **Grid:** A 12-column system is used for desktop (breakpoint 1200px+) with 24px gutters.
- **Rhythm:** An 8px linear scale is the foundation for all spatial relationships.
- **Responsive Behavior:**
  - **Desktop:** 12 columns, 24px margins.
  - **Tablet (768px):** 8 columns, 16px margins.
  - **Mobile (375px):** 4 columns, 16px margins. Headlines scale down using the `-mobile` variants defined in Typography.

## Elevation & Depth

Visual hierarchy is achieved through a combination of **Tonal Layers** and **Ambient Shadows**.

- **Surfaces:** In dark mode, depth is created by lightening the surface color. Background is the darkest, followed by cards, then popovers/modals.
- **Shadows:** Use extra-diffused shadows with a slight purple tint (`rgba(145, 85, 253, 0.1)`) to create a "glow" effect rather than a traditional drop shadow. This keeps the UI feeling lightweight and "airy."
- **Borders:** Low-contrast outlines (1px solid, 10% white/black opacity) are preferred over heavy shadows for secondary containers and input fields.

## Shapes

The shape language is inspired by the Mantine ecosystem—approachable yet structured.

- **Standard Radius:** 0.5rem (8px) is the default for buttons, inputs, and small cards.
- **Large Radius:** 1rem (16px) is used for feature blocks and main container sections.
- **Visual Motif:** Subtle "connected node" patterns (thin lines with 4px circular terminals) should be used as background decorations or as connectors between card elements to reinforce the API builder metaphor.

## Components

### Buttons

- **Primary:** Solid purple background, white text. 8px border radius. On hover, increase brightness slightly.
- **Secondary:** Transparent background with 1px border in primary purple.
- **Ghost:** No border or background; text turns primary purple on hover.

### Cards

- **Marketing Cards:** Use `rounded-lg` (16px) with a subtle 1px border. In dark mode, use a very faint gradient (top-left to bottom-right) to suggest a light source.
- **Interactive Cards:** Increase elevation/shadow on hover to indicate clickability.

### Input Fields

- **Default State:** Darker surface than the background, 8px radius, subtle border.
- **Focus State:** 2px solid primary purple border with a soft outer glow.

### Chips & Badges

- Use JetBrains Mono for badge text. Backgrounds should be low-opacity versions of the status color (e.g., 10% purple for "v1.0").

### Connected Node Pattern

- Use SVG strokes for connectors between UI elements. Lines should be 1.5px wide with a `secondary_color` or `neutral_color` depending on the background contrast.
