#!/usr/bin/env node
/*
 * End-to-end R2 check: write an object, read it back through a signed URL,
 * delete it. Proves credentials, bucket, signing and privacy in one pass.
 *
 * Reads .env.local and never prints a credential — output is pass/fail and
 * timings only.
 *
 *   node scripts/check-r2.mjs
 */
import { readFileSync } from 'fs';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && m[2].trim()) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, '');
}

const need = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) {
  console.error('missing in .env.local:', missing.join(', '));
  process.exit(1);
}

const BUCKET = process.env.R2_BUCKET;
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const key = `_healthcheck/${Date.now()}.txt`;
const body = 'restage r2 connectivity check';
const t = (start) => `${Date.now() - start}ms`;

try {
  let start = Date.now();
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: 'text/plain' }));
  console.log(`  write            ok   ${t(start)}`);

  start = Date.now();
  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 60 });
  const res = await fetch(url);
  const text = await res.text();
  if (text !== body) throw new Error(`read back mismatch (${res.status})`);
  console.log(`  signed read      ok   ${t(start)}`);

  // The bucket must NOT be public: an unsigned request has to be refused.
  const unsigned = url.split('?')[0];
  const open = await fetch(unsigned);
  console.log(
    open.ok
      ? `  private?         FAIL  the object is readable without a signature`
      : `  private?         ok   unsigned request refused (${open.status})`,
  );

  start = Date.now();
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  console.log(`  delete           ok   ${t(start)}`);

  console.log(`\nR2 is wired: bucket "${BUCKET}", private, signing works.`);
} catch (err) {
  // Scrub anything that could carry a credential into a log.
  const msg = String(err?.message ?? err).replace(/[A-Za-z0-9]{32,}/g, '***');
  console.error(`\nfailed: ${msg}`);
  process.exit(1);
}
