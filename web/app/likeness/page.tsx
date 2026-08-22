import Link from 'next/link';
import { AppShell } from '@/components/AppShell';

export const metadata = {
  title: 'Your likeness — Restage',
  description: 'What happens to the face you enrol, in plain terms.',
};

/*
 * The footer linked "Your likeness, your control" at a span that went nowhere,
 * on a product whose entire input is a person's face. Every statement here is
 * one the code actually enforces — the storage rules, the API's ownership
 * checks and the delete path — rather than reassurance.
 */
const POINTS = [
  {
    q: 'Who can see the face I enrol?',
    a: 'Your enrolment captures: only you. The storage bucket denies reads by default and the rules allow a file only to the account that owns its folder — nothing is world-readable, and no link to them exists outside your account. Generated frames work differently: each carries an unguessable token in its URL so the app can display it, which means anyone you send that URL to can open it. The URL only ever appears in your own run, so it is yours to share or not.',
  },
  {
    q: 'Where is it stored?',
    a: 'Your captures live in Google Cloud Storage under your account’s own folder. Generated frames sit beside them. Finished clips live in Cloudflare R2 behind URLs signed fresh on every request, which expire within the hour and re-check that the run is yours each time.',
  },
  {
    q: 'Does anyone else’s system see it?',
    a: 'Your captures are sent to Google’s Gemini and Veo models to generate frames and clips. That is the only third party involved — there is no aggregator or reseller in between.',
  },
  {
    q: 'Can I delete it?',
    a: 'Yes, and it deletes for real — including the copies. Every run made from a face keeps its own copy of the captures, so removing an avatar deletes those runs, their frames and their rendered clips as well as the enrolment folder itself. Verified by a test that counts the files before and after.',
    link: { href: '/avatars', label: 'Manage your enrolled faces' },
  },
  {
    q: 'What is not true yet?',
    a: 'Voice cloning. A voice sample is optional at enrolment and is stored, but nothing reads it — clips currently use a synthetic voice reading a written line, which is shown to you before anything renders.',
  },
];

export default function Likeness() {
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[720px] flex-1 overflow-y-auto px-6 py-14">
        <h1 className="text-[32px] font-bold tracking-[-0.025em]">Your likeness</h1>
        <p className="mt-2.5 text-[15px] leading-relaxed text-ink-2">
          This product works by putting your face in an advert. That deserves plain answers, so these describe what
          the code does — not what we intend.
        </p>

        <dl className="mt-9 flex flex-col gap-7">
          {POINTS.map((p) => (
            <div key={p.q}>
              <dt className="text-[16px] font-semibold">{p.q}</dt>
              <dd className="mt-1.5 text-[14.5px] leading-relaxed text-ink-2">
                {p.a}
                {p.link && (
                  <>
                    {' '}
                    <Link href={p.link.href} className="font-medium text-accent-ink hover:underline">
                      {p.link.label}
                    </Link>
                  </>
                )}
              </dd>
            </div>
          ))}
        </dl>

        <p className="mt-10 border-t border-line pt-5 text-[13px] leading-relaxed text-ink-3">
          Restage is in beta. If any of the above stops being accurate, this page changes with it.
        </p>
      </div>
    </AppShell>
  );
}
