# Deploying to your own VPS

A Shopify embedded app is two deploys, not one, and they go to different places:

| What | Where it goes | Command |
| --- | --- | --- |
| The web app (this Node server) | Your VPS | steps 1–9 below |
| App config + theme extension | Shopify | `shopify app deploy`, step 10 |

Do them in that order. `shopify app deploy` publishes the URLs merchants are
redirected to, so the server behind those URLs has to exist first.

Assumptions: Ubuntu 22.04/24.04 or Debian 12, root or sudo, and a domain whose
DNS **A record already points at the VPS**. Replace `app.example.com` with your
domain and `deploy` with whatever user you prefer throughout.

---

## 1. Prepare the server

```bash
ssh root@YOUR_SERVER_IP
apt update && apt upgrade -y
apt install -y git nginx curl
```

Node's version range is enforced by `engines` in `package.json`:
`>=20.19 <22 || >=22.12`. Note the gap — **Node 22.0 through 22.11 are excluded**,
so a generic "install Node 22" that lands on 22.9 will fail `npm ci`. Install
from NodeSource, which tracks the latest 22.x:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v    # must be >= 22.12 (or 20.19-21.x)
```

Create an unprivileged user to own and run the app:

```bash
adduser --system --group --home /srv/viewer-3d --shell /bin/bash deploy
```

## 2. Set up the database

This app uses **MongoDB via Prisma**, and the schema is written for MongoDB
specifically — `prisma/schema.prisma` has `provider = "mongodb"`. It is *not*
interchangeable with Postgres or SQLite.

You can point at MongoDB Atlas (simplest) or run MongoDB on the VPS. Either way
you need a connection string **with a database name in the path**:

```
mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net/viewer3d?retryWrites=true&w=majority
                                                  ^^^^^^^^ required
```

Prisma's MongoDB connector has no default database. Omitting that path segment
fails at *connect* time, not at generate time, so it surfaces as a 500 on the
first page that touches the database rather than a build error.

**If you use Atlas:** add the VPS's public IP to the project's Network Access
allowlist. A blocked IP surfaces as a connection timeout, which looks exactly
like a wrong password.

Use a different database name (or cluster) from your dev environment. The
session collection *is* the merchants' logged-in state — pointing a second
deploy at it logs everyone out.

## 3. Get the code onto the server

```bash
su - deploy
git clone https://github.com/ah-polash/Easy-3D-Viewer.git /srv/viewer-3d
cd /srv/viewer-3d
```

## 4. Write the environment file

```bash
cp .env.example .env
nano .env
```

Required:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | The connection string from step 2 |
| `SHOPIFY_API_KEY` | Partner Dashboard → your app → **Client ID** |
| `SHOPIFY_API_SECRET` | Partner Dashboard → **Client secret** |
| `SHOPIFY_APP_URL` | `https://app.example.com` — no trailing slash |
| `SCOPES` | `write_products,write_files,write_themes` |

Optional: `GA_MEASUREMENT_ID`, `CLARITY_PROJECT_ID` (both default to the IDs in
`app/lib/analytics.server.ts`; set either to `off` to disable), and
`SHOP_CUSTOM_DOMAIN`.

**Leave `SHOPIFY_BILLING_TEST` unset.** It creates app subscriptions as *test*
charges that never settle, so setting it in production gives every merchant the
paid plans for free. It is one of the things App Store review checks for.

Lock the file down — it holds your app secret and database credentials:

```bash
chmod 600 .env
```

> **A missing Shopify variable does not crash the app.**
> `app/shopify.server.ts` reads `process.env.SHOPIFY_API_SECRET || ""`, so a
> typo'd or absent value boots fine and then fails every HMAC check. Symptoms are
> "invalid session" loops and webhooks returning 401 — not a stack trace. Check
> this file first when auth misbehaves.

## 5. Install and build

```bash
cd /srv/viewer-3d
npm ci                 # full install — the build needs devDependencies
npm run build
```

## 6. Push the schema

```bash
npm run setup          # prisma generate && prisma db push
```

Two things about this step:

