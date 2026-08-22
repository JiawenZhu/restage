/*
 * Deleting a run, completely.
 *
 * Extracted because it now has two callers and had one definition living inside
 * an unrelated route. Deleting an avatar removes every run built from it, and a
 * user deleting a card in their library removes one — and those two paths have
 * to agree about what "removed" means, forever. A run holds frames of somebody's
 * face in Storage and rendered clips in R2, and the failure mode of drift here
 * is not a bug report, it is copies of a person's likeness left behind after
 * they asked for them to be gone.
 *
 * Order matters and is the same as everywhere else in this codebase: the pixels
 * before the record. A Firestore document with no images is recoverable
 * confusion; images with no document are unreachable and permanent.
 */
import { adminDb, adminStorage } from './firebaseAdmin';
import { deleteVideo } from './r2';

export interface RunDeletion {
  runId: string;
  /** Rendered clips destroyed, across the run and its nodes. */
  clips: number;
  nodes: number;
}

export async function deleteRunCompletely(uid: string, runId: string): Promise<RunDeletion> {
  const db = adminDb();
  const runRef = db.collection('runs').doc(runId);
  const snap = await runRef.get();
  if (!snap.exists) throw new Error('no such run');
  if (snap.data()!.uid !== uid) throw new Error('no such run');

  const bucket = adminStorage().bucket(
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'restage-studio.firebasestorage.app',
  );

  /* Everything under the run's folder: the generated frames, and the copies of
     the enrolment captures createRun places there so the run owns its inputs. */
  await bucket.deleteFiles({ prefix: `users/${uid}/runs/${runId}/` }).catch(() => {});

  let clips = 0;
  const runClip = snap.data()!.videoKey as string | undefined;
  if (runClip) {
    await deleteVideo(runClip).catch(() => {});
    clips++;
  }

  const nodes = await runRef.collection('nodes').get();
  for (const n of nodes.docs) {
    const key = n.data().videoKey as string | undefined;
    if (key && key !== runClip) {
      await deleteVideo(key).catch(() => {});
      clips++;
    }
  }

  /* Batched rather than one delete per node. A run can carry a dozen nodes and
     this used to be a sequential round trip each; more importantly a partial
     failure halfway through left a run document pointing at nodes that were
     already gone. */
  const batch = db.batch();
  for (const n of nodes.docs) batch.delete(n.ref);
  batch.delete(runRef);
  await batch.commit();

  return { runId, clips, nodes: nodes.size };
}
