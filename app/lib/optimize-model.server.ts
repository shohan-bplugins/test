import { NodeIO, type Document } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, draco, prune, resample, weld } from "@gltf-transform/functions";
import draco3d from "draco3dgltf";
import sharp from "sharp";

/*
 * Automatic model optimisation, run on every upload before the file goes to
 * Shopify Files.
 *
 * Only what every viewer the model reaches can decode:
 *
 *   - Draco geometry (KHR_draco_mesh_compression). view3d decodes it with the
 *     decoder it fetches from gstatic only when a model needs it, and Google's
 *     Scene Viewer — which Android AR hands the raw .glb to — supports it.
 *   - Textures stay JPEG or PNG, just smaller: capped at MAX_TEXTURE_SIZE, and
 *     a PNG with no transparency in it becomes a JPEG. No WebP, KTX2 or
 *     Meshopt — view3d isn't configured for Meshopt, its KTX2 transcoder comes
 *     from an old CDN path, and Scene Viewer would need to handle them too.
 *
 * Draco quantises vertex data, which is lossy in principle and invisible in
 * practice at glTF-Transform's defaults (14-bit positions). The result is used
 * only when it is meaningfully smaller; otherwise the merchant's file goes up
 * untouched.
 *
 * iOS Quick Look plays a separate .usdz, so none of this reaches it.
 */

/** Textures larger than this on either side are scaled down to fit. */
const MAX_TEXTURE_SIZE = 2048;
const JPEG_QUALITY = 85;
/** Keep the original unless the optimised file is at least this much smaller. */
const MIN_SAVING = 0.05;

export type OptimizeResult = {
  file: File;
  originalSize: number;
  /** False when the original went up as it was — see `note`. */
  optimized: boolean;
  note?: string;
};

let ioPromise: Promise<NodeIO> | null = null;

function getIO(): Promise<NodeIO> {
  ioPromise ??= (async () =>
    new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({
        "draco3d.decoder": await draco3d.createDecoderModule(),
        "draco3d.encoder": await draco3d.createEncoderModule(),
      }))();
  return ioPromise;
}

async function readDocument(io: NodeIO, file: File, bytes: Uint8Array) {
  if (file.name.toLowerCase().endsWith(".gltf")) {
    // Only a self-contained .gltf (buffers and images as data: URIs) can be
    // read: an upload is the one file, so anything it points at beside itself
    // isn't here — and isn't in Shopify Files either.
    const json = JSON.parse(new TextDecoder().decode(bytes));
    return io.readJSON({ json, resources: {} });
  }
  return io.readBinary(bytes);
}

async function optimizeTextures(doc: Document) {
  for (const texture of doc.getRoot().listTextures()) {
    const image = texture.getImage();
    const mime = texture.getMimeType();
    if (!image || (mime !== "image/png" && mime !== "image/jpeg")) continue;

    try {
      const input = sharp(image);
      const meta = await input.metadata();
      const tooBig =
        (meta.width ?? 0) > MAX_TEXTURE_SIZE ||
        (meta.height ?? 0) > MAX_TEXTURE_SIZE;
      const toJpeg =
        mime === "image/png" && (await sharp(image).stats()).isOpaque;

      let pipeline = sharp(image);
      if (tooBig) {
        pipeline = pipeline.resize(MAX_TEXTURE_SIZE, MAX_TEXTURE_SIZE, {
          fit: "inside",
          withoutEnlargement: true,
        });
      }
      const outMime = toJpeg ? "image/jpeg" : mime;
      const out =
        outMime === "image/jpeg"
          ? await pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer()
          : await pipeline.png({ compressionLevel: 9, effort: 8 }).toBuffer();

      // A resize is kept even if the bytes didn't shrink — it still saves GPU
      // memory on the shopper's phone. Otherwise only a smaller file wins.
      if (!tooBig && out.byteLength >= image.byteLength) continue;
      texture.setImage(new Uint8Array(out)).setMimeType(outMime);
      const uri = texture.getURI();
      if (uri && outMime === "image/jpeg") {
        texture.setURI(uri.replace(/\.png$/i, ".jpg"));
      }
    } catch (err) {
      // One texture sharp can't read is no reason to give up on the rest.
      console.warn("[optimize] skipped a texture:", err);
    }
  }
}

/**
 * Optimise an uploaded .glb / .gltf. Never throws: any failure hands back the
 * original file, with the reason in `note`, so an upload never fails because
 * optimisation did.
 */
export async function optimizeModelFile(file: File): Promise<OptimizeResult> {
  const originalSize = file.size;
  const keep = (note: string): OptimizeResult => ({
    file,
    originalSize,
    optimized: false,
    note,
  });

  try {
    const io = await getIO();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await readDocument(io, file, bytes);

    await doc.transform(dedup(), prune(), weld(), resample());
    await optimizeTextures(doc);
    // Primitives Draco can't carry (morph targets, points/lines) are left
    // uncompressed by the extension rather than failing the write.
    await doc.transform(draco({ method: "edgebreaker" }));

    const out = await io.writeBinary(doc);
    if (out.byteLength > originalSize * (1 - MIN_SAVING)) {
      return keep("Already optimized");
    }

    // Always a .glb now, even from a .gltf — the output is binary.
    const name = file.name.replace(/\.gltf$/i, ".glb");
    return {
      file: new File([out], name, { type: "model/gltf-binary" }),
      originalSize,
      optimized: true,
    };
  } catch (err) {
    console.warn("[optimize] kept the original:", err);
    return keep("Couldn't be optimized; uploaded as is");
  }
}