- **`prisma migrate deploy` will not work here.** Prisma Migrate does not support
  MongoDB, so there is no `prisma/migrations` directory. `db push` is what creates
  the unique and compound indexes the schema declares — skip it and the app still
  reads and writes, it just silently loses every uniqueness guarantee.
- **`prisma generate` must run on this machine.** Prisma resolves a
  platform-specific query engine binary at runtime, so a `node_modules` built on
  macOS and rsynced to Linux throws `Query engine library for current platform
  could not be located` on the first query. (`binaryTargets` in the schema
  already lists `debian-openssl-3.0.x` as a safety net — that covers Debian 12
  and Ubuntu 22.04+. Use `debian-openssl-1.1.x` for Debian 11 / Ubuntu 20.04, or
  `linux-musl-openssl-3.0.x` on Alpine.)

The Prisma **CLI** reads `.env` from the project root, which is why this works.
The **running server does not** — see the next step.

## 7. Run it as a service

`npm start` runs `react-router-serve`, which reads `PORT` and `HOST` and defaults
to port 3000. Bind it to localhost only; nginx is what faces the internet.

The critical detail: **`@react-router/serve` does not load `.env`.** Only the
React Router *dev* CLI does. So `npm start` on its own gets none of step 4's
variables. `EnvironmentFile=` below is what supplies them.

```bash
exit    # back to root
nano /etc/systemd/system/viewer-3d.service
```

```ini
[Unit]
Description=Easy 3D Viewer
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=deploy
Group=deploy
WorkingDirectory=/srv/viewer-3d

# The app reads no .env at runtime; this is the only thing that supplies it.
EnvironmentFile=/srv/viewer-3d/.env
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOST=127.0.0.1

ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

`EnvironmentFile` parses a simpler syntax than a shell: no `export`, no variable
interpolation, and an unquoted `#` mid-value starts a comment. Wrap the
connection string in double quotes and you are fine:

```
DATABASE_URL="mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/viewer3d?retryWrites=true&w=majority"
```

```bash
systemctl daemon-reload
systemctl enable --now viewer-3d
systemctl status viewer-3d
journalctl -u viewer-3d -f      # watch the logs
curl -I http://127.0.0.1:3000/  # should answer
```

### Using pm2 instead

pm2 does **not** read `.env` either — it inherits whatever was exported in the
shell that started it. `pm2 start npm -- start` therefore comes up with no
`DATABASE_URL` and no `SHOPIFY_API_SECRET`, which is the single most common way
this deploy fails (see Troubleshooting: the resulting error claims the session
table is missing).

`ecosystem.config.cjs` in the repo root handles it, loading `.env` through
`node --env-file`:

```bash
cd /srv/viewer-3d
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup            # print the command to run so pm2 survives reboot
pm2 logs 3d-viewer
```

Two flags in that file are load-bearing. `--env-file` cannot be passed through
`NODE_OPTIONS` (node rejects it there), which is why it invokes
react-router-serve's bin directly rather than `npm start`. And `HOST=127.0.0.1`
keeps the app on loopback — without it `react-router-serve` binds the first
non-internal IPv4 address and is reachable on `:3000` past your firewall rules.

After changing `.env`, a plain `pm2 restart` reuses the old environment. Use:

```bash
pm2 restart 3d-viewer --update-env
```

## 8. Reverse proxy with nginx

```bash
nano /etc/nginx/sites-available/viewer-3d
```

```nginx
server {
    listen 80;
    server_name app.example.com;

    # REQUIRED — do not leave at the 1m default.
    #
    # Merchants upload .glb models to this server: the route action buffers the
    # multipart body and only then relays it to Shopify's staged upload
    # (app/lib/files.server.ts). Models are routinely 5-50MB, so the default
    # rejects real uploads with a 413 before the app ever sees them.
    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # That same upload is one request that waits on a round trip to Shopify.
        # 60s (the default) can cut a large model off mid-relay.
        proxy_read_timeout    300s;
        proxy_send_timeout    300s;
        proxy_request_buffering off;
    }
}
```

