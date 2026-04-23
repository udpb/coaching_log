# underdogs. Coaching Log

Startup coach's 1:1 session tracker — built around the idea that coaches should spend their time on **coaching**, not on re-typing what was just discussed. Paste an STT transcript, let Claude extract the structured fields, review, save.

Live: [underdogs-coaching-log.vercel.app](https://underdogs-coaching-log.vercel.app)

---

## Stack

- **Frontend** — single-file vanilla HTML/CSS/JS (`public/index.html`)
- **API** — Vercel serverless function (`api/extract-session.js`) → Anthropic Claude Sonnet 4.5
- **DB + Auth** — Supabase (Postgres + Row Level Security + Auth)
- **Fonts** — Pretendard (KR body) + Poppins (brand italic logo)
- **Reports** — browser print → PDF / [docx](https://github.com/dolanmiu/docx) v8 (lazy-loaded)

No build step. No framework.

---

## Features

- 🎙️ **STT → structured log** — paste transcript, Claude writes a rich narrative summary AND fills 18 structured fields with per-field evidence quotes from the transcript
- 📊 **Team timeline dashboard** — session strip, metrics trend chart (SVG), commitment-follow-through bars, repeat-blocker warning, real-issue evolution
- 📄 **Reports** — individual or bundle, PDF or Word, with optional Evidence / STT appendices
- ✏️ **Edit saved sessions** — full form hydration + UPDATE (created_at preserved)
- 🔐 **Role-based access** — admin sees all coaches' sessions (read-only); coach sees only their own (full CRUD). Enforced at Postgres RLS layer, not just UI
- 🔑 **Password recovery** — standard email-link flow via Supabase Auth

---

## Repo layout

```
api/
  extract-session.js        Serverless function — Claude proxy, SSE streaming,
                            prompt caching, JSON repair on truncated output
public/
  index.html                The whole app (HTML + inline CSS + inline JS)
supabase/
  migrations/               SQL migrations (run in Supabase SQL Editor)
    20260413_create_coaching_logs.sql
    20260417_add_transcript_raw.sql
    20260421_add_narrative_and_evidence.sql
    20260421_phase15_scalar_fields.sql
    20260421_phase4a_roles_rls.sql
lib/, data/, server.js      Legacy local-dev server + CSV backup scripts.
                            Not used in the Vercel deployment.
vercel.json                 Static + /api routing
```

---

## Setup

### 1. Supabase

1. Create a Supabase project
2. In the SQL Editor, run each migration in `supabase/migrations/` in chronological order
3. **Authentication → URL Configuration**
   - Site URL: `https://<your-deployment>.vercel.app`
   - Redirect URLs: add `https://<your-deployment>.vercel.app/**`
4. **Authentication → SMTP** (for production) — plug in a real SMTP provider such as [Resend](https://resend.com) to lift the default rate limit

### 2. Anthropic API key

- Get a key at [console.anthropic.com](https://console.anthropic.com)
- In Vercel: Project → Settings → Environment Variables → add `ANTHROPIC_API_KEY` (Production)

### 3. Client-side Supabase credentials

Replace the two constants near the top of `public/index.html`:

```js
const SUPABASE_URL = 'https://<your-project>.supabase.co';
const SUPABASE_KEY = '<your-anon-key>';   // safe to commit — anon key is public by design
```

The anon key is public on purpose; RLS policies (installed by the migrations) enforce that coaches only see their own rows and admins see all.

### 4. First admin

Migration `20260421_phase4a_roles_rls.sql` hardcodes `udpb@udimpact.ai` as admin. Adjust the email in that migration (or run an `UPDATE public.profiles SET role='admin' WHERE email='…'` afterwards) before applying, or swap it for your own.

### 5. Deploy

```bash
vercel deploy --prod
```

---

## Architecture notes

### Narrative + evidence pattern

The prompt is a two-pass:

1. Write an 8–15 sentence rich narrative of the session (preserves nuance)
2. Fill each structured field as `{ value, evidence, confidence }` — `evidence` must be a direct quote from the transcript

Fields with `confidence < 0.7` get highlighted in the UI so the coach knows what to double-check. The evidence quote is surfaced via a 💬 tooltip next to each field's label.

### Streaming

The serverless function forwards Anthropic's SSE stream to the client. Client parses the partial JSON on the fly (regex fallback when the buffer is still mid-token) so fields populate progressively rather than all-at-once after 10s.

### Prompt caching

System prompt is marked `cache_control: ephemeral` — first call creates cache, subsequent calls in the 5-min window read it. Observed savings: input tokens 1928 → 0 on cache hit.

### Truncation recovery

Long transcripts can push output past `max_tokens`. The API-side parser detects unterminated strings / braces and auto-closes them before JSON.parse, so a truncated response still yields a usable (partial) result.

### Row-level security

- `coaching_logs` RLS: `coach_id = auth.uid() OR public.is_admin()` for SELECT; coach-own only for INSERT/UPDATE/DELETE.
- `is_admin()` is a `SECURITY DEFINER` function to avoid policy recursion when checking the `profiles` table.
- Admins are **read-only** by design — they can audit but can't edit another coach's record.

---

## Development

There is a `server.js` in the repo for local CSV-based dev, but the production deployment runs entirely off Vercel + Supabase. Recommend using `vercel dev` for local iteration so the `/api/*` functions work the same as in production.

```bash
npm install
vercel link           # first time only
vercel env pull       # pulls ANTHROPIC_API_KEY into .env.local
vercel dev
```

---

## License

Private / internal — underdogs.
