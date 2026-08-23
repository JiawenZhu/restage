/*
 * Crop a generated frame down to the head.
 *
 * WHY THIS EXISTS, from measurements rather than from an idea.
 *
 * Apparent-age drift across an ad's shots was attacked three times in prompt
 * text — an age lock naming the marks, then a casting note, then the same note
 * with the wrinkle vocabulary stripped out. All three measured WORSE than the
 * direction they replaced (see the header block in lib/look.ts for the table).
 * The only thing that ever improved it was handing the model a PICTURE of the
 * face from earlier in the same ad: 3y spread down to 2y, and 3y down to 0y.
 *
 * That approach was dropped for a real defect, not a doubt about it. A
 * reference image cannot show a face without also showing a composition, so
 * shots one and three came back as the same seated pose in the same crop from
 * the same camera position — an ad whose every person shot is the same shot.
 * The prompt asked, in as many words, for the person and not the composition,
 * and was ignored, which is what you would expect: half the image is staging
 * and the model cannot unsee it.
 *
 * So remove the staging from the image instead of asking for it to be ignored.
 * A head crop has no room in it, no furniture, no camera distance and no pose —
 * only the face, which is the thing that was working. Structural rather than a
 * request, which is the same move as putting artefact rules in the negative
 * prompt instead of negating them in the positive one.
 *
 * FAILS TO NULL, ALWAYS. Every caller treats a null as "no anchor this run" and
 * generates exactly as it does today. A face-detection call that times out, a
 * box that comes back nonsense, an ffmpeg that is not installed — none of those
 * are worth failing somebody's ad over, and a bad crop is worse than no crop:
 * an anchor showing half a jaw would teach the model half a jaw.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MODELS, generateContent, type Provider } from './provider';

const run = promisify(execFile);

/** Gemini returns boxes as [ymin, xmin, ymax, xmax] normalised to 0-1000. */
type Box = [number, number, number, number];

/*
 * How much room to leave around the detected head.
 *
 * A tight box crops the hairline and the jaw, and both carry identity —
 * hairstyle is in IDENTITY_LOCK by name. But padding is the thing that undoes
 * the entire point of this file, so it is small and it is capped.
 *
 * First attempt used 0.55 / 0.35 / 0.30, which nearly doubles the box: on a
 * real frame it came back with the shoulders, the product, a basil plant and
 * two kitchen cabinets in it. That is a composition, which is precisely what an
 * anchor must not carry. The model's box already includes hair, so it needs
 * far less help than it looks.
 */
const PAD_TOP = 0.18;
const PAD_BOTTOM = 0.12;
const PAD_SIDE = 0.1;

/*
 * A head does not fill most of a frame.
 *
 * If the padded crop exceeds this, the box was a torso rather than a head —
 * medium shots put the face in a small part of the frame, so anything this
 * large means the detection was loose. Falling back to the unpadded box keeps
 * the crop honest instead of shipping an anchor with a room in it.
 */
const MAX_FRAME_FRACTION = 0.55;

async function dimensions(path: string): Promise<{ w: number; h: number }> {
  const { stdout } = await run('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0',
    path,
  ]);
  const [w, h] = stdout.trim().split(',').map(Number);
  if (!w || !h) throw new Error('could not read image dimensions');
  return { w, h };
}

/*
 * Find the four numbers, whatever the model wrapped them in.
 *
 * The prompt asks for {"box":[…]} and the model does not comply — it answers in
 * Gemini's own detection convention instead, `[{"box_2d":[164,481,417,929]}]`,
 * which it has clearly been trained to prefer over an ad-hoc schema invented in
 * a prompt. The first version of this read `.box` off an object, got an array,
 * and returned null for every image. Detection had worked perfectly each time;
 * the parser threw the answer away.
 *
 * So this looks for the SHAPE rather than the key: the first array of four
 * plausible numbers anywhere in the response. That survives box_2d, box,
 * bbox, a bare array, and whatever the next model version prefers.
 */
function firstBox(v: unknown): Box | null {
  if (Array.isArray(v)) {
    if (v.length === 4 && v.every((n) => typeof n === 'number')) return v as Box;
    for (const item of v) {
      const found = firstBox(item);
      if (found) return found;
    }
    return null;
  }
  if (v && typeof v === 'object') {
    for (const value of Object.values(v)) {
      const found = firstBox(value);
      if (found) return found;
    }
  }
  return null;
}

