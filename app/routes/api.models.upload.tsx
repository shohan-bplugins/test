import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  modelQuotaError,
  uploadModelToLibrary,
} from "~/lib/model-upload.server";

/**
 * An "uploading" job this old is taken to be dead — the process handling it
 * restarted, or it threw past the status write. Shopify's side of a 20 MB
 * upload finishes in well under a minute, so five is generous.
 */
const STALE_JOB_MS = 5 * 60 * 1000;
const JOB_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const KEY_PATTERN = /^[0-9a-f-]{36}$/i;

export type UploadJobStatus = {
  status: "uploading" | "done" | "error";
  error: string | null;
  modelId: string | null;
  /** An "uploading" job that has been at it too long to still be running. */
  stale: boolean;
};

export type UploadResponse =
  | {
      ok: true;
      id: string;
      name: string;
      // Absent when the answer is for a key that finished in an earlier
      // request, whose sizes weren't kept.
      originalSize?: number;
      size?: number;
    }
  | { ok: false; error: string; pending?: boolean };

/**
 * The UploadJob table, or undefined when the running server's Prisma client
 * predates it — a dev server left running across `prisma generate` keeps the
 * old client in memory until it restarts. Uploads still work without it; they
 * just lose the reload-safe "never upload one key twice" guarantee until then.
 */
function jobTable() {
  const table = (prisma as Partial<typeof prisma>).uploadJob;
  if (!table) {
    console.warn(
      "[upload] Prisma client has no UploadJob model — restart the server after `prisma generate`. Uploading without job tracking.",
    );
  }
  return table;
}

function isStale(job: { status: string; updatedAt: Date }) {
  return (
    job.status === "uploading" &&
    Date.now() - job.updatedAt.getTime() > STALE_JOB_MS
  );
}

/**
 * Where each of the given upload keys stands, for a browser picking a batch
 * back up after a reload. Keys this shop never sent are simply absent.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";
  const keys = (new URL(request.url).searchParams.get("keys") ?? "")
    .split(",")
    .filter((k) => KEY_PATTERN.test(k))
    .slice(0, 200);

  const table = jobTable();
  const jobs =
    keys.length && table
      ? await table.findMany({ where: { shop, id: { in: keys } } })
      : [];
  const result: Record<string, UploadJobStatus> = {};
  for (const job of jobs) {
    result[job.id] = {
      status: job.status as UploadJobStatus["status"],
      error: job.error,
      modelId: job.modelId,
      stale: isStale(job),
    };
  }
  return Response.json({ jobs: result });
};

/**
 * One model file into the library, answered as plain JSON.
 *
 * The library page's bulk upload posts here once per file rather than through
 * its own route action, which would revalidate the whole library loader after
 * every file. One file per request also keeps each body under the size limit
 * and lets a single bad file fail alone.
 *
 * Idempotent on `key`: a browser that reloaded mid-upload can't know whether
 * its last request landed, so it may send the same file again. A finished key
 * answers with its model instead of uploading a second copy, and a key that is
 * still in flight answers `pending` so the browser waits for it.
 */
export const action = async (args: ActionFunctionArgs) => {
  // authenticate.admin answers a bad session with a Response of its own; that
  // has to go back as-is so App Bridge can renew the token.
  try {
    return await handleUpload(args);
  } catch (err) {
    if (err instanceof Response) throw err;
    console.error("[upload] failed", err);
    return Response.json({
      ok: false,
      error: `Server error: ${err instanceof Error ? err.message : String(err)}`,
    } satisfies UploadResponse);
  }
};

async function handleUpload({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";
  const formData = await request.formData();
  const key = String(formData.get("key") ?? "");
  const file = formData.get("file") as File | null;
  const name = (formData.get("name") as string | null)?.trim() || file?.name;
  const reply = (body: UploadResponse) => Response.json(body);
  const optimize = formData.get("optimize") !== "0";

  if (!KEY_PATTERN.test(key)) return reply({ ok: false, error: "Missing upload key" });

  const table = jobTable();
  if (!table) {
    const quotaError = await modelQuotaError(admin, shop);
    if (quotaError) return reply({ ok: false, error: quotaError });
    return reply(await uploadModelToLibrary(admin, shop, file, name, optimize));
  }

  void table
    .deleteMany({ where: { shop, createdAt: { lt: new Date(Date.now() - JOB_TTL_MS) } } })
    .catch(() => {});

  const existing = await table.findUnique({ where: { id: key } });
  if (existing && existing.shop !== shop) {
    return reply({ ok: false, error: "Invalid upload key" });
  }
  if (existing?.status === "done" && existing.modelId) {
    return reply({ ok: true, id: existing.modelId, name: existing.name });
  }
  if (existing && !isStale(existing) && existing.status === "uploading") {
    return reply({ ok: false, pending: true, error: "Still uploading" });
  }
  // A failed or dead attempt is retried under the same key.
  if (existing) await table.delete({ where: { id: key } }).catch(() => {});

  // The insert is the lock: _id is unique, so of two requests racing on one
  // key exactly one gets to upload and the other is told to wait.
  try {
    await table.create({
      data: { id: key, shop, name: name ?? "Model", size: file?.size ?? 0, status: "uploading" },
    });
  } catch {
    return reply({ ok: false, pending: true, error: "Still uploading" });
  }

  const finish = async (body: UploadResponse) => {
    await table
      .update({
        where: { id: key },
        data: body.ok
          ? { status: "done", modelId: body.id, error: null }
          : { status: "error", error: body.error },
      })
      .catch(() => {});
    return reply(body);
  };

  try {
    const quotaError = await modelQuotaError(admin, shop);
    if (quotaError) return finish({ ok: false, error: quotaError });
    const result = await uploadModelToLibrary(admin, shop, file, name, optimize);
    return finish(result);
  } catch (err) {
    console.error("[upload] failed", err);
    return finish({
      ok: false,
      error: `Server error: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
