# NC State Ag Scholarships

Scholarship and grant dashboard for NC State Agribusiness Management / CALS students.

**Live site:** https://krishnaikgaunekar.github.io/ncsu-ag-scholarships/

- **Active / Upcoming / Passed** tabs (plus All and ★ Saved), with deadline countdowns and urgency highlighting
- **Eligibility checklist** per scholarship; an optional **My profile** (GPA, year, CALS major, citizenship…) pre-ticks matching criteria
- Application tracker, private notes, saved list, search/filter/sort, and **.ics calendar export**
- **Editor mode** for people with access to add, update and delete scholarships

Student data (checklists, profile, notes) stays in the browser's localStorage.

## Data

The starter list is in `src/scholarships/seed-data.js`, transcribed from the scholarship research doc. Entries without confirmed dates show "Dates TBA" and are marked unverified.

## Shared editing

Off by default — editor mode then saves to the editor's own browser only (export JSON to share). To give a group of people one shared, editable list, set up Supabase as described in [`supabase/README.md`](supabase/README.md).

## Development

```
npm install
npm run dev
npm run deploy   # build + publish dist/ to the gh-pages branch
```
