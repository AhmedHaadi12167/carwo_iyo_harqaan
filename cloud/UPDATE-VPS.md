# Pushing the password-reset update to the Hostinger VPS

Applies to `root@srv1860447`. Domain is unchanged (`api.example.com` /
`admin.example.com`) — nothing in nginx, certbot or DNS needs touching.

## What changed in this update

| Change | What it needs on the server |
|---|---|
| `nodemailer` added to `backend/package.json` | **`npm install` in backend** — a plain `pm2 restart` will crash the API |
| `users.email` column + `password_resets` table | Run `add-password-reset.sql` on the VPS database |
| SMTP settings (`SMTP_*`, `MAIL_FROM`) | Added by hand to `/root/backend/.env` — `.env` is gitignored, git will **not** bring it |
| Forgot-password UI + user email field | Covered by the frontend rebuild |

> Heads-up on the two commands you already ran: `npm run build` +
> `pm2 restart tailor-admin` rebuilt the **old** frontend code, because
> there was no `git pull` before it. Redo it as part of step 4 below.

---

## 0. Push your local work first (on your PC)

```bash
cd "C:\Users\HP\Claude\Projects\tailor system"
git status
git add -A
git commit -m "Password reset via email OTP"
git push origin main
```

`shop.sql` is ~19 MB and currently modified. If you don't need it in the
repo, untrack it before committing to keep the push fast:

```bash
git rm --cached shop.sql
echo "shop.sql" >> .gitignore
```

---

## 1. SSH in and confirm the layout

```bash
ssh root@srv1860447
ls /root
cd /root/backend && git remote -v && git log --oneline -3
```

If `git remote -v` prints nothing, the code was uploaded manually — see
**Appendix A** instead of steps 2 and 4.

---

## 2. Database migration — do this BEFORE restarting the backend

If the `database/` folder is on the server:

```bash
cd /root/database && git pull 2>/dev/null
sudo -u postgres psql -d tailors_db -f /root/database/add-password-reset.sql
```

If it isn't, paste the SQL directly — it's identical and safe to re-run:

```bash
sudo -u postgres psql -d tailors_db <<'SQL'
BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
CREATE TABLE IF NOT EXISTS password_resets (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  otp_hash    TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  verified    BOOLEAN NOT NULL DEFAULT FALSE,
  used        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets (user_id);
COMMIT;
SQL
```

Verify both landed:

```bash
sudo -u postgres psql -d tailors_db -c "\d users" | grep email
sudo -u postgres psql -d tailors_db -c "\d password_resets"
```

You should see an `email | text` row and the full `password_resets` table.

---

## 3. Backend — pull, install, configure SMTP, restart

```bash
cd /root/backend
git pull
npm install          # REQUIRED — pulls in nodemailer
nano .env
```

Append this block to `/root/backend/.env` (keep the existing
`DATABASE_URL`, `JWT_SECRET`, `SYNC_*` lines exactly as they are):

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=ahmedhaadi645@gmail.com
SMTP_PASS=your-16-char-gmail-app-password
MAIL_FROM=Tailor System <ahmedhaadi645@gmail.com>
```

Then:

```bash
pm2 restart tailor-api
pm2 logs tailor-api --lines 30
```

Look for `Tailor System API running on http://localhost:5000` and no
`Cannot find module 'nodemailer'`. Ctrl-C to exit the log view.

Quick check from the server:

```bash
curl -s localhost:5000/api/health
curl -s -X POST localhost:5000/api/auth/forgot-password \
  -H 'Content-Type: application/json' -d '{"username":"admin"}'
```

The second should return a JSON response rather than a 404.

---

## 4. Frontend — pull, install, rebuild, restart

```bash
cd /root/frontend
git pull
npm install
cat .env.local          # must contain NEXT_PUBLIC_API_URL=https://api.example.com
npm run build
pm2 restart tailor-admin
pm2 save
```

If `.env.local` is missing or empty, recreate it before building —
otherwise the browser will try to reach the API on port 5000 directly and
every request will fail:

```bash
echo "NEXT_PUBLIC_API_URL=https://api.example.com" > /root/frontend/.env.local
npm run build && pm2 restart tailor-admin
```

---

## 5. Test end to end

1. Open `https://admin.example.com` → **Forgot password**.
2. Set an email on a staff account first (Users → edit → Email), otherwise
   the reset has nowhere to send the code.
3. Request a code, check the inbox, verify, set a new password, log in.

If no email arrives, watch the API log while you submit:

```bash
pm2 logs tailor-api --lines 50
```

Gmail SMTP errors show up there in full (bad app password, 2FA not enabled,
port blocked by the host).

---

## 6. The POS machine needs the same migration

The shop PC has its own `tailors_db` database. If salesmen/tailors
should be able to reset passwords locally, run the same SQL there and add
the same `SMTP_*` block to the POS's `backend\.env`, then restart the app.

---

## Appendix A — if the VPS has no git repo

Replace steps 3 and 4's `git pull` with an upload from your PC:

```bash
# on your PC, from the project folder
scp -r backend/src backend/package.json root@srv1860447:/root/backend/
scp -r frontend/app frontend/lib frontend/components frontend/package.json root@srv1860447:/root/frontend/
scp database/add-password-reset.sql root@srv1860447:/root/
```

Then continue on the server with `npm install`, the migration, `npm run
build`, and the pm2 restarts exactly as written above.

Cloning the repo once is worth it — future updates become `git pull` +
rebuild:

```bash
cd /root && mv backend backend.bak && mv frontend frontend.bak
git clone https://github.com/AhmedHaadi12167/tailor-system.git app
cp backend.bak/.env app/backend/.env
cp frontend.bak/.env.local app/frontend/.env.local
```
(then repoint the pm2 processes at `/root/app/backend` and `/root/app/frontend`)

---

## Two things to fix separately

**1. `backend/.env` on your PC has a broken `DATABASE_URL`:**

```
DATABASE_URL=postgresql://postgres:Haadi34@@localhost:5432/tailors_db
```

The `@` inside the password must be percent-encoded or the connection
string parses wrong. It should read:

```
DATABASE_URL=postgresql://postgres:Haadi34%40@localhost:5432/tailors_db
```

**2. Rotate the Gmail app password.** The one currently in your local
`.env` has been shared in plain text. Revoke it at
myaccount.google.com/apppasswords, generate a fresh one, and put the new
value in both `.env` files.

---

## One-shot version (once you've read the above)

```bash
ssh root@srv1860447

sudo -u postgres psql -d tailors_db -f /root/database/add-password-reset.sql

cd /root/backend && git pull && npm install && pm2 restart tailor-api

cd /root/frontend && git pull && npm install && npm run build && pm2 restart tailor-admin

pm2 save && pm2 status
```
