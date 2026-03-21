# JAG Lifestyle Replica (Static)

This is a static recreation of the current `https://jaglifestyle.com/` homepage layout and style.

## Included
- Hero section with brand typography and CTA buttons
- About split section with image + mission statement
- Meet the Team grid with current team cards
- Featured Listings card grid
- Work With Us split section
- Contact form section with branded styling
- Footer with contact + policy links

## Notes for Production Migration
- Form submit handling is not wired to a backend yet.
- Listing and team data are static in HTML; move them to CMS or API data in the final build.
- Navigation dropdown behavior from the current platform is simplified.

## Preview
From repo root:

```bash
python3 -m http.server 8080
```

Then open:
`http://localhost:8080/recreations/jaglifestyle-rebuild/`
