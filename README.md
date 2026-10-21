# B71 × VLU — VVIP Seating Planner (shared)

The seating planner page plus a small backend, hosted on **Vercel** with the data in **Supabase**:

- **Login** with a username and password. Only the 2 accounts you configure can get in.
- **Shared and saved.** Whatever one person changes is stored in the database and shows up for the other person within about 3 seconds, with no refresh. It works like a shared sheet.
- The footer shows who else is online and who edited last.

```
browser ──HTTPS──▶ Vercel functions (api/*.js) ──▶ Supabase Postgres
   ▲  asks "anything new?" every ~2.5 s                 (one row = the seat plan)
```

| File | What it is |
|---|---|
| `app/index.html` | The planner (only served after login) |
| `app/login.html` | Login page |
| `api/*.js` | The backend: `page` (serves pages), `login`, `logout`, `state` (polled), `seats` (all edits) |
| `lib/*.js` | Shared code: auth cookie, database, helpers |
| `vercel.json` | Region (Tokyo, next to the database) and routing |
| `dev.js` | Run the same backend on your own computer |

## Deploy (Vercel + Supabase)

### 1. Database (Supabase)
1. Create a project at <https://supabase.com>. Set a **database password with only letters and numbers**.
2. Click **Connect → Direct connection string tab**, choose **Session pooler**, and copy the URI. It looks like `postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-0-xx.pooler.supabase.com:5432/postgres`.
3. Replace `[YOUR-PASSWORD]` with your password (no brackets). That is your `DATABASE_URL`.
4. Nothing else to set up. The tables are created automatically on first use.

### 2. Hosting (Vercel)
1. Import this GitHub repo in Vercel (Framework Preset: **Other**, no build command).
2. Open **Settings → Environment Variables** and add, for **Production**:

| Variable | Value |
|---|---|
| `DATABASE_URL` | the Supabase string from step 1 |
| `SESSION_SECRET` | a long random string, e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `USER1_NAME` / `USER1_PASS` | first account (lowercase username) |
| `USER2_NAME` / `USER2_PASS` | second account |

3. **Redeploy** (Deployments → ⋯ → Redeploy). Environment variables only apply to new deployments.
4. Open your `.vercel.app` link, log in, and send the link plus the second password to the other person.

To change a password, change the variable and redeploy. There is no sign-up page, so only the 2 accounts can ever log in. Changing `SESSION_SECRET` logs everyone out.

Supabase pauses free projects after about a week with no activity. Opening the app regularly keeps it awake, and you can un-pause it from the Supabase dashboard.

## Run locally
```bash
npm install
export DATABASE_URL='postgresql://...'   # any Postgres, e.g. your Supabase string
export SESSION_SECRET=anything USER1_NAME=alice USER1_PASS=pw1 USER2_NAME=bob USER2_PASS=pw2
node dev.js     # http://localhost:3000
```

## How edits are shared
The browser sends one small action (`assign`, `unassign`, `replace` for CSV import, `reset`) and the server applies it inside a database transaction with a row lock. If you each edit different seats at the same time, both edits survive. If you both edit the *same* seat, the last one wins. A guest can only sit in one seat, and the server enforces that. If the database can't be reached, the edit is rejected instead of looking saved.

## Security notes
- Passwords are compared in constant time. Login is limited to 10 failed tries per 15 minutes per IP (counted in the database).
- Cookie is `HttpOnly`, `SameSite=Lax`, `Secure` over HTTPS. State-changing calls require a JSON content type, which blocks cross-site form posts.
- The guest list is only sent after login.
- **Back up the plan:** use the **Xuất sơ đồ CSV** button before big changes. "Đặt lại" clears it for both of you.
