# Design System Master File — OrbitaTI

## LEIA PRIMEIRO: a marca manda, a skill complementa

Este arquivo foi gerado pela skill `ui-ux-pro-max` (consulta: "B2B CRM productivity app dark mode minimal
trustworthy", dials variance 4 / motion 3 / density 6). Antes dela foram tentadas outras duas consultas,
descartadas: a do prompt (em português) caiu em padrão de *landing page* com vídeo e paleta clara; a segunda
caiu em "HUD / Sci-Fi", que a própria skill marca como risco alto de acessibilidade.

**Onde esta seção e o texto gerado abaixo divergirem, vale esta seção.** A fonte da verdade das cores é
`web/src/estilos/tokens.css` (contrastes medidos e anotados lá).

| Tema | Skill sugeriu | Decisão OrbitaTI (marca) | Por quê |
|---|---|---|---|
| Paleta | Azul `#2563EB` + CTA laranja `#EA580C`, fundo `#0F172A` | Paleta extraída da logo: fundo `#020A1F`, ciano `#42DEF7`, teal `#24E0D1`, azul `#307FDC`, índigo `#4769E5` | A identidade é a logo; laranja não existe na marca |
| Botão primário | Laranja com texto preto | Escuro: gradiente `#42DEF7 → #307FDC` com texto `#020A1F` (4,9:1). Claro: `#1D5FC0` com texto branco (6,1:1) | Texto branco no `#307FDC` dá 4,0:1 e reprova no AA |
| Fontes | Plus Jakarta Sans via Google Fonts | Montserrat 700/800 (títulos e logotipo) + Inter (interface), auto-hospedadas via `@fontsource`, só subconjunto latino | O lettering da logo é Montserrat; sem CDN porque a VM pode ter saída restrita e não repassamos IP a terceiros (LGPD) |
| Estilo | Glassmorphism (backdrop blur 10–20 px) | Dark Mode (OLED) da skill, com glow mínimo | Blur em camadas pesa no celular e no Lighthouse; Dark Mode tem risco de acessibilidade baixo |
| Glow | — | Só na logo, foco, botão primário, item ativo e mapa de órbita. Cartões e listas não brilham | Brilho em tudo vira ruído e reduz legibilidade |
| Movimento | GSAP + ScrollTrigger (scroll reveal) | Sem GSAP. Transições CSS de 150–220 ms; única animação contínua é o anel tracejado do mapa (120 s/volta). `prefers-reduced-motion` desliga tudo | Orçamento de JS de 170 KB gzip; CRM de uso diário não precisa de revelação no scroll |
| Padrão de página | Hero + Features + CTA | Aplicativo: barra inferior no celular, barra lateral no desktop | O Portal é ferramenta, não página de venda |
| Hover de cartão | `translateY(-2px)` + sombra | Sem deslocamento; só cor/borda | O anti-padrão "layout-shifting hovers" da própria skill |
| Modal | Fundo branco, `backdrop-filter: blur(4px)` | `superficie-elevada` + véu `--veu`, sem blur | Coerência com o tema e desempenho |
| Tema claro | Era o padrão da paleta da skill | Escuro é o padrão; claro por `prefers-color-scheme` ou alternador manual (escolha manual vence) | A identidade é escura; o claro serve para ler no sol |
| Ícones | Heroicons/Lucide | Só `lucide-react`, traço 2, `aria-hidden` quando decorativo | Um estilo só |

**Aproveitado da skill sem mudança:** espaçamento em escala de 4 px (densidade 6), alvos de toque ≥ 44 px,
foco visível, erro junto ao campo com `aria-describedby`, toasts com região `aria-live` e 3–5 s, skeleton,
`lazy()` por rota, chaves estáveis em listas, inputs controlados com `label htmlFor`, os anti-padrões
(emoji como ícone, sem `cursor-pointer`, hover que desloca layout, contraste baixo, foco invisível) e o
checklist de pré-entrega no fim deste arquivo.

**Tokens acrescentados ao tema claro** (não vieram no prompt, medidos na superfície `#FFFFFF`):
`texto-mudo #5B7089` (5,1:1), `sucesso #047857` (5,5:1), `gradiente-ti #307FDC → #1D5FC0` (o "TI" em ciano
some no fundo claro).

---

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** OrbitaTI
**Generated:** 2026-11-07 16:40:08
**Category:** SaaS (General)
**Design Dials:** Variance 4/10 (Balanced / Modern) | Motion 3/10 (Subtle) | Density 6/10 (Standard)

---

## Global Rules

### Color Palette

| Role | Hex | CSS Variable |
|------|-----|--------------|
| Primary | `#2563EB` | `--color-primary` |
| On Primary | `#FFFFFF` | `--color-on-primary` |
| Secondary | `#3B82F6` | `--color-secondary` |
| On Secondary | `#000000` | `--color-on-secondary` |
| Accent/CTA | `#EA580C` | `--color-accent` |
| On Accent/CTA | `#000000` | `--color-on-accent` |
| Background | `#0F172A` | `--color-background` |
| Foreground | `#F8FAFC` | `--color-foreground` |
| Card | `#111827` | `--color-card` |
| Card Foreground | `#F8FAFC` | `--color-card-foreground` |
| Muted | `#1E293B` | `--color-muted` |
| Muted Foreground | `#CBD5E1` | `--color-muted-foreground` |
| Border | `#334155` | `--color-border` |
| Destructive | `#DC2626` | `--color-destructive` |
| On Destructive | `#FFFFFF` | `--color-on-destructive` |
| Ring | `#2563EB` | `--color-ring` |

**Color Notes:** Trust blue + orange CTA contrast [Accent adjusted from #F97316]

### Typography

- **Heading Font:** Plus Jakarta Sans
- **Body Font:** Plus Jakarta Sans
- **Mood:** friendly, modern, saas, clean, approachable, professional
- **Google Fonts:** [Plus Jakarta Sans + Plus Jakarta Sans](https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap)

**CSS Import:**
```css
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap');
```

### Spacing Variables

*Density: 6/10 — Standard*

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `4px` / `0.25rem` | Tight gaps |
| `--space-sm` | `8px` / `0.5rem` | Icon gaps, inline spacing |
| `--space-md` | `16px` / `1rem` | Standard padding |
| `--space-lg` | `24px` / `1.5rem` | Section padding |
| `--space-xl` | `32px` / `2rem` | Large gaps |
| `--space-2xl` | `48px` / `3rem` | Section margins |
| `--space-3xl` | `64px` / `4rem` | Hero padding |

### Shadow Depths

| Level | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Subtle lift |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.1)` | Cards, buttons |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)` | Modals, dropdowns |
| `--shadow-xl` | `0 20px 25px rgba(0,0,0,0.15)` | Hero images, featured cards |

---

## Component Specs

### Buttons

```css
/* Primary Button */
.btn-primary {
  background: #EA580C;
  color: #000000;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}

.btn-primary:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}

/* Secondary Button */
.btn-secondary {
  background: transparent;
  color: #F8FAFC;
  border: 2px solid #2563EB;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}
```

### Cards

```css
.card {
  background: #0F172A;
  border-radius: 12px;
  padding: 24px;
  box-shadow: var(--shadow-md);
  transition: all 200ms ease;
  cursor: pointer;
}

.card:hover {
  box-shadow: var(--shadow-lg);
  transform: translateY(-2px);
}
```

### Inputs

```css
.input {
  padding: 12px 16px;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  font-size: 16px;
  transition: border-color 200ms ease;
}

.input:focus {
  border-color: #2563EB;
  outline: none;
  box-shadow: 0 0 0 3px #2563EB20;
}
```

### Modals

```css
.modal-overlay {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.modal {
  background: white;
  border-radius: 16px;
  padding: 32px;
  box-shadow: var(--shadow-xl);
  max-width: 500px;
  width: 90%;
}
```

---

## Style Guidelines

**Style:** Glassmorphism

**Keywords:** Frosted glass, transparent, blurred background, layered, vibrant background, light source, depth, multi-layer

**Best For:** Modern SaaS, financial dashboards, high-end corporate, lifestyle apps, modal overlays, navigation

**Key Effects:** Backdrop blur (10-20px), subtle border (1px solid rgba white 0.2), light reflection, Z-depth

### Page Pattern

**Pattern Name:** Hero + Features + CTA

- **Conversion Strategy:** Deep CTA placement. For CTA label text, verify at least 4.5:1 against the button fill; use 7:1 only when the product explicitly targets AAA normal-text contrast. Keep focus and component boundaries independently visible. Disable hero parallax under reduced motion and render its static final state.
- **CTA Placement:** Hero (sticky) + Bottom
- **Section Order:** Hero with headline/image > Value prop > Key features (3-5) > CTA section > Footer

---

## Motion

**Scroll Reveal** (Subtle) — Trigger: scroll (viewport enter) | Duration: 300-400ms | Easing: `power1.out`

```js
gsap.from(el, { opacity: 0, y: 12, duration: 0.35, ease: 'power1.out', scrollTrigger: { trigger: el, start: 'top 90%', toggleActions: 'play none none reverse' } });
```

**Framework notes:** Requires the ScrollTrigger plugin registered once via gsap.registerPlugin(ScrollTrigger); Use matchMedia('(prefers-reduced-motion: reduce)') to skip non-essential motion and render the final state immediately

- ✅ Keep the y offset small (8-16px) so it reads as a fade, not a slide
- ❌ Don't reveal below-the-fold content needed for SEO/crawlers as invisible-by-default without a no-JS fallback
- ⚡ toggleActions 'play none none reverse' avoids re-triggering on every scroll direction change

---

## Anti-Patterns (Do NOT Use)

- ❌ Excessive animation

### Additional Forbidden Patterns

- ❌ **Emojis as icons** — Use SVG icons (Heroicons, Lucide, Simple Icons)
- ❌ **Missing cursor:pointer** — All clickable elements must have cursor:pointer
- ❌ **Layout-shifting hovers** — Avoid scale transforms that shift layout
- ❌ **Low contrast text** — Maintain 4.5:1 minimum contrast ratio
- ❌ **Instant state changes** — Always use transitions (150-300ms)
- ❌ **Invisible focus states** — Focus states must be visible for a11y

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon set (Heroicons/Lucide)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile
