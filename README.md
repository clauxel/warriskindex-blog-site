# War Risk Index

War Risk Index is a public, source-led website for the keyword `war risk index`.
It publishes a transparent open-news signal that turns recent GDELT coverage
patterns into a 0-100 risk pressure score. The site is informational only: it is
not a government assessment, investment recommendation, insurance quote, or
operational security forecast.

Production domain: https://warriskindex.blog/

## Local Commands

```bash
npm run generate:visual
npm run build
npm run check
npm run serve
```

## Sources

- GDELT Project for live open-news coverage and DOC 2.0 timelines.
- ACLED Conflict Index methodology for benchmark concepts such as deadliness,
  danger to civilians, diffusion, and armed-group fragmentation.
- UCDP API documentation for structured conflict dataset context.
- CFR Global Conflict Tracker methodology for conflict selection and status
  language.

## Deployment Notes

The Cloudflare Worker serves static assets, live risk endpoints, analytics
events, and D1-backed risk snapshots. D1 migrations are managed from
`migrations/`, and the production binding is configured in `wrangler.toml`.
