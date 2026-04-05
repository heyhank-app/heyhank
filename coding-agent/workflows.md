# Workflows — Projekttyp-spezifische Ablaufpläne

## Workflow-Phasen (gilt für ALLE Projekttypen)

Jedes Projekt durchläuft diese 8 Phasen in dieser Reihenfolge.
Der Orchestrator aktiviert pro Phase nur die relevanten Sub-Agenten.

```
Phase 1: DISCOVERY     → Research, Anforderungen, Zielgruppe
Phase 2: PLANUNG       → Architektur, Tech-Stack, Zeitplan
Phase 3: DESIGN        → UI/UX, Prototyping, Brand
Phase 4: ENTWICKLUNG   → Frontend, Backend, Integrationen
Phase 5: QUALITÄT      → Tests, Security, Performance, SEO
Phase 6: DEPLOYMENT    → CI/CD, Hosting, DNS, SSL
Phase 7: LAUNCH        → Analytics, Marketing, Content
Phase 8: BETRIEB       → Monitoring, Support, Optimierung
```

---

## Projekttyp: WEBSITE (Corporate, Portfolio, Landing Page, Blog)

### Phase 1: DISCOVERY
- **Research Agent** → Kundenrecherche, Branche, Zielgruppe
- **Market Research** → Konkurrenzanalyse, Positionierung
- **User Research** → Personas, User Journey
- **Product Manager** → Requirements, Seitenstruktur, Inhalte definieren

### Phase 2: PLANUNG
- **Technology Scout** → Tech-Stack (Next.js/Astro/Hugo, CMS-Wahl)
- **Software Architect** → Seitenarchitektur, Routing, Datenquellen
- **Project Manager** → Meilensteine, Aufgabenverteilung

### Phase 3: DESIGN
- **Brand Identity** → Farbpalette, Typografie, Logo-Einsatz
- **UX Architect** → Informationsarchitektur, Navigation, Wireframes
- **UI Designer** → High-Fidelity Mockups, Responsive Breakpoints
- **Image/Asset Generation** → Hero-Bilder, Icons, Illustrationen

### Phase 4: ENTWICKLUNG
- **Frontend Developer** → Komponenten, Seiten, Routing
- **CSS/Styling Agent** → Responsive Layout, Animationen, Dark Mode
- **CMS Developer** → Content-Modelle, Editor-Workflow (falls CMS)
- **Backend Developer** → Kontaktformular, API-Anbindungen
- **Content Writer** → Texte, SEO-Texte, Meta-Descriptions

### Phase 5: QUALITÄT
- **QA Engineer** → Funktionale Tests, Cross-Browser
- **Code Review** → Code-Qualität prüfen
- **SEO Specialist** → Technical SEO, Meta Tags, Schema, Sitemap
- **Web Performance** → Core Web Vitals, Bildoptimierung, Lazy Loading
- **Accessibility Agent** → WCAG 2.2 AA, Keyboard-Nav, Screenreader
- **Security Engineer** → HTTPS, Headers, Formulare absichern
- **GDPR/Privacy** → Impressum, Datenschutz, Cookie-Consent

### Phase 6: DEPLOYMENT
- **DevOps/CI-CD** → Build-Pipeline, Staging, Production
- **DNS/Domain/SSL** → Domain konfigurieren, SSL, CDN
- **Git Workflow** → Branching, Versionierung, Changelog

### Phase 7: LAUNCH
- **Analytics Setup** → GA4, Tag Manager, Conversion Tracking
- **Social Media** → Launch-Posts, Social Sharing
- **Schema/Structured Data** → Rich Snippets, Organization Schema

### Phase 8: BETRIEB
- **Monitoring/Observability** → Uptime, Error Tracking
- **Cost/Budget** → Hosting-Kosten optimieren

---

## Projekttyp: SAAS (Multi-Tenant Plattform, Subscription, Dashboard)

