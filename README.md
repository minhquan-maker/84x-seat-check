# B71 × VLU — VVIP Seating Planner (shared)

The seating planner page plus a small backend:

- **Login** with a username and password. Only the 2 accounts you configure can get in.
- **Shared and saved on the server.** Whatever one person changes is stored and appears for the other person within a moment, with no refresh. It works like a shared sheet.
- **Live sync** (Server-Sent Events). The footer shows who else is online and who edited last.

```
browser ──HTTPS──▶ server.js ──▶ Postgres (Neon free)   (one row = the seat plan)
   ▲                   │
   └──── live push ────┘
```

| File | What it is |
|---|---|
| `server.js` | The whole backend (Node 18+, one dependency: `pg`) |
| `app/index.html` | The planner (only served after login) |
| `app/login.html` | Login page |
| `render.yaml` | One-click deploy blueprint for Render |

## 1. Run it locally (2 minutes)

```bash
npm install
export USER1_NAME=alice USER1_PASS='pick-a-password'
export USER2_NAME=bob   USER2_PASS='pick-another'
export SESSION_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
node server.js
# open http://localhost:3000, log in in two browser windows, and try it
```
Without `DATABASE_URL` the plan is saved to `data/state.json`. That is fine locally, but not on a free host.

## 2. Put it online for free (Neon database + Render free web service)

### Step 1: create the database (Neon)
1. Sign up at <https://neon.tech> and create a project (any name, pick a region near you).
2. On the project dashboard click **Connect** and copy the **connection string**. It looks like `postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require`. Keep it secret.
3. You don't need to create any tables. The server creates its own on first start.

### Step 2: deploy (Render)
1. Go to <https://render.com> → **Blueprints → New Blueprint Instance** → pick this repo, branch `main`.
2. Fill in `DATABASE_URL` (the Neon string), `USER1_NAME`, `USER1_PASS`, `USER2_NAME`, `USER2_PASS`. The session secret is generated for you.
3. Deploy. You get a URL like `https://84x-seat-check.onrender.com`.

**Free-tier behavior:** Render's free web service sleeps after about 15 minutes with no traffic, so the first visit afterwards can take about 30–60 seconds. Nothing is lost, because the plan is in Neon. Open the link a minute before you need it.

### Any other host
Run `node server.js` with the same variables, behind HTTPS, with `TRUST_PROXY=1`.

## Environment variables

| Variable | Meaning |
|---|---|
| `USER1_NAME` / `USER1_PASS` | First account |
| `USER2_NAME` / `USER2_PASS` | Second account |
| `SESSION_SECRET` | Long random string that signs login cookies. Changing it logs everyone out |
| `DATABASE_URL` | Postgres connection string. If unset, the plan is stored in `DATA_DIR/state.json` instead |
| `DATA_DIR` | Only for file storage (default `./data`) |
| `TRUST_PROXY` | `1` when behind a proxy, so login rate-limiting sees real IPs |
| `PORT` | Default `3000` (hosts usually set this for you) |

To change a password, change the variable and redeploy. There is no sign-up page, so only the 2 accounts can ever log in.

## How edits are shared

Writes are queued and saved before anyone is told about them. If the database is down, the edit is rejected instead of looking saved.

The browser sends small actions (`assign`, `unassign`, `replace` for CSV import, `reset`) and the **server** applies them. If you each edit different seats at the same time, both edits survive. If you both edit the *same* seat, the last one wins. A guest can only sit in one seat, and the server enforces that.

## Security notes
- Passwords are compared in constant time. Login is limited to 10 failed tries per 15 minutes per IP.
- Cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` over HTTPS. State-changing calls require a JSON content type, which blocks cross-site form posts.
- The guest list is only sent after login.
- **Back up the plan:** use the **Xuất sơ đồ CSV** button before big changes. "Đặt lại" clears it for both of you.
