import type { Run, TreeNode } from './types';

/*
 * Stand-in data until the run pipeline lands. It exists so the tree can be built
 * and looked at against real frames rather than grey boxes — the component's
 * whole premise is that nodes are images, and grey boxes would hide every
 * layout problem worth finding.
 */
export const demoRun: Run = {
  id: 'demo',
  uid: 'demo',
  avatarId: 'maya',
  // The clip model tops out at 8 seconds, so the demo does not advertise 15.
  goal: 'An ad where I actually use the serum, in my kitchen. Should feel filmed, not shot.',
  aspect: '9:16',
  seconds: 8,
  // The landing page's "Watch it work" points here, so the demo has to show
  // every part of a real run — including the line the creator says.
  audioScript: 'I keep it by the sink and use it while the coffee brews, and my skin stops feeling tight by about day three.',
  look: {
    location:
      'A sunlit kitchen counter of pale oak beside an open casement window, with a small basil plant and plain cabinetry behind',
    wardrobe: 'A cream ribbed cotton tank top, no jewellery',
    light: 'Late morning sun through the window from camera left, warm and directional, no overhead fill',
    palette: 'Warm oak, cream, soft green, amber glass',
    product:
      'A small amber glass dropper bottle of facial oil with a white pipette top and a plain cream label',
  },
  status: 'running',
  plan: [
    { stepNo: 1, instruction: 'Put them in a real room', rationale: 'A blank wall reads as a set. Kitchens are where this product is actually used.', status: 'done' },
    { stepNo: 2, instruction: "Move to arm's-length framing", rationale: 'Nobody films themselves on a tripod. The camera has to be a hand.', status: 'done' },
    { stepNo: 3, instruction: 'Light it from the window', rationale: 'Retried once — the first pass went full studio and lost the room.', status: 'retried' },
    { stepNo: 4, instruction: 'Get the product to the lens', rationale: 'The bottle has to be legible in the first two seconds or the scroll wins.', status: 'running' },
    { stepNo: 5, instruction: 'Loosen the expression', rationale: 'Mid-sentence beats posed. A closed mouth reads as a photograph.', status: 'pending' },
    { stepNo: 6, instruction: 'Render the clip', rationale: 'The approved frame becomes the first frame of the clip.', status: 'pending' },
  ],
  /*
   * Relative to now, not zero.
   *
   * The workspace flags a live run with no progress for ten minutes as stopped
   * — and epoch-zero timestamps are always older than that, so the public demo
   * the landing page links to always displayed the "NO PROGRESS" warning. A
   * getter keeps it fresh however long the module has been cached.
   */
  get createdAt() {
    return Date.now() - 90_000;
  },
  get updatedAt() {
    return Date.now() - 5_000;
  },
};

const t = (n: number) => n * 1000;

export const demoNodes: TreeNode[] = [
  { id: 'root', parentId: null, stepNo: 0, kind: 'avatar', status: 'achieved', frameUrl: '/img/av-front.jpg', createdAt: t(1) },
  {
    id: 'n1', label: 'Kitchen scene', parentId: 'root', stepNo: 1, kind: 'frame', status: 'achieved', frameUrl: '/img/f1.jpg',
    instruction: 'Put them in a real room',
    rationale: 'A blank wall reads as a set. Kitchens are where this product is actually used, so the room has to carry that.',
    verdict: 'met',
    criticRubric: 'does the room look lived in?',
    criticNotes: '"The counter has objects that were not placed for the shot. That is what separates a room from a set."',
    createdAt: t(2),
  },
  {
    id: 'n2', label: "Arm's-length framing", parentId: 'n1', stepNo: 2, kind: 'frame', status: 'achieved', frameUrl: '/img/f2.jpg',
    instruction: "Move to arm's-length framing",
    rationale: 'Nobody films themselves on a tripod. The camera has to read as a hand at the end of an arm.',
    verdict: 'met',
    criticRubric: 'could a person holding a phone have taken this?',
    criticNotes: '"Framing is off-centre and slightly high, which is where a held phone naturally sits. It reads as a hand."',
    createdAt: t(3),
  },
  // The discarded attempt stays on the canvas. It is the proof of autonomy.
  {
    id: 'n3x', label: 'Window light', parentId: 'n2', stepNo: 3, kind: 'frame', status: 'failed', frameUrl: '/img/fx.jpg',
    discarded: true,
    instruction: 'Light it from the window',
    rationale: 'First attempt at relighting.',
    verdict: 'failed',
    criticRubric: 'would a phone have produced this light?',
    criticNotes: '"Lit them like a beauty campaign — clean gradient on the cheek, no room left behind. That is the opposite of the goal."',
    createdAt: t(4),
  },
  {
    id: 'n3', label: 'Window light', parentId: 'n2', stepNo: 3, kind: 'frame', status: 'partial', frameUrl: '/img/f3.jpg',
    instruction: 'Light it from the window',
    rationale: 'Overhead room light flattens the face and puts a shadow under the jaw that no phone video has. Side light is what a real kitchen gives at that hour.',
    verdict: 'partial',
    criticRubric: 'would a phone have produced this light?',
    criticNotes: '"Retried with the source pushed to one side and the background allowed to blow out slightly, which is what a real window does. The falloff is right now."',
    createdAt: t(5),
  },
  {
    id: 'n4', label: 'Product to lens', parentId: 'n3', stepNo: 4, kind: 'frame', status: 'generating', frameUrl: '/img/f4.jpg',
    instruction: 'Get the product to the lens',
    rationale: 'The bottle has to be legible in the first two seconds or the scroll wins.',
    createdAt: t(6),
  },
];
