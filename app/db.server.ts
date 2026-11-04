import { PrismaClient } from "@prisma/client";

import { clearAppUserCache } from "~/lib/app-user-cache.server";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
  // eslint-disable-next-line no-var
  var prismaGlobalPatch: string | undefined;
}

// Bump this whenever createPrismaClient below changes. The dev server caches the
// client on `global` to survive hot reloads, which also means a reload picks up
// the *old* client — the new module body runs, sees a populated global, and
// hands back an instance built by the previous version of this file. Tagging the
// cached client makes that stale case detectable instead of silently outliving
// the edit that was supposed to fix it.
const CLIENT_PATCH = "session-upsert-omit-id+upload-job+app-user-cache";

const APP_USER_WRITES = new Set([
  "create",
  "createMany",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
]);

// MongoDB treats `_id` as immutable, so Prisma leaves `id` out of
// `SessionUpdateInput` entirely — while `@shopify/shopify-app-session-storage-prisma`
// hands the whole row (id included) to both halves of its upsert. On Postgres or
// SQLite that is harmless; here it fails validation with "Unknown argument `id`"
// on every token exchange, i.e. on every request that authenticates, so the app
// cannot store a session at all.
//
// Stripping the key in a query extension keeps the fix in one place, leaves the
// session store unforked, and preserves `Session.id` as the real `_id` (see the
// schema notes in prisma/schema.prisma). The `where` clause still carries the
// id, so the document being updated is the same one either way.
function createPrismaClient(): PrismaClient {
  return new PrismaClient().$extends({
    query: {
      session: {
        upsert({ args, query }) {
          const { id: _immutableId, ...update } = args.update as Record<
            string,
            unknown
          >;
          return query({ ...args, update });
        },
      },
      // Keeps the in-memory AppUser cache honest (app-user-cache.server.ts).
      // Cleared before the write, so no read can start from the old row while
      // it is in flight, and again after, so a read that began during the
      // write cannot store what it saw.
      appUser: {
        async $allOperations({ operation, args, query }) {
          if (!APP_USER_WRITES.has(operation)) return query(args);
          clearAppUserCache();
          try {
            return await query(args);
          } finally {
            clearAppUserCache();
          }
        },
      },
    },
  }) as unknown as PrismaClient;
}

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal || global.prismaGlobalPatch !== CLIENT_PATCH) {
    global.prismaGlobal = createPrismaClient();
    global.prismaGlobalPatch = CLIENT_PATCH;
  }
}

const prisma = global.prismaGlobal ?? createPrismaClient();

export default prisma;
