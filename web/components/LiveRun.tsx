'use client';

import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import { RunWorkspace } from './RunWorkspace';
import { AuthButton } from './AuthGate';
import { demoRun, demoNodes } from '@/lib/demoRun';
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
  const { user, loading: authLoading } = useAuth();
  const [run, setRun] = useState<Run | null>(null);
  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [error, setError] = useState<string | null>(null);

  /*
   * Wait for auth before subscribing, and resubscribe when it arrives.
   *
   * Security rules require request.auth, so a subscription opened before
   * sign-in resolves is rejected — and that rejection was rendered as "that run
   * does not exist, or is not yours". Someone following a link to their OWN run
   * saw that, signed in, and the message stayed, because the effect only ever
   * ran once. The user is a dependency now, and the error clears on each try.
   */
  useEffect(() => {
    if (runId === 'demo') {
      setRun(demoRun);
      setNodes(demoNodes);
      return;
    }

    if (authLoading) return;
    setError(null);
    if (!user) {
      setError('signed-out');
      return;
    }

    const unsubRun = onSnapshot(
      doc(db, 'runs', runId),
      (snap) => {
        if (!snap.exists()) {
          setError('That run does not exist, or is not yours.');
          return;
        }
        setRun({ id: snap.id, ...(snap.data() as Omit<Run, 'id'>) });
      },
      // A rules rejection lands here. Saying so beats an empty screen that looks
      // like a slow load.
      () => setError('That run does not exist, or is not yours.'),
    );

    const unsubNodes = onSnapshot(
      query(collection(db, 'runs', runId, 'nodes'), orderBy('createdAt')),
      (snap) => setNodes(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TreeNode, 'id'>) }))),
      () => {},
    );

    return () => {
      unsubRun();
      unsubNodes();
    };
  }, [runId, user, authLoading]);

  if (error === 'signed-out') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="max-w-sm text-[14px] text-ink-2">
          Sign in to open this run. Runs are private to the account that made them.
        </p>
        <AuthButton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="max-w-sm text-center text-[14px] text-ink-3">{error}</p>
      </div>
    );
  }

  if (authLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-[13px] text-ink-4">Checking your session…</p>
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
