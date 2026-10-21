# B71 × VLU — VVIP Seating Planner (shared)

The seating planner page plus a small backend:

- **Login** with a username and password. Only the 2 accounts you configure can get in.
- **Shared and saved on the server.** Whatever one person changes is stored and appears for the other person within a moment, with no refresh. It works like a shared sheet.
- **Live sync** (Server-Sent Events). The footer shows who else is online and who edited last.

```
browser ──HTTPS──▶ server.js ──▶ data/state.json   (one small file = the seat plan)
   ▲                   │
   └──── live push ────┘
```

| File | What it is |
|---|---|
| `server.js` | The whole backend (Node 18+, **no dependencies**) |
| `app/index.html` | The planner (only served after login) |
| `app/login.html` | Login page |
| `render.yaml` | One-click deploy blueprint for Render |

## 1. Run it locally (2 minutes)

```bash
export USER1_NAME=alice USER1_PASS='pick-a-password'
export USER2_NAME=bob   USER2_PASS='pick-another'
export SESSION_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
node server.js
# open http://localhost:3000, log in in two browser windows, and try it
```

## 2. Put it online (so both of you can use a link)

This needs a host that runs Node **and keeps a disk**, because the plan is saved in `data/state.json`. Static hosts (GitHub Pages, Netlify) can't do this.

### Option A — Render (easiest)
1. Go to <https://render.com> → **New → Blueprint** → connect this GitHub repo. It reads `render.yaml`.
2. Fill in `USER1_NAME`, `USER1_PASS`, `USER2_NAME`, `USER2_PASS` when prompted. The `SESSION_SECRET` is generated for you.
3. Deploy. You get a URL like `https://84x-seat-check.onrender.com`. Send it to the other person with their password.

The blueprint uses the paid *Starter* plan because a persistent disk is required. On the free plan the file is wiped on every restart.

### Option B — Any VPS / Railway / Fly.io
Run `node server.js` with the same environment variables. Mount a persistent volume and point `DATA_DIR` at it. Put it behind HTTPS and set `TRUST_PROXY=1`.

## Environment variables

| Variable | Meaning |
|---|---|
| `USER1_NAME` / `USER1_PASS` | First account |
| `USER2_NAME` / `USER2_PASS` | Second account |
| `SESSION_SECRET` | Long random string that signs login cookies. Changing it logs everyone out |
| `DATA_DIR` | Where `state.json` lives (default `./data`). Must be persistent |
| `TRUST_PROXY` | `1` when behind a proxy, so login rate-limiting sees real IPs |
| `PORT` | Default `3000` (hosts usually set this for you) |

To change a password, change the variable and redeploy. There is no sign-up page, so only the 2 accounts can ever log in.

## How edits are shared

The browser sends small actions (`assign`, `unassign`, `replace` for CSV import, `reset`) and the **server** applies them. If you each edit different seats at the same time, both edits survive. If you both edit the *same* seat, the last one wins. A guest can only sit in one seat, and the server enforces that.

## Security notes
- Passwords are compared in constant time. Login is limited to 10 failed tries per 15 minutes per IP.
- Cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` over HTTPS. State-changing calls require a JSON content type, which blocks cross-site form posts.
- The guest list is only sent after login.
- **Back up the plan:** use the **Xuất sơ đồ CSV** button before big changes. "Đặt lại" clears it for both of you.