### Phase 1: DISCOVERY
- **Research Agent** → Marktanalyse, bestehende Lösungen
- **Market Research** → Wettbewerber, Pricing-Modelle
- **User Research** → Personas, Pain Points, User Stories
- **Product Manager** → Feature-Priorisierung, MVP-Definition, Roadmap

### Phase 2: PLANUNG
- **Technology Scout** → Tech-Stack (Next.js/Remix, DB-Wahl, Hosting)
- **Software Architect** → Systemarchitektur, Services, Skalierung
- **Database Architect** → Datenmodell, Multi-Tenancy-Strategie
- **API Designer** → API-Design, Versioning, Rate Limiting
- **Cloud Architect** → Cloud-Infrastruktur, Kosten, Auto-Scaling
- **Project Manager** → Sprint-Planung, MVP-Scope

### Phase 3: DESIGN
- **UX Architect** → Dashboard-Layout, Navigation, User Flows
- **UI Designer** → Design System, Komponenten, Responsive
- **Design System** → Tokens, Varianten, Konsistenz
- **Customer Onboarding** → Welcome Flow, Product Tour
- **Prototyping** → Interaktiver Prototyp für Stakeholder

### Phase 4: ENTWICKLUNG
- **Frontend Developer** → Dashboard, Formulare, State Management
- **CSS/Styling Agent** → Responsive, Themes, Dark Mode
- **Backend Developer** → Business Logic, Middleware, Caching
- **Auth Agent** → OAuth, SSO, MFA, RBAC, JWT
- **Multi-Tenancy** → Tenant-Isolation, Per-Tenant-Config
- **Payment Agent** → Stripe, Subscriptions, Invoicing, Steuern
- **Real-Time/WebSocket** → Notifications, Live-Updates
- **Queue/Background Jobs** → E-Mail-Versand, Async Tasks
- **Email System** → Transaktions-Mails, Templates
- **API Designer** → REST/GraphQL Implementation

### Phase 5: QUALITÄT
- **QA Engineer** → Unit, Integration, E2E Tests
- **Code Review** → Architecture Review, Best Practices
- **Performance Testing** → Lasttests, Skalierbarkeit
- **API Testing** → Endpoint-Tests, Contract Testing
- **Security Engineer** → OWASP, SQL Injection, XSS, CSRF
- **DevSecOps** → Dependency Scanning, Secret Detection
- **Accessibility Agent** → WCAG, Keyboard-Nav
- **Web Performance** → Bundle Size, Caching, CDN

### Phase 6: DEPLOYMENT
- **DevOps/CI-CD** → Pipeline, Staging, Blue-Green Deploy
- **Docker/Container** → Dockerfile, Compose, Registry
- **DNS/Domain/SSL** → Custom Domains für Tenants
- **Monitoring/Observability** → Logging, Metriken, Alerting
- **Git Workflow** → Branching-Strategie, Releases

### Phase 7: LAUNCH
- **Analytics Setup** → Usage Tracking, Conversion Funnels
- **Growth Hacking** → Referral System, Viral Loops
- **CRO (Conversion)** → Pricing Page, Sign-Up Flow
- **Technical Writer** → API Docs, User Guide
- **Legal/Compliance** → AGB, Datenschutz, DPA

### Phase 8: BETRIEB
- **Monitoring/Observability** → 24/7 Monitoring, Alerting
- **Incident Response** → Runbooks, Rollback-Pläne
- **Support Bot** → Help Center, Chatbot
- **A/B Testing** → Feature Tests, Conversion-Optimierung
- **Cost/Budget** → Cloud-Kosten, Unit Economics

---

## Projekttyp: WEBSHOP (E-Commerce, Marktplatz)

### Phase 1: DISCOVERY
- **Research Agent** → Produkte, Branche, Zielgruppe
- **Market Research** → Konkurrenz-Shops, Pricing, USPs
- **User Research** → Kaufverhalten, Personas, Customer Journey
- **Product Manager** → Produktkatalog, Features, MVP

