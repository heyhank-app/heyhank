# Design-DNA — Markus Stoeger Style Guide

Alle Projekte MUESSEN diesem Design-Standard folgen. Das ist der Qualitaetsmassstab.

## Referenz-Websites (IMMER als Inspiration nutzen!)
- https://gastro-demo.markusstoeger.com/ — Gastro/Restaurant (Luxury Editorial)
- https://baseloq.com/ — SaaS (Warm, Approachable)
- https://voltah2.markusstoeger.com/ — Automotive/Tech (Dark Futuristic)
- https://headlesswoo.markusstoeger.com/de — Developer Product (Professional Clean)

## Signatur-Elemente (PFLICHT in jedem Projekt)

### 1. Scroll-Triggered Animations
- Elemente starten bei opacity: 0 und werden beim Scrollen sichtbar
- Word-by-Word Reveal fuer wichtige Texte (einzelne <span> Woerter)
- Staggered fade-in mit zunehmenden Delays

### 2. Typography System
- IMMER Serif + Sans-Serif Kombination (z.B. Playfair Display + DM Sans)
- NIEMALS generische Fonts (Inter, Roboto, Arial als alleinige Font)
- Fluid Sizing mit clamp() fuer Headlines (bis 14rem auf Desktop)
- Uppercase Micro-Labels mit tracking-widest ueber Hauptueberschriften

### 3. Color Strategy
- EIN starker Accent-Color pro Projekt (passend zur Branche)
  - Gastro: Gold/Amber (#8b6914, #c8a96e)
  - SaaS: Orange/Warm (#f97316)
  - Tech: Electric Cyan (#00D4FF)
  - Developer: Cyan-Blue Gradient (cyan-500 to blue-500)
- Opacity-basierte Text-Hierarchie (0.9, 0.5, 0.3) statt verschiedene Farben
- Accent sparsam aber konsistent einsetzen (Labels, Highlights, CTAs)

### 4. Layout & Spacing
- Section-basiertes Storytelling mit grosszuegigem Vertical Padding (py-20 bis py-48)
- Jede Section erzaehlt EINE Geschichte
- min-height: 100svh fuer Hero-Sections
- Max-width Container (max-w-5xl, max-w-6xl) zentriert

### 5. Background & Atmosphere
- NIEMALS flache einfarbige Hintergruende
- Layered Treatments: Blur-Orbs, Noise-Textures, Radial Gradients
- Video-Hintergruende fuer Hero-Sections wenn moeglich
- Gradient-Overlays (2-3 Layer) ueber Bilder/Videos fuer Tiefe

### 6. Interactive Elements
- Hover-Zoom auf Bilder (scale-105, 700ms transition)
- Decorative Border-Corners oder Akzent-Linien
- Animated Progress Bars und Counter-Animations
- Subtle Card-Hover-Effects (translate-y, shadow)

### 7. Tech Stack
- Next.js 15 (App Router)
- Tailwind CSS 4
- TypeScript
- Responsive: Mobile-First

## Branchenspezifische Varianten

### Gastro/Restaurant
- Warm, organic, luxury editorial
- Gold/Amber Accent
- Serif-Italic fuer Markennamen
- Floating Partikel-Animationen
- Video-Hero mit warmem Gradient-Overlay

### SaaS/Dashboard
- Clean, approachable, warm (NICHT kalt-technisch!)
- Orange/Amber Accent (NICHT das typische Lila/Blau)
- 3D-rotierte Product Mockups im Hero
- WhatsApp/Chat-Simulationen als Demo
- Blurred Background Orbs

### Tech/Automotive
- Dark-Mode, futuristisch, cinematic
- Cyan/Electric Blue Accent
- Riesige Typography (bis 14rem)
- Custom Cursor
- Pulsierende Animationen, SVG-Diagramme

### Developer/B2B
- Professional, trustworthy, editorial
- Cyan-Blue Gradient Accent
- Before/After Vergleiche
- Monospace fuer Zahlen/Metriken
- Animated Progress Bars

## QUALITAETS-CHECK
Vor dem Deploy pruefen:
- [ ] Scroll-Animations vorhanden?
- [ ] Serif + Sans Font-Pairing?
- [ ] Kein generisches AI-Design?
- [ ] Layered Backgrounds (keine flachen Farben)?
- [ ] Accent-Color konsistent durchgezogen?
- [ ] Fluid Typography mit clamp()?
- [ ] Uppercase Micro-Labels?
- [ ] Mobile responsive und getestet?
