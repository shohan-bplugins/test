/**
 * Which video codec is inside an MP4/MOV, read from the file itself.
 *
 * Why this exists: a merchant uploads a clip, it plays perfectly in the admin
 * preview, and it is blank for a large share of their customers. The cause is
 * almost always H.265/HEVC — what an iPhone records by default, and what
 * Shopify hands back untranscoded when a clip is added under Content > Files
 * rather than as a Video. Safari decodes HEVC; Chrome and Firefox do not. So
 * the person who uploaded it is the least likely person to notice.
 *
 * Asking the merchant's own browser (`canPlayType`) can't answer this: on
 * Safari the answer is "plays fine" precisely in the case we need to warn
 * about. So read the container instead, which is the same answer everywhere.
 *
 * Best-effort by design — a probe that can't run (CORS, offline, a provider
 * URL, an exotic container) returns null and the caller stays quiet rather
 * than crying wolf.
 */

// Codecs the browser landscape actually splits on. Everything else we either
// know is fine or don't claim to judge.
const CODECS = {
  avc1: { name: "H.264", universal: true },
  avc3: { name: "H.264", universal: true },
  // Both HEVC sample entries: hvc1 (parameter sets in the sample description)
  // and hev1 (in-band). Safari/Edge only.
  hvc1: { name: "H.265 / HEVC", universal: false },
  hev1: { name: "H.265 / HEVC", universal: false },
  // Broad support since ~2023 but not in older Safari.
  av01: { name: "AV1", universal: false },
  vp09: { name: "VP9", universal: true },
};

const FOURCCS = Object.keys(CODECS);

/** Scan a byte range for a sample-entry fourcc. */
function findCodec(bytes) {
  // The fourcc sits inside the stsd box; rather than walking the whole box
  // tree (which a partial download may have cut in half), look for the
  // 4-byte tags directly. They are ASCII and don't collide with anything we
  // care about in practice.
  const text = new TextDecoder("latin1").decode(bytes);
  let best = null;
  let bestAt = Infinity;
  for (const cc of FOURCCS) {
    const at = text.indexOf(cc);
    // A real sample entry is preceded by its 4-byte size field, so it never
    // sits at the very start of the file.
    if (at > 4 && at < bestAt) {
      best = cc;
      bestAt = at;
    }
  }
  return best;
}

async function range(url, header, signal) {
  const res = await fetch(url, { headers: { Range: header }, signal });
  if (!res.ok) return null;
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * @returns {Promise<{fourcc: string, name: string, universal: boolean}|null>}
 */
export async function detectVideoCodec(url, { signal } = {}) {
  if (!url || !/^https?:/i.test(url)) return null;
  // Provider embeds are transcoded by the provider; nothing to check.
  if (/youtube\.com|youtu\.be|vimeo\.com/i.test(url)) return null;

  try {
    // The moov box (which holds the codec) is at the front of a
    // web-optimised file and at the END of everything else — iPhone
    // recordings included. Try the front first, then the tail.
    const head = await range(url, "bytes=0-524287", signal);
    let fourcc = head && findCodec(head);
    if (!fourcc) {
      const tail = await range(url, "bytes=-524288", signal);
      fourcc = tail && findCodec(tail);
    }
    if (!fourcc) return null;
    return { fourcc, ...CODECS[fourcc] };
  } catch (e) {
    // Aborted, blocked by CORS, or not a container we can read.
    return null;
  }
}