### Phase 2: PLANUNG
- **Technology Scout** → Shopify/WooCommerce/Medusa/Custom
- **Software Architect** → Shop-Architektur, Headless vs. Monolith
- **Database Architect** → Produktmodell, Varianten, Bestellungen
- **API Designer** → Produkt-API, Bestell-API, Webhook-Design
- **Project Manager** → Meilensteine, Launch-Datum

### Phase 3: DESIGN
- **Brand Identity** → Shop-Branding, Vertrauenssignale
- **UX Architect** → Kaufflow, Kategorie-Navigation, Filter
- **UI Designer** → Produktseiten, Warenkorb, Checkout
- **Image/Asset Generation** → Produktbilder, Banner, Icons

### Phase 4: ENTWICKLUNG
- **E-Commerce Platform** → Shop-Setup, Katalog, Inventar
- **Frontend Developer** → Produktlisten, Filter, Suche
- **CSS/Styling Agent** → Responsive Shop, Mobile-First
- **Checkout/Cart** → Warenkorb, Checkout, Rabattcodes
- **Payment Agent** → Stripe, PayPal, Klarna, Apple Pay
- **Backend Developer** → Bestellprozess, Lagerverwaltung
- **Shipping/Logistics** → Versandanbieter, Tracking, Retouren
- **Email System** → Bestellbestätigung, Versandbenachrichtigung
- **Content Writer** → Produktbeschreibungen, Kategorietexte
- **CMS Developer** → Blog, Info-Seiten

### Phase 5: QUALITÄT
- **QA Engineer** → Checkout-Tests, Payment-Tests
- **Code Review** → Sicherheit im Zahlungsflow
- **Cross-Browser/Device** → Shop auf allen Geräten testen
- **SEO Specialist** → Produkt-SEO, Kategorie-SEO
- **Schema/Structured Data** → Product Schema, Review Schema
- **Web Performance** → Bildoptimierung, Ladezeiten
- **Security Engineer** → PCI Compliance, XSS, CSRF
- **GDPR/Privacy** → Cookie-Consent, Datenschutz, Widerruf
- **Accessibility Agent** → Barrierefreier Checkout

### Phase 6: DEPLOYMENT
- **DevOps/CI-CD** → Deploy-Pipeline, Staging-Shop
- **DNS/Domain/SSL** → Domain, SSL, CDN
- **Product Data/Feed** → Google Shopping Feed, Marktplätze
- **Git Workflow** → Release-Management

### Phase 7: LAUNCH
- **Analytics Setup** → E-Commerce Tracking, Conversion Funnels
- **Social Media** → Launch-Kampagne, Produkt-Posts
- **Paid Media/Ads** → Google Shopping Ads, Meta Ads
- **CRO (Conversion)** → Checkout-Optimierung, Upsells

### Phase 8: BETRIEB
- **Monitoring/Observability** → Bestell-Monitoring, Error Tracking
- **Support Bot** → FAQ, Chatbot, Retouren-Hilfe
- **A/B Testing** → Produktseiten, Checkout-Varianten
- **i18n/Localization** → Mehrsprachigkeit (falls international)
- **Multi-Currency** → Währungen, regionale Steuern

---

## Projekttyp: PWA (Progressive Web App)

### Phase 1–3: Wie WEBSITE + zusätzlich:
- **PWA Specialist** → Offline-Strategie, Caching-Konzept

### Phase 4: ENTWICKLUNG (zusätzlich)
- **PWA Specialist** → Service Worker, Web Manifest, Push, Background Sync
- **Real-Time/WebSocket** → Live-Updates, Notifications
- **Animation/Interaction** → App-ähnliche Transitions, Gesten

### Phase 5: QUALITÄT (zusätzlich)
- **Performance Testing** → Offline-Tests, Cache-Validierung
- **Cross-Browser/Device** → PWA-Installation auf iOS/Android/Desktop

