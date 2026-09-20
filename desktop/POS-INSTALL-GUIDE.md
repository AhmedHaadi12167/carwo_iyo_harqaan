# Installing Tailor System on a POS machine (fully offline)

## On YOUR computer — build the installer (one time)

1. Make sure `backend\.env` has the correct settings (the POS will use a copy of this file).
2. Double-click `desktop\build.bat`.
3. When it finishes, take `desktop\dist\Tailor System Setup 1.0.0.exe` to the POS on a USB stick,
   together with the PostgreSQL installer and the `database\` folder.

## On the POS machine (one time)

1. **Install PostgreSQL** (postgresql.org installer). Choose a password and REMEMBER it.
   PostgreSQL installs as a Windows service — it starts automatically on every boot.
2. **Create the database** — open "SQL Shell (psql)" and run:
   ```
   CREATE DATABASE tailors_db;
   ```
   Then from Command Prompt (adjust the path to where you copied the database folder):
   ```
   psql -U postgres -d tailors_db -f database\schema.sql
   psql -U postgres -d tailors_db -f database\add-tailor-role.sql
   psql -U postgres -d tailors_db -f database\add-staff-phone.sql
   psql -U postgres -d tailors_db -f database\add-finance.sql
   psql -U postgres -d tailors_db -f database\add-recurring.sql
   psql -U postgres -d tailors_db -f database\add-fabric-image.sql
   psql -U postgres -d tailors_db -f database\add-sync.sql
   psql -U postgres -d tailors_db -f database\add-payment-methods.sql
   psql -U postgres -d tailors_db -f database\add-master-tailor-cashier.sql
   psql -U postgres -d tailors_db -f database\add-order-completed-at.sql
   psql -U postgres -d tailors_db -f database\add-vat.sql
   psql -U postgres -d tailors_db -f database\add-order-vat-and-soft-delete.sql
   psql -U postgres -d tailors_db -f database\add-password-reset.sql
   psql -U postgres -d tailors_db -f database\add-branches.sql
   psql -U postgres -d tailors_db -f database\add-staff-unique-contacts.sql
   psql -U postgres -d tailors_db -f database\add-products.sql
   ```
   (If you already ran `add-fabric-name-unique.sql` on this database, also run
   `database\drop-fabric-name-unique.sql` — fabric names no longer need to be unique.)
3. **Install the app** — run `Tailor System Setup 1.0.0.exe`.
4. **Set the database password** — open
   `C:\Program Files\Tailor System\resources\backend\.env` in Notepad and make sure
   `DATABASE_URL` contains the PostgreSQL password you chose in step 1
   (remember: `@` inside the password must be written `%40`).
5. **Seed the first accounts** — Command Prompt:
   ```
   cd "C:\Program Files\Tailor System\resources\backend"
   "C:\Program Files\Tailor System\Tailor System.exe" ...
   ```
   Easier: temporarily install Node.js OR create the admin user by running the seed
   from your own PC pointed at the POS (or copy a database backup — see below).

   **Simplest method:** on your PC run `pg_dump -U postgres tailors_db > shop.sql`,
   copy `shop.sql` to the POS, and run `psql -U postgres -d tailors_db -f shop.sql`.
   This carries the users, fabrics and all data in one file — no seeding needed.

## Daily use

- Double-click the **Tailor System** icon → the window opens, system fully working, no internet.
- Phones of tailors connect to `http://<POS-IP>:3000` on the same WiFi **while the app is open**.
- Closing the window stops the servers (PostgreSQL keeps running as a service).

## Updating the app later

Build a new Setup .exe on your PC and run it on the POS — it upgrades in place.
Database and data are untouched. If an update needs a new database migration,
run that .sql file with psql like in step 2.

## Giving the admin remote access (optional)

The POS stays fully offline for daily use either way. If you also want the
admin to see and manage orders from a separate computer, over the internet,
see `cloud\DEPLOY.md` — it hosts a second copy of the system under
`example.com` and keeps it in sync with this POS in the background.