Proxy the **whole** domain to the app. Do not carve out or rewrite paths — the
app owns `/auth/*` (OAuth), `/webhooks/*` (Shopify calls these directly),
`/proxy/*` (the storefront app proxy) and `/viewer/*` (the public embed), and
every one of them breaks silently if its path is altered.

```bash
ln -s /etc/nginx/sites-available/viewer-3d /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

## 9. HTTPS and firewall

Shopify **requires** HTTPS. An embedded app on plain HTTP will not load at all.

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d app.example.com
```

Certbot rewrites the server block for TLS and installs a renewal timer. Verify
`client_max_body_size` survived into the new `listen 443` block — re-add it if
not.

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
```

Do not open port 3000. Only nginx should reach the app.

## 10. Point Shopify at the new domain

Three places in `shopify.app.toml` name the app's host — they say
`3d-viewer-app.bplugins.com` today — and **all three** must change together:

```toml
application_url = "https://app.example.com"

[app_proxy]
url = "https://app.example.com/proxy"

[auth]
redirect_urls = [ "https://app.example.com/auth/callback" ]
```

Then, **from your local machine** (not the VPS — this needs the Shopify CLI
logged in to your Partner account):

```bash
shopify app deploy
```

This pushes the config above plus the theme app extension. The VPS never runs
the Shopify CLI.

> **`shopify app dev` will overwrite those URLs.**
> `[build] automatically_update_urls_on_dev = true` means every `shopify app dev`
> rewrites `application_url` and `[app_proxy].url` to that session's tunnel — in
> the file *and* in the Partner Dashboard. Run dev after a production deploy and
> the live app starts pointing at a dead tunnel.
>
> Two ways out, pick one:
> - Keep a separate dev config (`shopify app config link` → a second
>   `shopify.app.*.toml`) and switch with `npm run config:use`. This is what the
>   deleted `shopify.app.viewer-3d.toml` in this repo's history was for.
> - Set `automatically_update_urls_on_dev = false` and manage the URLs by hand.
>
> Either way, re-run `shopify app deploy` on the production config after any dev
> session, and confirm the App URL in the Partner Dashboard afterwards.

## 11. Verify

1. Install the app on a development store. OAuth should complete and land on
   `/app` without a redirect loop.
2. Upload a real model (~20MB) on **3D Model Library**. A 413 means step 8's
   `client_max_body_size` did not take effect; a timeout means the proxy
   timeouts did not.
3. Open **Setup** and create the metafield definitions.
4. Add the theme block to a product and load the storefront page.
5. `journalctl -u viewer-3d -n 100` — should be clean.

---

## Updating a deployed app

```bash
su - deploy
cd /srv/viewer-3d
git pull
npm ci
npm run build
npm run setup          # only when prisma/schema.prisma changed
exit
systemctl restart viewer-3d
```

There is a few seconds of downtime on restart. If that matters, run two units on
different ports behind an nginx `upstream` and restart them one at a time.

Re-run `shopify app deploy` from your local machine only when
`shopify.app.toml` or anything under `extensions/` changed.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `Query engine library for current platform could not be located` | `prisma generate` was not run on the server (step 6), or `binaryTargets` doesn't match this OS |
| 500 on `/app`, static routes fine | Database unreachable: bad `DATABASE_URL`, missing database name in the path, or the VPS IP is not in the Atlas allowlist |
| Invalid session loop; webhooks 401 | `SHOPIFY_API_SECRET` missing or wrong. It fails silently — `|| ""` in `app/shopify.server.ts` |
| `MissingSessionTableError: Prisma session table does not exist` | **Almost never a missing collection.** See below |
| App frame blank or refuses to load | Not on HTTPS, or `SHOPIFY_APP_URL` doesn't match `application_url` exactly |
| `Refused to display … because it set 'X-Frame-Options' to 'sameorigin'` | A security-headers block in nginx that this guide's step 8 does not add — see below |
| 413 on model upload | `client_max_body_size` (step 8) |
| Merchants redirected to a dead `trycloudflare.com` URL | `shopify app dev` overwrote the production URLs — see the warning in step 10 |
| App loads but the storefront block can't resolve a Model ID | `[app_proxy].url` still points at the old domain |
| Merchants not being charged | `SHOPIFY_BILLING_TEST` is set. Unset it and restart |

See also: `README.md` (**Deploying**, **Production environment**) and
`SUBMISSION-CHECKLIST.md`.

### `X-Frame-Options` from nginx blocks the embedded frame

Some hosting-panel vhost templates inject a security-headers block that step 8
does not:

```
x-frame-options: SAMEORIGIN
x-content-type-options: nosniff
x-xss-protection: 1; mode=block
x-permitted-cross-domain-policies: master-only
referrer-policy: same-origin
```

`SAMEORIGIN` forbids `admin.shopify.com` from framing the app. Opening the app
URL in a tab still works perfectly — nothing is being framed there — so this
looks like an app bug when it is purely an edge-config one.

`X-Frame-Options` is ignored on any response that also carries a
`frame-ancestors` CSP, which is why it breaks *some* apps and not others. This
app sets that CSP on every rendered document, so what actually mattered was the
one response with no CSP: `application_url` is the bare domain, and `/` redirects
to `/app` before rendering. `app/routes/_index/route.tsx` now builds that
redirect by hand so `addDocumentResponseHeaders` runs on it too. Browsers check
`X-Frame-Options` on redirects, not just on the final document.

Check the vhost as well, since it also stamps the header on assets and on the
public `/viewer/:id` embed:

```bash
grep -rn "X-Frame-Options" /etc/nginx/
nginx -t && systemctl reload nginx
curl -sI https://app.example.com/ | grep -i frame      # expect no output
```

Two things not to try. `proxy_hide_header X-Frame-Options` does nothing — it
strips headers coming *from* the upstream, and the Node app never sends one.
And do not add a `Content-Security-Policy` in nginx: multiple CSP headers are
intersected rather than overridden, so an nginx `frame-ancestors` would fight
the per-shop one the app sets per request. If a panel keeps regenerating the
vhost, `apt install nginx-extras` gives you `more_clear_headers
"X-Frame-Options";`.

### `MissingSessionTableError` is a misleading message

```
MissingSessionTableError: Prisma session table does not exist.
  cause: Error: The table `session` does not exist in the current database.
