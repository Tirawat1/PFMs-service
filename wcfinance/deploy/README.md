# deploy/ — static hosting

The zero-infrastructure path. `index.html` is the whole app in one file: no
build step, no server-side code, no database, no network calls at runtime.

Drop this folder on any static host — GitHub Pages, Netlify, Cloudflare Pages,
an S3 bucket, a university web share, or a USB stick. `404.html` is the same
file so deep links resolve on hosts that support a fallback page.

## What you get

Everything the full deployment does, except sharing. Each browser keeps its own
copy of the data in local storage, so two people never see the same numbers.

Use this for demos, training, and review. Use the Docker deployment
(`docs/deployment.md`) for anything real.

## Updating

`index.html` is a build artifact — rebuilt whole from the design source, never
hand-edited. Replace both files together and keep them identical.

## Resetting

In the app: **Settings → Reset demo data**. Or clear the site's local storage in
the browser's developer tools.
