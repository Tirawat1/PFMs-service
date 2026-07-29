# WC Finance — revised prototype v3

This package repairs the broken top-level HTML file and strengthens the existing browser-based reimbursement prototype without changing its overall visual design.

## Run it

The fallback icons are bundled locally, but the supplied runtime loads React from a public CDN, so use an internet-connected browser.

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080/`.

Opening `index.html` directly may work, but a local web server is more reliable.

## What changed

- Replaced the incomplete `Project Finance v2.dc.html` with a complete v3 entry point.
- Added v4 → v5 browser-data migration.
- Added explicit prototype-mode warnings.
- New requests now require a title, category, payment account, positive amount, and description.
- Request descriptions are saved.
- Disbursements use the selected account and cannot exceed its available balance.
- Required documents must all be attached before submission or verification.
- Local file selection is labelled accurately: the filename is recorded, but the file is not uploaded or retained.
- Google Drive links are validated and no fake Drive URLs are generated.
- Documents are locked after verification.
- Reviewers can return a request for correction with a required reason.
- Added duplicate checks for usernames, roles, categories, and category documents.
- New user passwords must contain at least eight characters.
- Roles cannot be removed while assigned to users.
- Master documents cannot be removed while used by a category.
- Resetting demo data is restricted to the administrator role.
- Expanded audit logging for document, category, user, role, correction, and disbursement actions.

## Important limitations

This is still a frontend prototype, not a production financial system:

- Data and sessions are stored in `localStorage` on one browser/device.
- Demo passwords exist in frontend source code.
- Permissions are enforced in the browser, not on a trusted server.
- Local files are not uploaded or retained.
- Google Drive upload/folder creation is not implemented.
- The audit trail can be altered by someone with browser developer access.
- React is loaded from a public CDN by the supplied prototype runtime. Vendor and pin approved dependencies before production deployment.
- The bundled fallback icons are intentionally lightweight; replace them with an approved design-system icon package in production.

Do not use real financial, personal, procurement, or confidential data until a secure backend, server-side authorization, managed authentication, immutable audit logging, and real file storage are implemented.

## Production migration

A starter Supabase schema is included under `supabase/schema.sql`. It is a foundation only and still requires:

1. Supabase Auth user provisioning.
2. Mapping authenticated users to profiles and roles.
3. Tested row-level security policies for each institution's access model.
4. Private Storage buckets and signed URLs for documents.
5. Server-side workflow functions for status transitions and disbursement transactions.
6. Secret management, backups, monitoring, and security review.
