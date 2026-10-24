# DISPUTE365

Credit report scanner + FCRA/FDCPA dispute letter engine by HSW365 Media LLC.

Live: https://hsw365.github.io/dispute365/

- `index.html` — app (GitHub Pages). Reports are parsed in-browser with pdf.js.
- Backend: Supabase (shared HSW365 project) — tables `d365_members`, `d365_rounds`, `d365_settings`; RPCs `d365_status`, `d365_pay_claim`; edge functions `d365-letters` (paywalled letter engine), `d365-billing` (Stripe, activates when STRIPE_SECRET_KEY is set).
- Payments: CashApp/Zelle via `hsw_payments` (approve in HSW365 Payments console) or Stripe card.
- Plans: Basic $9.99/mo, Pro $14.99/mo. Owner emails have permanent free Pro.
