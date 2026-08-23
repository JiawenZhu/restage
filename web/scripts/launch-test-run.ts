import fs from 'fs';
import { createRun, executeRun } from '../lib/orchestrator';

// Load .env.local
const envFile = fs.readFileSync('.env.local', 'utf8');
envFile.split('\n').forEach((line) => {
  const m = line.match(/^([^=]+)=(.*)$/);
  if (m && !process.env[m[1].trim()]) {
    process.env[m[1].trim()] = m[2].trim();
  }
});

async function main() {
  const frontImg = fs.readFileSync('public/img/persona-front.jpg');
  const leftImg = fs.readFileSync('public/img/persona-left.jpg');
  const rightImg = fs.readFileSync('public/img/persona-right.jpg');

  const avatarDataUrl = 'data:image/jpeg;base64,' + frontImg.toString('base64');
  const leftDataUrl = 'data:image/jpeg;base64,' + leftImg.toString('base64');
  const rightDataUrl = 'data:image/jpeg;base64,' + rightImg.toString('base64');

  const goal = 'A 15-second TikTok UGC ad in a sunlit kitchen showing a daily morning skin glow serum. Authentic hand-held phone vibe.';

  const startArgs = {
    uid: 'test-creator',
    goal,
    aspect: '9:16' as const,
    seconds: 8 as const,
    avatarDataUrl,
    avatarMultiViews: {
      front: avatarDataUrl,
      left: leftDataUrl,
      right: rightDataUrl,
    },
  };

  console.log('Creating new run in Firestore...');
  const runId = await createRun(startArgs);
  console.log('=== RUN CREATED SUCCESSFULLY ===');
  console.log('RUN_ID:', runId);
  console.log('STUDIO_URL: http://localhost:3100/studio/' + runId);
  console.log('ENROLL_URL: http://localhost:3100/enroll');
  console.log('================================');

  // Trigger orchestrator execution in background
  executeRun(runId, startArgs).then(() => {
    console.log('Orchestrator completed run:', runId);
  }).catch((err) => {
    console.error('Orchestrator error:', err);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
