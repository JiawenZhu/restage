'use client';

import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { RunWorkspace } from './RunWorkspace';
import type { Run, TreeNode } from '@/lib/types';

/*
 * Firestore's own listener is the live channel. The architecture doc originally
 * called for SSE; that was a wheel we already own — onSnapshot pushes the same
 * updates, survives a refresh for free, and needs no endpoint to keep alive.
 *
 * The orchestrator writes each node the moment it exists, so what arrives here
 * is the agent's progress, not a poll of it.
 */
export function LiveRun({ runId }: { runId: string }) {
  const [run, setRun] = useState<Run | null>(null);
  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const database = db();
    const unsubRun = onSnapshot(
      doc(database, 'runs', runId),
      (snap) => {
        if (!snap.exists()) { setError('That run does not exist, or is not yours.'); return; }
        setRun({ id: snap.id, ...(snap.data() as Omit<Run, 'id'>) });
      },
      // A rules rejection lands here. Saying so beats an empty screen that looks
      // like a slow load.
      () => setError('That run does not exist, or is not yours.'),
    );

    const unsubNodes = onSnapshot(
      query(collection(database, 'runs', runId, 'nodes'), orderBy('createdAt')),
      (snap) => setNodes(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TreeNode, 'id'>) }))),
      () => {},
    );

    return () => { unsubRun(); unsubNodes(); };
  }, [runId]);

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="max-w-sm text-center text-[14px] text-ink-3">{error}</p>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-[13px] text-ink-4">Loading the run…</p>
      </div>
    );
  }

  return <RunWorkspace run={run} nodes={nodes} />;
}