---

## Projekttyp: MOBILE APP (iOS, Android)

### Phase 1: DISCOVERY
- Wie SAAS + zusätzlich:
- **App Store Optimization** → Keyword-Research, Konkurrenz-Apps

### Phase 2: PLANUNG (zusätzlich)
- **Mobile Developer** → React Native vs. Flutter vs. Native Entscheidung
- **API Designer** → Mobile-optimierte API, Offline-Sync

### Phase 3: DESIGN (zusätzlich)
- **Design System** → Plattform-spezifische Patterns (iOS/Android)

### Phase 4: ENTWICKLUNG
- **Mobile Developer** → Cross-Platform App
- **iOS Native** → Apple-spezifische Features (falls nötig)
- **Android Native** → Google-spezifische Features (falls nötig)
- **Auth Agent** → Biometric Auth, Deep Linking
- **Backend Developer** → API, Push-Server
- **Queue/Background Jobs** → Push Notifications

### Phase 5: QUALITÄT
- **Mobile Testing** → Geräte-Tests, Emulator, Gesten
- **Performance Testing** → App-Größe, Startzeit, Akku
- **Security Engineer** → Certificate Pinning, Secure Storage
- **Accessibility Agent** → VoiceOver/TalkBack

### Phase 6: DEPLOYMENT
- **DevOps/CI-CD** → App Store Builds, TestFlight, Play Console
- **App Store Optimization** → Store-Listing, Screenshots, Video

---

## Projekttyp: TOOL (Internes Tool, Automation, Integration)

### Phase 1: DISCOVERY
- **Research Agent** → Bestehende Tools, APIs, Datenquellen
- **User Research** → Interne User Interviews, Workflow-Analyse
- **Product Manager** → Requirements, Akzeptanzkriterien

### Phase 2: PLANUNG
- **Technology Scout** → Framework, Hosting, Kosten
- **Software Architect** → Architektur, Integrationen
- **Database Architect** → Datenmodell, Migrationen
- **API Designer** → API für Integrationen

### Phase 4: ENTWICKLUNG
- **Backend Developer** → Core-Logik, APIs
- **Frontend Developer** → Admin UI, Dashboard
- **Automation/Workflow** → Business-Prozesse, Trigger, Cron
- **Integration Agent** → CRM, ERP, E-Mail, externe APIs
- **Webhook/Event** → Event-Driven, Webhooks
- **Auth Agent** → Berechtigungen, SSO

### Phase 5: QUALITÄT
- **QA Engineer** → Integration Tests
- **API Testing** → Endpoint-Tests
- **Security Engineer** → Zugriffskontrolle, Datensicherheit

### Phase 6: DEPLOYMENT
- **DevOps/CI-CD** → Deployment, Monitoring
- **Docker/Container** → Containerisierung

---

## Eskalationsregeln

### ALLES selbst entscheiden (Coding Agent + Sub-Agenten):
- Code-Formatierung und Stil
- Test-Erstellung und Ausführung
- Dependency-Wahl und Updates
- Datei-Organisation und Refactoring
- SEO Meta Tags und Schema
- Accessibility-Fixes
- Architektur-Entscheidungen
- Tech-Stack-Wahl
- API-Design
- Datenbankschema
- Performance-Optimierung
- Design-Richtung und Branding (passend zur Branche wählen)
- Feature-Scope (schlank starten)
- Hosting (immer dieser Server für Preview)
- Domain (immer {name}.markusstoeger.com für Preview)
- Datenschutz/Rechtliche Texte (Standard DSGVO-Templates verwenden)

### NUR an Max 2.0 eskalieren:
- Echte Käufe oder Zahlungen (> 0 EUR)
- Echter E-Mail-Versand an externe Personen (Vorbereitung ist OK)
- Löschung von Produktionsdaten
