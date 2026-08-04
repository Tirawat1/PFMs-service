# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two equally important, roughly co-equal audiences, both faculty staff/students using this as a work tool, not a public-facing product:

1. **Department requesters** — department representatives (e.g. "Dept. of Pharmacology," "Dept. of Pharmacognosy") who submit reimbursement requests and projected expenses, attach documents, and track their requests through to payment.
2. **Faculty finance & purchasing officers** — verify submitted documents, approve/reject projected expenses and advances, disburse funds, and manage accounts. Split into two distinct roles (Finance verifies + disburses; Purchasing verifies purchasing-related documents) depending on expense category.

A smaller admin/Project Finance audience configures categories, roles, accounts, and the document menu, and has full visibility across everything.

## Product Purpose

WC Finance (PFMS) is role-based reimbursement tracking for a university faculty. It moves an expense from "planned" through "paid" through a fixed pipeline (Notified → Docs Submitted → Verified → Funds Disbursed → Purchase Complete → Closed), gated at each step by permission, with a discrepancy workflow so an officer can kick bad documents back to the requester without breaking the chain. Success = every baht committed or spent is traceable to a request, a document, an account movement, and an audit entry — no informal side-channels for who's owed what.

## Positioning

Purpose-built for how this faculty's money actually moves — not a generic expense tracker. It natively models things generic tools don't: an advance-then-settle flow (money pre-transferred from a government account to a working account before the actual purchase, unspent balance auto-returned), multiple real bank accounts plus sub-account "purses" for earmarked money (sponsorships, registration fees), category-specific document checklists and approver routing (Finance vs. Purchasing), and vendor-registration paperwork triggered only when a supplier isn't already known.

## Operating Context

- Requests move through the fixed pipeline above; each forward step requires a specific permission and is blocked by incomplete documents or an open discrepancy.
- Money either starts as a **direct claim** (category allows it) or must go through a **projected expense → officer-approved advance → linked reimbursement** chain first.
- Documents are Google Drive links only — no files stored on the app's own server. Uploads go into a real Drive folder created per request when Drive credentials are configured; falls back to pasting a link when they aren't.
- Two seeded core accounts (Faculty / Project) plus admin-created ad-hoc accounts; any account can have "purses" (sub-accounts) for earmarking money.
- EN/ไทย bilingual throughout — Thai names/notes are first-class data, not an afterthought translation layer.
- Used continuously as the faculty's ongoing financial system — not a single-event tool. Originated for the IPSF World Congress 2026 event but intended to keep running afterward.

## Capabilities and Constraints

- Next.js 14 (App Router) SPA-style frontend (`components/App.jsx` is the entire UI, no client router) · Prisma/PostgreSQL · JWT cookie auth. `prisma db push` only — no migrations, so schema evolution has previously caused a real bug (missing seed rows for features added after initial deploy; being fixed defensively with `upsert`).
- No file storage on the server — Google Drive is the only document store, and it's optional (link-paste fallback when unconfigured).
- Email notifications are optional (SMTP), per-user opt-in; in-app notifications always work regardless.
- Every mutation goes through one endpoint (`/api/rpc`, one action per case), permission-checked and audit-logged; every screen re-fetches one shared, permission-filtered snapshot (`/api/data`) after any change — no per-feature REST surface, no partial client state to keep in sync.
- Undecided: whether the eventual redesign should introduce a formal design-token system (CSS custom properties already exist in `app/globals.css` — `--accent`, `--green`, etc. — but are informally named, not a documented scale).

## Brand Commitments

Must use the faculty's official colors and logo — **คณะเภสัชศาสตร์ จุฬาลงกรณ์มหาวิทยาลัย (Faculty of Pharmaceutical Sciences, Chulalongkorn University)**. No logo file exists in this repository. User confirms the university's signature color is pink ("ชมพูจุฬาฯ" — Chulalongkorn's well-known institutional color) but has no exact hex value or logo file on hand. The current pink/magenta gradient (`--accent: #f0378a`, `--accent2: #b71e60` in `app/globals.css`) is directionally correct but not confirmed as the exact official shade — treat as a reasonable anchor to refine from, not a locked, pixel-exact brand color. A logo file and precise hex values remain to be sourced from the university's official brand guideline if/when the user obtains them.

## Evidence on Hand

- Real Thai legal/billing detail exists in seed data (e.g. official faculty name, address, tax ID used for receipts) — treat as real, not fabricate similar-looking placeholders elsewhere.
- No customer testimonials, case studies, or marketing copy — this is an internal operating tool, not a marketed product; nothing in that category should be invented.
- No existing logo/brand asset files in the repo (see Brand Commitments).

## Product Principles

1. **Every movement is traceable.** Money, documents, and status changes always have a who/when/why — the audit trail and permission gates are core to the product, not bolted on.
2. **Optional infrastructure degrades gracefully.** Google Drive and SMTP are both optional; the app must keep working (with a clear fallback) when either is unconfigured.
3. **Two operating roles, one shared truth.** Requesters and officers work from the same live snapshot of the same requests — the UI must serve both without favoring one workflow's speed over the other's accuracy.
4. **Thai-first bilingual, not translated-after-the-fact.** Thai names, notes, and legal detail are primary data alongside English, always.
5. **Official identity is non-negotiable.** Faculty branding constraints override generic design-system defaults once real brand assets are supplied.

## Accessibility & Inclusion

No formal accessibility standard has been established for this project yet. Given real financial/legal use by university staff (not all necessarily young or tech-fluent), reasonable default: keep text legible, targets touch-friendly, and don't rely on color alone to convey status (the pipeline/status badges currently use color + text label together, which should be preserved).
