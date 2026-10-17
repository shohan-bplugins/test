import prisma from "../db.server";
import { countDistinctModels, getAssignedModelGids, getPlanLimitForShop } from "./billing.server";
import { formatLimit } from "./billing-constants";
import { stagedUploadAndCreate } from "./files.server";
import { finalSizeError, validateModelFile } from "./files";
import { syncModelLibrary } from "./model-library.server";
import { optimizeModelFile } from "./optimize-model.server";

/**
 * Why this shop can't add another model, or null when it can.
 *
 * Counted fresh on every call rather than once per batch: a bulk upload posts
 * its files one at a time, and each one that lands moves the count, so a stale
 * figure would let the last few through over the limit.
 */
export async function modelQuotaError(
  admin: any,
  shop: string,
): Promise<string | null> {
  const [planInfo, libraryGids, assignedModels] = await Promise.all([
    getPlanLimitForShop(shop),
    prisma.model3D.findMany({ where: { shop }, select: { fileGid: true } }),
    getAssignedModelGids(admin, shop),
  ]);
  const totalInUse = countDistinctModels(
    libraryGids.map((m) => m.fileGid),
    assignedModels.gids,
  );
  if (totalInUse < planInfo.modelLimit) return null;
  return `You've reached your ${planInfo.planName} plan limit of ${formatLimit(planInfo.modelLimit)} 3D models. Upgrade your plan to add more.`;
}

export type ModelUploadResult =
  | {
      ok: true;
      id: string;
      name: string;
      /** What was uploaded, and what Shopify Files now holds. */
      originalSize: number;
      size: number;
    }
  | { ok: false; error: string };

/**
 * Upload one model file to Shopify Files and add it to the shop's library,
 * optimised first unless `optimize` is false (see optimize-model.server.ts).
 * The plan limit is the caller's to check — see modelQuotaError.
 */
export async function uploadModelToLibrary(
  admin: any,
  shop: string,
  file: File | null,
  name?: string | null,
  optimize = true,
): Promise<ModelUploadResult> {
  if (!file || file.size === 0) {
    return { ok: false, error: "Please choose a .glb or .gltf file" };
  }
  const fileError = validateModelFile(file, optimize);
  if (fileError) return { ok: false, error: fileError };

  const optimized = optimize
    ? (await optimizeModelFile(file)).file
    : file;
  // The size limit is on what gets stored, so it is judged after compression.
  const sizeError = finalSizeError(optimized.size, file.size);
  if (sizeError) return { ok: false, error: sizeError };

  const result = await stagedUploadAndCreate(
    admin,
    optimized,
    `Library model: ${optimized.name}`,
  );
  if (!result.ok) return { ok: false, error: result.error };

  const finalName = name?.trim() || file.name;
  const created = await prisma.model3D.create({
    data: {
      shop,
      name: finalName,
      fileGid: result.fileGid,
      fileUrl: result.fileUrl ?? "",
      fileSize: optimized.size,
    },
  });
  await syncModelLibrary(admin, shop);
  return {
    ok: true,
    id: created.id,
    name: finalName,
    originalSize: file.size,
    size: optimized.size,
  };
}