```

Read `pollForTable()` in
`node_modules/@shopify/shopify-app-session-storage-prisma/dist/cjs/prisma.js`:
it calls `prisma.session.count()`, retries twice five seconds apart, and if both
attempts throw for **any** reason it raises that fixed message. The real error is
swallowed into a `console.log` first:

```
Error obtaining session table: <the actual cause>
```

**That line is the diagnosis, and it is written at process startup**, not when
the request fails — the store's readiness check runs in its constructor. So it
sits far earlier in the log than the 500 that sent you looking:

```bash
pm2 logs 3d-viewer --lines 500 | grep -i "obtaining session table"
```

On MongoDB a genuinely absent collection does not throw at all — Mongo creates
collections lazily and counting a missing one returns 0 — so this error means the
app could not *talk to* the database. In order of likelihood:

1. **`DATABASE_URL` is not in the running process's environment.** Neither
   `@react-router/serve` nor pm2 reads `.env`, while the Prisma CLI does — which
   is exactly how `npm run setup` succeeds and the app still cannot connect.
   Confirm what the process actually has:

   ```bash
   pm2 env 0 | grep -E "DATABASE_URL|SHOPIFY_API"      # or: pm2 describe 3d-viewer
   ```

   Empty output is the bug. Fix it with `ecosystem.config.cjs` above.

2. **The database is unreachable.** With Atlas, the VPS's public IP is not in
   Network Access; self-hosted, `bindIp`/firewall. Test from the server with the
   same string the app uses:

   ```bash
   cd /srv/viewer-3d && npx prisma db execute --stdin <<< '{"ping":1}'
   ```

3. **Wrong credentials, or no database name in the URL path** (`.../viewer3d?...`
   — see step 2).

Once the connection is fixed, still run `npm run setup` — it is what creates the
unique and compound indexes the schema declares.
