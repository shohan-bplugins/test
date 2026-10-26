// Finishes the showcase from ../.work/raw.mp4 + beats.json + narration.json.
//
//   node build.mjs                 silent video, script, SRT, TTS text, and a
//                                  guide-voice preview (macOS `say`)
//   node build.mjs --voice <dir>   with your voiceover instead: one file per
//                                  line, named like the script says
//                                  (01-intro.mp3, 02-pins.mp3, …; any of
//                                  mp3/wav/m4a/aiff), each placed at its cue.
//                                  The voiced cut becomes hotspots-showcase.mp4
//                                  (silent copy: hotspots-showcase-silent.mp4),
//                                  its end card held longer if the last line
//                                  needs it.
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WORK } from "./harness.mjs";

const exec = promisify(execFile);
const ROOT = path.resolve(WORK, "../..");
const VIDEOS = path.join(ROOT, "videos");
const NAME = "hotspots-showcase";
const LEAD = 0.4; // each line starts this long after its scene does
const FPS = 60;

const narr = JSON.parse(await fs.readFile("narration.json", "utf8"));
const { beats } = JSON.parse(await fs.readFile(`${WORK}/beats.json`, "utf8"));
const ff = (args) => exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { maxBuffer: 1 << 26 });
const probe = async (f) => parseFloat((await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f])).stdout);
const tc = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const srtTime = (s) => {
  const ms = Math.round(s * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), sec = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};

const lines = narr.map((l, i) => {
  const b = beats.find((x) => x.id === l.id);
  return { ...l, n: i + 1, file: `${String(i + 1).padStart(2, "0")}-${l.id}`, start: b.start + LEAD, window: b.end - b.start - LEAD };
});

/* ---- 1. the voice clips: yours if given, else a guide read ---- */
const vi = process.argv.indexOf("--voice");
const voiced = vi > 0;
const clips = [];
if (voiced) {
  const dir = path.resolve(process.argv[vi + 1]);
  const have = await fs.readdir(dir);
  for (const [k, l] of lines.entries()) {
    const f = have.find((x) => x.replace(/\.(mp3|wav|m4a|aiff?)$/i, "") === l.file);
    if (!f) throw new Error(`missing voice file for line ${l.n}: ${l.file}.mp3`);
    const p = path.join(dir, f);
    const d = await probe(p);
    // A line may run into its next scene a little — it only matters if it
    // would still be speaking when the next line starts.
    const next = lines[k + 1];
    if (next && l.start + d > next.start - 0.1) {
      console.warn(`  ! ${l.file} is ${d.toFixed(1)}s and runs into line ${next.n}`);
    }
    clips.push({ path: p, start: l.start, dur: d });
  }
} else {
  const tts = `${WORK}/tts`;
  await fs.mkdir(tts, { recursive: true });
  for (const l of lines) {
    const txt = `${tts}/${l.file}.txt`, aiff = `${tts}/${l.file}.aiff`;
    await fs.writeFile(txt, l.say);
    await exec("say", ["-v", "Samantha", "-r", "165", "-o", aiff, "-f", txt]);
    clips.push({ path: aiff, start: l.start, dur: await probe(aiff) });
  }
}

/* ---- 2. the picture, held on its last frame if the voice needs longer ---- */
const raw = `${WORK}/raw.mp4`;
const recorded = (await probe(raw)) - 0.35; // drop the closing black
const last = clips[clips.length - 1];
// The closing line finishes, then a beat, before the fade.
const dur = Math.max(recorded, last.start + last.dur + 1.0);
const hold = dur - recorded;
// With a voiceover the main file carries it; the silent cut is kept beside it.
const silent = path.join(VIDEOS, voiced ? `${NAME}-silent.mp4` : `${NAME}.mp4`);
await ff(["-i", raw, "-t", recorded.toFixed(2), "-vf",
  (hold > 0.01 ? `tpad=stop_mode=clone:stop_duration=${hold.toFixed(2)},` : "") +
    `fade=t=in:st=0:d=0.5,fade=t=out:st=${(dur - 0.7).toFixed(2)}:d=0.7`,
  "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", String(FPS),
  "-movflags", "+faststart", "-an", silent]);
console.log(`  ${path.relative(ROOT, silent)}  ${tc(dur)}${hold > 0.01 ? ` (end card held ${hold.toFixed(1)}s longer for the voice)` : ""}`);

/* ---- 3. lay the voice under it ---- */
async function placeVoice(out) {
  const inputs = [], parts = [];
  clips.forEach((c, i) => {
    inputs.push("-i", c.path);
    const d = Math.round(c.start * 1000);
    parts.push(`[${i + 1}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${d}|${d}[a${i}]`);
  });
  const mix = `${clips.map((_, i) => `[a${i}]`).join("")}amix=inputs=${clips.length}:normalize=0:dropout_transition=0,apad,atrim=0:${dur.toFixed(2)},` +
    `afade=t=out:st=${(dur - 0.7).toFixed(2)}:d=0.7,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]`;
  await ff(["-i", silent, ...inputs, "-filter_complex", [...parts, mix].join(";"),
    "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out]);
  console.log(`  ${path.relative(ROOT, out)}  (with voice)`);
}
await placeVoice(path.join(VIDEOS, voiced ? `${NAME}.mp4` : `${NAME}-guide-voice.mp4`));

/* ---- 4. text deliverables ---- */
await fs.writeFile(path.join(ROOT, "subtitles", `${NAME}.srt`),
  lines.map((l, i) => `${i + 1}\n${srtTime(l.start)} --> ${srtTime(l.start + Math.min(l.window, l.sec + 0.3))}\n${l.say}\n`).join("\n"));
await fs.writeFile(path.join(ROOT, "scripts", `${NAME}-tts.txt`), lines.map((l) => l.say).join("\n\n") + "\n");
console.log("  subtitles + tts text written");
console.log(JSON.stringify(lines.map((l) => ({ n: l.n, file: l.file, start: +l.start.toFixed(1), window: +l.window.toFixed(1), sec: l.sec }))));
