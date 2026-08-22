/*
 * R2 holds finished videos and nothing else. Frames and avatar captures stay on
 * Firebase Storage, beside the auth that owns them — the egress saving on a
 * 20 KB JPEG is not worth splitting a user's assets across two providers.
 *
 * SERVER ONLY, same reasoning as lib/gemini.
 */

if (typeof window !== 'undefined') {
  throw new Error(
    'lib/r2 is server-only. Importing it from a client component would bundle ' +
      'R2_SECRET_ACCESS_KEY into the page.',
  );
}

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const BUCKET = process.env.R2_BUCKET ?? 'video-renders';

let client: S3Client | null = null;

function s3(): S3Client {
  if (client) return client;

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 credentials are not set — see .env.example');
  }

  // R2 speaks S3, but only from its own endpoint, and it ignores regions. "auto"
  // is what Cloudflare documents; a real region name is silently accepted and
  // then unused, which is worse than obvious.
  client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return client;
}

/** Deterministic, and scoped by user so one uid's key can never address another's. */
export function videoKey(uid: string, runId: string, nodeId: string) {
  return `${uid}/${runId}/${nodeId}.mp4`;
}

export async function putVideo(key: string, bytes: Buffer): Promise<void> {
  await s3().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: bytes,
      ContentType: 'video/mp4',
    }),
  );
}

/**
 * The bucket is private, so playback goes through a short-lived signed URL
 * rather than a public object. An hour is long enough to watch a 15-second clip
 * and short enough that a URL pasted into a group chat stops working.
 */
export async function signedVideoUrl(
  key: string,
  expiresInSeconds = 3600,
  asDownload = false,
): Promise<string> {
  return getSignedUrl(
    s3(),
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      /*
       * The <a download> attribute is ignored cross-origin, and R2 is a
       * different origin — so a "download" link would have opened the video in
       * a tab instead. Content-Disposition is signed into the URL, which the
       * browser does honour.
       */
      ...(asDownload ? { ResponseContentDisposition: 'attachment; filename="restage-clip.mp4"' } : {}),
    }),
    { expiresIn: expiresInSeconds },
  );
}

/** Deleting an avatar has to delete what was generated from it. */
export async function deleteVideo(key: string): Promise<void> {
  await s3().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}
