# components/

Shared React components for the server-rendered routes.

The shipped UI today is the single-file app at `public/app.html` — it has no
build step and no component tree. As screens are ported to Next.js routes, the
pieces they share land here:

    components/
      ui/          buttons, inputs, badges, tables — the design-system primitives
      finance/     MoneyCell, CoverageBar, StatusBadge, PipelineBar
      forms/       RequestForm, BankDetailsForm, ProofOfPaymentForm

Rules that keep the port honest:

- Money in props is always BigInt satang or its string form — never a float.
- Formatting goes through `lib/money.js`, never a local `toLocaleString`.
- Status values come from `lib/workflow.js`, never a string literal.
