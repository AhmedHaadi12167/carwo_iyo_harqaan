# Hosting the cloud admin site (example.com)

This sets up the second half of the system: a cloud server the admin(s) log
into from any browser, kept in sync with the POS. The POS keeps working
exactly as it does today — fully offline, nothing about it changes except
that it now also talks to this server in the background when it has internet.

Do this once. After that, updates are a two-minute git push (see the bottom).

---

## 1. Create the server (DigitalOcean)

1. Sign up at digitalocean.com, add a payment method.
2. Create a Droplet:
   - Image: **Ubuntu 22.04 LTS**
   - Plan: Basic, Regular, **$6/mo** (1GB RAM) is enough to start; go to $12/mo if it ever feels slow
   - Region: pick one close to Somalia (e.g. Frankfurt or a nearby region DigitalOcean offers)
   - Authentication: SSH key (recommended) or password
3. Once created, note its **public IP address** (e.g. `164.90.x.x`).

## 2. Point the domain at it

At wherever `example.com` is registered (its DNS settings), add:

| Type | Name | Value |
|------|------|-------|
| A | `admin` | `164.90.x.x` (your droplet IP) |
| A | `api` | `164.90.x.x` (same IP) |

This gives you `admin.example.com` (the site admins log into) and
`api.example.com` (what the backend/POS talk to). DNS changes can take
up to a few hours to spread.

## 3. Set up the server

SSH into the droplet (`ssh root@164.90.x.x`) and run:

```bash
# System updates + tools
apt update && apt upgrade -y
apt install -y curl git nginx postgresql postgresql-contrib

# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# PM2 — keeps the backend running, restarts it if it crashes or the server reboots
npm install -g pm2
```

## 4. Create the cloud database

```bash
sudo -u postgres psql -c "CREATE DATABASE tailors_db;"
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'choose-a-strong-password';"
```

Copy your `database/` folder to the server (e.g. `scp -r database root@164.90.x.x:/root/`),
then run every migration in order — same files you already used for the POS,
plus the new sync one:

```bash
cd /root/database
psql -U postgres -d tailors_db -f schema.sql
psql -U postgres -d tailors_db -f add-tailor-role.sql
psql -U postgres -d tailors_db -f add-staff-phone.sql
psql -U postgres -d tailors_db -f add-finance.sql
psql -U postgres -d tailors_db -f add-recurring.sql
psql -U postgres -d tailors_db -f add-fabric-image.sql
psql -U postgres -d tailors_db -f add-sync.sql
psql -U postgres -d tailors_db -f add-payment-methods.sql
psql -U postgres -d tailors_db -f add-master-tailor-cashier.sql
psql -U postgres -d tailors_db -f add-order-completed-at.sql
psql -U postgres -d tailors_db -f add-vat.sql
psql -U postgres -d tailors_db -f add-order-vat-and-soft-delete.sql
psql -U postgres -d tailors_db -f add-password-reset.sql
psql -U postgres -d tailors_db -f add-branches.sql
psql -U postgres -d tailors_db -f add-staff-unique-contacts.sql
psql -U postgres -d tailors_db -f add-products.sql

Order matters: add-vat and add-sync must both run BEFORE
add-order-vat-and-soft-delete, and add-branches runs last.
`database/migrate-all.sql` does the whole lot in one transaction if you
prefer a single command.
```
(If you already ran `add-fabric-name-unique.sql` on this database, also run
`drop-fabric-name-unique.sql` — fabric names no longer need to be unique.)

**Also run `add-sync.sql` against the POS's local database** (same command,
pointed at `tailors_db` on the POS machine) — both sides need it.

Bring over your existing data once, so the cloud starts with what you
already have (run this on your own PC, pointed at the POS):

```bash
pg_dump -U postgres tailors_db > shop.sql
scp shop.sql root@164.90.x.x:/root/
# then on the server:
psql -U postgres -d tailors_db -f /root/shop.sql
```

## 5. Deploy the backend

```bash
cd /root
git clone <your repo, or scp the backend/ and frontend/ folders over>
cd backend
npm install
```

Create `/root/backend/.env`:

```
PORT=5000
DATABASE_URL=postgresql://postgres:choose-a-strong-password@localhost:5432/tailors_db
JWT_SECRET=<a long random string, different from the POS's>
JWT_EXPIRES=12h
SYNC_ORIGIN=cloud
SYNC_SECRET=<a long random string — MUST match the POS's SYNC_SECRET exactly>
```

Start it with PM2 so it survives reboots:

```bash
pm2 start src/server.js --name tailor-api
pm2 save
pm2 startup   # follow the one printed command to enable on-boot start
```

## 6. Deploy the admin frontend

```bash
cd /root/frontend
npm install
```

Create `/root/frontend/.env.local`:

```
NEXT_PUBLIC_API_URL=https://api.example.com
```

```bash
npm run build
pm2 start npm --name tailor-admin -- start
pm2 save
```

## 7. Nginx + HTTPS (so the domain actually works with `https://`)

```bash
apt install -y certbot python3-certbot-nginx
```

Create `/etc/nginx/sites-available/tailor-system`:

```nginx
server {
  server_name api.example.com;
  location / { proxy_pass http://localhost:5000; proxy_set_header Host $host; }
}
server {
  server_name admin.example.com;
  location / { proxy_pass http://localhost:3000; proxy_set_header Host $host; }
}
```

```bash
ln -s /etc/nginx/sites-available/tailor-system /etc/nginx/sites-enabled/
nginx -t && systemctl restart nginx
certbot --nginx -d api.example.com -d admin.example.com
```

Certbot gets free SSL certificates and auto-renews them. After this,
`https://admin.example.com` is the site your admins log into.

## 8. Point the POS at the cloud

On the POS machine, edit `backend\.env` (the one already running the shop):

```
SYNC_ORIGIN=pos
CLOUD_SYNC_URL=https://api.example.com
SYNC_SECRET=<the exact same string you put in the cloud's .env>
```

Restart the POS app. Within ~20 seconds you should see the sync badge in
the top bar go green ("Synced just now"). From then on:

- New orders, payments, and status updates the POS makes get pushed to the cloud automatically.
- Cancellations and edits an admin makes on `admin.example.com` get pulled down to the POS automatically.
- If the shop has no internet, the POS keeps working exactly as before — it just catches up once reconnected.

## 9. Create admin logins on the cloud

Cloud accounts are separate from POS accounts (see `apps note` below) — log
into the cloud database directly to create the first admin, or reuse your
existing seed script pointed at `DATABASE_URL` for the cloud DB.

**Note on accounts:** salesmen and tailors only ever need to log into the
POS, so their accounts only need to exist there. Admins who want cloud
access need an account created on the cloud database too — same username/
password if you want it to feel like "one login," but they're technically
two separate rows since it's two separate databases.

---

## Updating the system later

```bash
ssh root@164.90.x.x
cd /root/backend && git pull && pm2 restart tailor-api
cd /root/frontend && git pull && npm run build && pm2 restart tailor-admin
```

If a change includes a new `.sql` migration file, run it once against the
cloud database with `psql`, same as you already do on the POS.

## Cost summary

- Droplet: ~$6-12/month
- Domain: whatever you already pay for `example.com` — no extra cost
- SSL certificate: free (Certbot/Let's Encrypt)
