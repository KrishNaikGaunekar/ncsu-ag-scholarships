# Shared scholarship editing (Supabase)

The scholarships page (`scholarships.html`) works with no backend: everyone sees the
built-in starter list from `src/scholarships/seed-data.js`, and "Editor sign-in" only
offers a local draft mode (changes stay in that browser; export JSON to share).

To let people with access add and update scholarships for everyone:

1. Create a free project at <https://supabase.com> (any region).
2. **SQL editor → New query**, paste `supabase/schema.sql`, run it.
3. Add editors (same SQL editor):
   ```sql
   insert into public.scholarship_editors (email) values ('someone@ncsu.edu');
   ```
4. **Authentication → URL Configuration**: set *Site URL* to the deployed site
   (`https://krishnaikgaunekar.github.io/ncsu-ag-scholarships/`) and add
   `http://localhost:5179/**` to *Redirect URLs* for local testing.
5. **Project Settings → API**: copy the *Project URL* and the *anon public* key into
   a `.env.local` file in the repo root (see `.env.example`):
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
   The anon key is meant to be public; write access is enforced by the row-level
   security policies in `schema.sql`. Never put the `service_role` key here.
6. `npm run build` and deploy. Sign in via the "Editor sign-in" link at the bottom of
   the page, then **Editor ▾ → Publish starter list** once to copy the seed data in.

To remove an editor: `delete from public.scholarship_editors where email = '...';`

Students' checklists, profile, saved list, tracker and notes are never sent to
Supabase — they stay in each student's browser.
