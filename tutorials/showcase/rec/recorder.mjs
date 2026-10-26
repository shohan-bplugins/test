// CDP screencast -> timestamped JPEGs -> constant-frame-rate MP4.
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);

export async function startRecording(page, dir, { w = 1920, h = 1080, quality = 94 } = {}) {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  const writes = [];
  cdp.on("Page.screencastFrame", (f) => {
    const name = `f${String(frames.length).padStart(6, "0")}.jpg`;
    frames.push({ name, t: f.metadata.timestamp });
    writes.push(fs.writeFile(path.join(dir, name), Buffer.from(f.data, "base64")));
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality, maxWidth: w, maxHeight: h, everyNthFrame: 1 });
  return {
    async stop(out, fps = 30) {
      const tEnd = Date.now() / 1000;
      await cdp.send("Page.stopScreencast");
      await Promise.all(writes);
      const lines = [];
      for (let i = 0; i < frames.length; i++) {
        const next = i + 1 < frames.length ? frames[i + 1].t : frames[i].t + 1 / fps;
        lines.push(`file '${frames[i].name}'`, `duration ${Math.max(0.001, next - frames[i].t).toFixed(4)}`);
      }
      lines.push(`file '${frames[frames.length - 1].name}'`);
      await fs.writeFile(path.join(dir, "list.txt"), lines.join("\n"));
      const span = frames[frames.length - 1].t - frames[0].t;
      console.log(`  ${frames.length} frames over ${span.toFixed(1)}s (~${(frames.length / span).toFixed(1)} fps captured)`);
      await exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", path.join(dir, "list.txt"),
        "-vf", `scale=${w}:${h}:flags=lanczos,fps=${fps},format=yuv420p`, "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-movflags", "+faststart", out], { maxBuffer: 1 << 26 });
      return { frames: frames.length, span, t0: frames[0].t };
    },
  };
}
