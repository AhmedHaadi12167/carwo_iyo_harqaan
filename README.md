# Tailor System — Management System

Full tailor-shop management system: fabric inventory with barcode scanning, 5-step order creation, payment tracking, role-based access (Admin / Salesman), advanced dashboard with monthly paid-vs-unpaid charts, and 80mm thermal receipt printing.

**Stack:** Next.js + React + Tailwind (frontend) · Node.js + Express (backend) · PostgreSQL (database)

---

## 1. Requirements

Install these on your computer first:

- **Node.js 18+** — https://nodejs.org
- **PostgreSQL 14+** — https://www.postgresql.org/download/windows/

## 2. Create the database

Open **SQL Shell (psql)** or pgAdmin and run:

```sql
CREATE DATABASE tailors_db;
```

Then load the schema and all migrations (from a terminal in this project folder):

```
psql -U postgres -d tailors_db -f database/schema.sql
psql -U postgres -d tailors_db -f database/migrate-all.sql
psql -U postgres -d tailors_db -f database/create-admin.sql
```

`migrate-all.sql` runs every migration in the correct dependency order as one
transaction — the order is not alphabetical and cannot be guessed, so use this
rather than running the files by hand. All three are safe to re-run.

## 3. Start the backend

```
cd backend
copy .env.example .env
```

Edit `backend/.env` — put your real PostgreSQL password in `DATABASE_URL` and change `JWT_SECRET` to any long random text. Then:

```
npm install
npm run seed     (creates login accounts + sample fabrics)
npm start        (API runs on http://localhost:5000)
```

## 4. Start the frontend

In a second terminal:

```
cd frontend
copy .env.local.example .env.local
npm install
npm run dev      (open http://localhost:3000)
```

## 5. Log in

Created by `database/create-admin.sql`:

| Role | Username | Password | Sees |
|---|---|---|---|
| Superadmin | `owner` | `Haadi$2026#Admin` | Every branch + the branch comparison report |
| Admin | `admin` | `Haadi$2026#Admin` | One branch only (Main Branch) |

Created by `npm run seed` (sample accounts, password shown by the script):

| Role | Username | Device |
|---|---|---|
| Salesman | `salesman` | Computer |
| Tailor | `tailor` | Phone |

**Change these passwords** from your profile after first login.

## Branches

Every piece of trading activity belongs to a branch: orders, fabrics, staff,
expenses, capital and assets.

- **Superadmin** — creates branches, sees all of them, and gets the
  side-by-side branch comparison in Reports. Belongs to no single branch and
  cannot take orders (there would be no correct answer to "which branch is
  this sale?").
- **Admin** — runs exactly one branch. Their orders, fabric stock, staff,
  revenue and P&L are their branch's only. Requesting another branch's record
  by id returns "not found", so ids reveal nothing.
- **Customers are shared** across branches, so the same person visiting two
  branches is one record — but their orders each carry a branch, so each
  branch's balances and statements stay separate.
- **Fabric codes are unique per branch.** Two branches can both stock SS0098
  as genuinely different rolls with their own quantity, cost and price.
- **Order numbers are per branch**, prefixed with the branch code:
  `HDN-1`, `HDN-2`… Cloud-taken orders get a leading `C` (`CHDN-1`) so the POS
  and the cloud can both trade while offline from each other without
  colliding. The branch code is therefore permanent once orders exist.

Add a branch from **Branches** (superadmin only), then add its admin from
**Staff**. Closing a branch locks its staff out but keeps all its history;
deleting is only possible for a branch that has never been used.

### Upgrading an existing database (tailor role)

If your database was created before the tailor feature, run once:

```
psql -U postgres -d tailors_db -f database/add-tailor-role.sql
```

### Tailor workspace (phone)

Tailors log in from their phone browser (same address, e.g. `http://YOUR-PC-IP:3000`) and get a
mobile app experience with bottom navigation: **Available** orders to accept, **My Jobs** with
one-tap status updates (In Progress → Completed), and job details showing measurements, garments
and fabrics — never prices or customer phone numbers. An order can only be claimed by ONE tailor
(first to accept wins), and the admin sees each tailor's performance on the Staff page.

---

## How the system works

**Fabric / shipments** — Register each fabric with its code (e.g. SS0098), component, weight, color, cost and selling price per meter. When a new shipment of an existing fabric arrives, click **+ Add Stock** and the meters are added on top of the current quantity. Every movement (in/out) is recorded in the movement history. Stock is deducted automatically when orders are created, and returned automatically if an order is cancelled.

**Barcode scanning** — Open **Scan Fabric** and shoot the label with any USB barcode scanner (scanners type the code + Enter automatically, so no configuration is needed). The system shows availability, stock in meters and price, then lets you create an order with that fabric or jump to managing it. The same works by typing the code manually.

**Orders (5 parts)** — 1) Customer contact info (existing phone numbers are matched automatically), 2) Body measurements matching your paper form (Trouser/Shalwar + Coat/Kameez, fractions like 41½ allowed), 3) Order details: garment (suit / shirt / khamiis / safari suit / jacket / trouser), fabric and meters, plus the appointment (delivery) date, 4) Payment: price charged, advance amount, balance calculated live, 5) Review everything, submit, then print the 80mm thermal receipt.

**Statuses** — Order: Pending → In Progress → Completed → Delivered (or Cancelled, admin only). Payment: Unpaid / Partial / Fully Paid, updated automatically from received payments.

**Roles & privacy** — Customers may be high-profile people, so their phone numbers are **admin-only**: salesmen can enter a phone when creating an order but can never see it again anywhere (lists, order details, receipts, search). The Customers, Reports and Staff pages are admin-only. When an order is both **Delivered and Fully Paid** it disappears from the salesman's screens. Salesmen can update order status (never cancel) and receive payments; only admins can cancel orders, edit orders (price, delivery date, notes), and edit customer or staff info. Salesmen never see fabric cost prices, revenue or collected totals.

**Dashboard** — Period selector (Today / This Week / This Month / All Time) drives all numbers. Admin sees total orders, revenue, collected and uncollected; salesman sees only order counts and uncollected balances. Clickable status cards (pending, in progress, completed, delivered, cancelled) jump to the filtered order list. 12-month paid-vs-unpaid chart (money for admin, order counts for salesman), status donut, color-coded recent orders, upcoming appointments and low-stock alerts.

**Reports (admin)** — Filter by fabric, customer, status and date range to see matching orders, revenue, collected/uncollected totals and a revenue-by-fabric breakdown.

**Customer statement (admin)** — From Customers or Reports, open a customer's A4 statement for any date range: all orders with paid/partial/unpaid status, balances and totals. Click Print / Save as PDF.

## Folder structure

```
database/schema.sql     PostgreSQL schema (tables, view, triggers)
backend/                Express API (src/routes, src/seed.js)
frontend/               Next.js app (app/, components/, lib/)
```
