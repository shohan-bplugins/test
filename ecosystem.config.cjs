/*
 * pm2 config for a self-hosted deploy. Run from the project root:
 *
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *
 * The one thing this file exists to solve: NOTHING in the production path reads
 * `.env` on its own. `@react-router/serve` does not load it (only the React
 * Router *dev* CLI does), and pm2 does not either — a pm2 process inherits
 * whatever was exported in the shell that started it, which is why a deploy that
 * ran `prisma db push` successfully can still come up with no DATABASE_URL.
 *
 * That failure is near-silent. The Prisma session store reports *any* two failed
 * `session.count()` calls as "Prisma session table does not exist", so a missing
 * connection string, wrong credentials and a blocked IP all surface as a
 * phantom missing table. See DEPLOY-VPS.md → Troubleshooting.
 *
 * `node --env-file` is what loads it here, using Node's own parser rather than a
 * dependency. It needs Node >= 20.6, which both halves of the `engines` range in
 * package.json already require. Note that it cannot be passed through
 * NODE_OPTIONS — node rejects `--env-file=` there — so it has to be node_args on
 * a direct script invocation, which is why this runs react-router-serve's bin
 * directly instead of going through `npm start`.
 *
 * If `.env` is missing, node exits immediately rather than starting. That is the
 * intended behaviour: booting without SHOPIFY_API_SECRET produces an app that
 * looks healthy and fails every HMAC check.
 */
module.exports = {
  apps: [
    {
      name: "3d-viewer",

      // react-router-serve's bin, invoked directly so node_args apply to it.
      script: "node_modules/@react-router/serve/bin.js",
      args: "./build/server/index.js",
      node_args: "--env-file=.env",

      // One process. Sessions live in MongoDB so cluster mode would work, but
      // each worker opens its own Prisma connection pool for no gain at this
      // size.
      exec_mode: "fork",
      instances: 1,

      env: {
        NODE_ENV: "production",
        PORT: 3000,
        // Bind to loopback only — nginx is what faces the internet. Without
        // this, react-router-serve picks the first non-internal IPv4 address and
        // the app is reachable on :3000 straight past the firewall rules.
        HOST: "127.0.0.1",
      },

      autorestart: true,
      max_restarts: 10,
      // A crash loop from a bad env var restarts instantly and floods the log;
      // this keeps the real error readable.
      restart_delay: 3000,
      max_memory_restart: "1G",
    },
  ],
};