async function faceBox(
  image: { data: Buffer | Uint8Array; mimeType: string },
  provider: Provider,
  uid?: string,
  apiKey?: string,
): Promise<Box | null> {
  const json = await generateContent({
    provider,
    uid,
    apiKey,
    model: MODELS[provider].fastText,
    label: 'face-box',
    body: {
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: image.mimeType, data: Buffer.from(image.data).toString('base64') } },
            {
              text:
                'Return the bounding box of the single most prominent human head in this ' +
                'image, including hair, as [ymin, xmin, ymax, xmax] normalised to 0-1000. ' +
                'If there is no human head, return an empty array.\n' +
                'Reply as JSON only: {"box":[ymin,xmin,ymax,xmax]}',
            },
          ],
        },
      ],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    },
  });

  const text =
    (json as { candidates?: { content?: { parts?: { text?: string }[] } }[] }).candidates?.[0]?.content?.parts?.[0]
      ?.text ?? '{}';
  const box = firstBox(JSON.parse(text));

  /*
   * Validate rather than trust. A model asked for four numbers sometimes
   * returns three, or a box inverted, or one that fills the frame — and a crop
   * built from any of those is worse than no anchor at all.
   */
  if (!Array.isArray(box) || box.length !== 4) return null;
  const [ymin, xmin, ymax, xmax] = box;
  if (![ymin, xmin, ymax, xmax].every((n) => typeof n === 'number' && n >= 0 && n <= 1000)) return null;
  if (ymax <= ymin || xmax <= xmin) return null;
  // A "head" filling almost the whole frame means it found the picture, not a face.
  if ((ymax - ymin) > 950 && (xmax - xmin) > 950) return null;
  return [ymin, xmin, ymax, xmax];
}

/**
 * The head from this frame, as its own image — or null if that is not possible.
 *
 * @param image a generated frame, typically the ad's first accepted person shot
 */
export async function headCrop(
  image: { data: Buffer | Uint8Array; mimeType: string },
  provider: Provider,
  uid?: string,
  apiKey?: string,
): Promise<{ data: Buffer; mimeType: string } | null> {
  let dir: string | undefined;
  try {
    const box = await faceBox(image, provider, uid, apiKey);
    if (!box) return null;

    dir = await mkdtemp(join(tmpdir(), 'restage-head-'));
    const src = join(dir, 'in.jpg');
    const out = join(dir, 'head.jpg');
    await writeFile(src, Buffer.from(image.data));
    const { w, h } = await dimensions(src);

    const [ymin, xmin, ymax, xmax] = box;
    const top = (ymin / 1000) * h;
    const left = (xmin / 1000) * w;
    const boxH = ((ymax - ymin) / 1000) * h;
    const boxW = ((xmax - xmin) / 1000) * w;

    // Padded, then clamped to the frame — a head near the top of a 9:16 shot
    // would otherwise ask ffmpeg for a negative offset.
    let cropTop = Math.max(0, Math.round(top - boxH * PAD_TOP));
    let cropLeft = Math.max(0, Math.round(left - boxW * PAD_SIDE));
    let cropH = Math.min(h - cropTop, Math.round(boxH * (1 + PAD_TOP + PAD_BOTTOM)));
    let cropW = Math.min(w - cropLeft, Math.round(boxW * (1 + PAD_SIDE * 2)));

    // Too big to be a head: drop the padding and take the detected box as-is.
    if (cropW * cropH > w * h * MAX_FRAME_FRACTION) {
      cropTop = Math.max(0, Math.round(top));
      cropLeft = Math.max(0, Math.round(left));
      cropH = Math.min(h - cropTop, Math.round(boxH));
      cropW = Math.min(w - cropLeft, Math.round(boxW));
    }
    if (cropH < 64 || cropW < 64) return null;

    await run('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-i', src,
      '-vf', `crop=${cropW}:${cropH}:${cropLeft}:${cropTop}`,
      '-q:v', '2',
      out,
    ]);
    return { data: await readFile(out), mimeType: 'image/jpeg' };
  } catch {
    // Deliberately silent about the cause: this is an optional improvement, and
    // a run that loses it simply behaves as it did before it existed.
    return null;
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
