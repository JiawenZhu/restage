import type { ShotKind } from './types';
import type { TemplateModules } from './modules';

export interface CreativeTemplate {
  id: string;
  name: string;
  /*
   * Two axes, deliberately.
   *
   * 'Ad format' says what the ad DOES — unboxing, testimonial, before-and-after.
   * The rest say where it is SET. The existing ten are all the second kind,
   * which is why they read as one idea in ten costumes: their plans are the
   * same shape and only their wardrobe differs.
   */
  category: 'Ad format' | 'Cinematic' | 'Sci-Fi' | 'Social UGC' | 'Retro' | 'Artistic' | 'Gaming';
  badge?: string;
  tagline: string;
  defaultPrompt: string;
  cameraMotion: string;
  lightingAndColor: string;
  secondaryPhysics: string;
  keywords: string[];
  gradient: string;
  icon: string;
  /*
   * What this template changes about how its shots are made.
   *
   * Every key is optional and falls back to the registry in lib/modules.ts, so
   * a template that only wants harder light writes one line. Anything not set
   * here is inherited, and changing an inherited rule for ALL templates is a
   * one-line edit to that module's fallback rather than sixteen edits here.
   *
   * Three modules are deliberately absent from this type — identity, optics and
   * anatomy. They are what keep the ad a picture of the actual user, and a
   * template may not trade the user's face for a look.
   *
   * When this is omitted, styleForTemplate derives light and camera from
   * lightingAndColor / cameraMotion, which is how the original sixteen work.
   */
  modules?: TemplateModules;
  presetSteps: {
    label: string;
    instruction: string;
    rationale: string;
    /*
     * What this shot is OF, and it is the most consequential field here.
     *
     * Every template used to be five shots of the person, because every step
     * was an edit of the frame before it and the person was in that frame. That
     * is not what an ad looks like, and it is expensive in the one currency
     * this product cannot spend: by the fifth generation of reinterpreting a
     * face, it is somebody else's face.
     *
     * A real cut is mostly things that are not faces — the product in a hand,
     * the label, the room. Those shots carry no identity risk at all, so they
     * can be generated clean at full quality, and they are what makes a
     * sequence read as an advertisement rather than a photo set.
     */
    shot: ShotKind;
  }[];
}

export const CREATIVE_TEMPLATES: CreativeTemplate[] = [
  {
    id: 'moon',
    name: 'Moon Expedition',
    category: 'Sci-Fi',
    badge: 'Popular',
    tagline: 'Astronaut on the lunar surface with glowing Earth reflection and electric rover.',
    defaultPrompt:
      'A creator in a minimalist astronaut suit exploring the lunar crater surface beside an electric Tesla rover, with Earth glowing in the cosmic black sky.',
    cameraMotion:
      'Smooth forward dolly tracking shot with gentle spatial parallax, 35mm lens, sharp lunar horizon perspective.',
    lightingAndColor:
      'Direct stark solar illumination with jet-black cast shadows, subtle cyan Earth-glow rim lighting, crisp high-contrast space lighting.',
    secondaryPhysics:
      'Fine gray lunar dust particles drifting in low gravity, faint cockpit dashboard shimmer, atmospheric shimmer on visor.',
    keywords: ['astronaut suit', 'lunar surface', 'Earth in sky', 'electric rover', 'cosmic dust', 'visor reflection'],
    gradient: 'from-slate-900 via-indigo-950 to-slate-800',
    icon: '🌕',
    presetSteps: [
      {
        shot: 'scene',
        label: 'Crater Horizon',
        instruction:
          'Open wide on a gray crater floor running to a hard black horizon, the blue Earth small and bright high in the sky, an electric rover crossing the far distance with a thin dust trail.',
        rationale:
          'One uninterrupted wide is what makes a viewer accept the location; every tight shot after it inherits that belief without having to re-establish anything.',
      },
      {
        shot: 'detail',
        label: 'Dust in Low Gravity',
        instruction:
          'Go low and close on a rover tire spinning through fine gray dust, the grains thrown up in slow parabolic arcs that drop straight back instead of billowing.',
        rationale:
          'Dust that falls in arcs rather than hanging as a cloud is the single cue that separates lunar footage from a truck filmed in a quarry.',
      },
      {
        shot: 'person',
        label: 'Suit at the Rover',
        instruction:
          'Show the enrolled creator in a minimalist white spacesuit with the visor raised, standing beside the parked rover, Earth over the shoulder against black sky.',
        rationale:
          'This is the frame that attaches a person to the place, and keeping it to one clean full-body look is what keeps the likeness sharp instead of drifting across the cut.',
      },
      {
        shot: 'product',
        label: 'Gloved Handoff',
        instruction:
          'Frame gloved hands lifting the product out of the rover\'s cargo deck and turning it slowly into unfiltered sunlight, black sky behind.',
        rationale:
          'On a surface with no trees, doors, or furniture, a hand is the only scale reference available — this is where the viewer learns how big the thing actually is.',
      },
      {
        shot: 'detail',
        label: 'Label in Full Sun',
        instruction:
          'Push in macro across the product\'s embossed seam and surface finish in direct sunlight, shadow inside every ridge jet black, fine gray dust settled in the seams.',
        rationale:
          'Sun with no air to soften it renders type and material harder than any studio light, and the dust caught in the seams sells that the product was really taken out there.',
      },
      {
        shot: 'person',
        label: 'Behind the Glass',
        instruction:
          'Shoot the enrolled creator through the rover\'s cockpit glass with both hands on the steering yoke, visor raised, cyan Earth-glow sliding across the curved pane.',
        rationale:
          'Operating the vehicle turns the suit into a job rather than a costume, and it is a closer, warmer angle than the first human shot instead of a repeat of it.',
      },
      {
        shot: 'product',
        label: 'Earth Behind It',
        instruction:
          'Hold the product up in one gloved hand, centered so the blue Earth sits directly behind it in the black sky, rim light along one edge.',
        rationale:
          'Ends on the product framed against the most recognizable object anyone could put in a sky — the frame people screenshot and the one that carries the brand out of the video.',
      },
    ],
  },
  {
    id: 'comic-book',
    name: 'Comic Book Hero',
    category: 'Artistic',
    badge: 'Trending',
    tagline: '80s dynamic pop-art graphic novel panel with explosive energy bursts.',
    defaultPrompt:
      'A charismatic hero in a vibrant retro streetwear tracksuit bursting out of a comic book grid panel with dynamic ink splatters and electric energy rays.',
    cameraMotion:
      'Dynamic snap-zoom tracking into a high-energy hero Dutch angle with cel-shaded parallax.',
    lightingAndColor:
      'High-saturation CMYK pop-art palette, bold black ink line art, bright cyan energy beam highlights.',
    secondaryPhysics:
      'Dynamic ink splatters, halftone print dot patterns, explosive action burst lines.',
    keywords: ['comic panel', 'pop-art halftone', 'energy beam', 'bold ink outlines', 'action pose'],
    gradient: 'from-amber-600 via-rose-600 to-yellow-500',
    icon: '💥',
    presetSteps: [
      {
        shot: 'scene',
        label: 'Panel One Establish',
        instruction:
          'Draw an empty city street in flat CMYK ink under a halftone sky, boxed by a thick black comic panel border with visible newsprint grain.',
        rationale:
          'Comics open on a wide empty panel before anyone walks into it, and setting the ink-and-newsprint rules on frame one means every later cut reads as a printed page rather than a filter dropped over video.',
      },
      {
        shot: 'product',
        label: 'Product Panel',
        instruction:
          'Show the product raised in a gloved hand against a flat yellow color field, outlined in heavy black contour with cel-shaded blocks of teal.',
        rationale:
          'The product gets a panel to itself before any hero claims it, so a viewer who scrolls past after two seconds still knows what is being sold.',
      },
      {
        shot: 'detail',
        label: 'Halftone Ink Macro',
        instruction:
          'Push in macro across the printed colour field of the label until the individual CMYK print dots and a hairline magenta misregistration are visible in the ink.',
        rationale:
          'Real four-color printing only shows its dots this close, and that is the distance where an imitation comic look usually falls apart into smooth digital gradients.',
      },
      {
        shot: 'person',
        label: 'Hero Turn',
        instruction:
          'Place the enrolled creator in a retro yellow and teal tracksuit, low angle, caught mid-turn in bold black contour lines with radial speed lines converging behind.',
        rationale:
          'One human beat is what makes the page feel inhabited instead of illustrated, and spending the likeness on a single low-angle turn keeps the face recognizable where it matters.',
      },
      {
        shot: 'product',
        label: 'Energy Blast Panel',
        instruction:
          'Erupt a cyan energy beam out of the product across two panels, breaking the gutter with black ink splatter and jagged burst lines.',
        rationale:
          'In this format the power surge is the claim about what the product does, so it belongs to the object rather than to an outstretched palm.',
      },
      {
        shot: 'person',
        label: 'Bursting The Border',
        instruction:
          'Have the enrolled creator lunge toward camera through a torn panel border, paper edges curling and halftone fragments trailing behind.',
        rationale:
          'Breaking the frame is the one image the comic-cover format exists to deliver, and ending on it gives the cut a beat worth screenshotting.',
      },
    ],
  },
  {
    id: 'noir',
    name: '1940s Film Noir',
    category: 'Cinematic',
    badge: 'Classic',
    tagline: 'Moody black-and-white detective scene in a rain-slicked neon alley.',
    defaultPrompt:
      'A 1940s private detective in a trench coat and fedora standing under a flickering neon ramen sign in a rain-soaked urban alleyway at night.',
    cameraMotion:
      'Slow atmospheric panning shot with low-angle Dutch tilt and deep venetian blind shadow play.',
    lightingAndColor:
      'High-contrast chiaroscuro monochrome black-and-white, glowing neon rim lights, glistening asphalt reflections.',
    secondaryPhysics:
      'Continuous vertical rain streaks, rising sewer steam, puddle ripples with neon reflections.',
    keywords: ['fedora trench coat', 'rainy alley', 'neon ramen sign', 'chiaroscuro shadows', 'steamy street'],
    gradient: 'from-zinc-900 via-neutral-900 to-stone-900',
    icon: '🕵️‍♂️',
    presetSteps: [
      {
        shot: 'scene',
        label: 'Rain-Slicked Alley',
        instruction:
          'Open on an empty 1940s brick alleyway at night in high-contrast black-and-white — wet asphalt throwing back the streetlamps, steam curling from a manhole, rain falling in fine vertical streaks.',
        rationale:
          'An empty street implies something already happened here, which holds a viewer for a beat before anything is being sold.',
      },
      {
        shot: 'detail',
        label: 'Neon On Wet Glass',
        instruction:
          'Push in tight on a flickering neon ramen sign, rain beading and running down the curved glass tubing, the glow flaring to blown-out white against black brick.',
        rationale:
          'Noir sells on texture, not plot — the buzzing tube and the running water give the eye something to sit on and set the light source everything later is lit by.',
      },
      {
        shot: 'product',
        label: 'Passed Across The Counter',
        instruction:
          'Frame gloved hands sliding the product across a rain-beaded counter beneath the sign, camera low and tight to the countertop.',
        rationale:
          'Something changing hands is the oldest beat in the genre, and it drops the product into the story instead of parking it beside one.',
      },
      {
        shot: 'person',
        label: 'Under The Brim',
        instruction:
          'Reveal the enrolled creator in a dark trench coat with the collar turned up and a fedora angled low, lit by one hard side light so half the face falls into black.',
        rationale:
          'The withheld half of a face is the entire genre in a single frame, and it is where the ad finally gets a person a viewer can attach the claim to.',
      },
      {
        shot: 'detail',
        label: 'Slats Across The Label',
        instruction:
          'Macro on the product label with hard venetian-blind shadow bars raking diagonally across it, dust drifting through the shafts of light.',
        rationale:
          'Striping the label with blinds forces a slow read of the product form and does it with the room\'s own light, so no graphic overlay is needed.',
      },
      {
        shot: 'person',
        label: 'Half-Lit Payoff',
        instruction:
          'Hold on the enrolled creator raising the product into the single shaft of light, one eye sharply lit and the rest in shadow, rain and steam behind, monochrome throughout.',
        rationale:
          'Ending on the lift binds the face and the object in one frame, so the last thing on screen carries both the endorsement and the product\'s silhouette.',
      },
    ],
  },
  {
    id: 'indie-pastel',
    name: 'Indie Pastel (Wes Anderson)',
    category: 'Cinematic',
    badge: 'Aesthetic',
    tagline: 'Symmetrical pastel framing, vintage cardigan, and deadpan indie charm.',
    defaultPrompt:
      'A deadpan indie creator standing centered in a pastel powder-blue room with vintage framed paintings, wearing a mustard knit cardigan and holding a leather notebook.',
    cameraMotion:
      'Perfect centered stationary 50mm eye-level perspective with exact symmetrical framing and zero camera tilt.',
    lightingAndColor:
      'Soft diffused pastel color palette (powder blue, mustard yellow, dusty rose), warm even interior ambient light.',
    secondaryPhysics:
      'Subtle dust motes drifting in sunbeams, gentle page flutter on the notebook.',
    keywords: ['symmetrical framing', 'pastel blue room', 'mustard cardigan', 'deadpan expression', 'vintage frames'],
    gradient: 'from-sky-700 via-amber-600 to-rose-700',
    icon: '🎨',
    presetSteps: [
      {
        shot: 'scene',
        label: 'Powder-Blue Room',
        instruction:
          'Frame an empty powder-blue paneled room head-on and dead center, matched gold-framed oil paintings flanking a closed doorway, dust drifting through a single shaft of window light.',
        rationale:
          'The room talks first: a viewer reads that much symmetry as deliberate craft and expects everything placed in it afterward to be handled with the same care.',
      },
      {
        shot: 'product',
        label: 'Overhead Flat-Lay',
        instruction:
          'Shoot straight down at a dusty-rose tabletop with the product centered and its accessories laid out in exact mirror symmetry, one hand entering frame to nudge it half an inch into position.',
        rationale:
          'The overhead grid of objects is this format\'s signature punchline, and the half-inch correction is what makes the fussiness funny rather than sterile.',
      },
      {
        shot: 'detail',
        label: 'Label In Macro',
        instruction:
          'Fill the frame with the product\'s label grain and surface texture in macro, mustard and powder-blue reflections sliding across it under soft warm grain.',
        rationale:
          'This is the closest anyone gets to handling the thing — printed edge, weave, finish — and it is the shot that answers whether the product is actually nice.',
      },
      {
        shot: 'person',
        label: 'Centered In The Doorway',
        instruction:
          'Place the creator full-body dead center in the doorway in a mustard knit cardigan and horn-rimmed glasses, arms straight down, product held in one hand, perfectly still.',
        rationale:
          'Arriving inside geometry the viewer already learned makes the person look like part of the design instead of someone dropped in front of a backdrop.',
      },
      {
        shot: 'person',
        label: 'Deadpan Straight-On',
        instruction:
          'Punch in to a chest-up eye-level frame of the creator staring straight down the lens with a flat, unblinking expression, the product raised into the bottom of the frame.',
        rationale:
          'The stillness is the joke, and one held beat of a real person looking directly at the viewer buys more trust than a reel of talking would.',
      },
      {
        shot: 'product',
        label: 'Chapter One Card',
        instruction:
          'Rest the product alone and centered on the mantel between the two paintings, gold serif text reading CHAPTER ONE across the upper third, warm Kodak Portra grain and settling dust over the whole frame.',
        rationale:
          'Closing on the object wearing the film\'s own typography leaves the product, not the presenter, as the last image the viewer carries out of the ad.',
      },
    ],
  },
  {
    id: 'chaotic-vlog',
    name: 'Chaotic City Vlog',
    category: 'Social UGC',
    badge: 'Viral',
    tagline: 'Fast-paced transit commute vlog with authentic phone camera movement and sticker badges.',
    defaultPrompt:
      'An authentic creator filming a selfie vlog on a moving city tram with colorful European streets blurring past the window and an "On the move 🚊" sticker badge.',
    cameraMotion:
      'Handheld smartphone selfie camera with natural walking cadence, organic breathing motion, and real commute micro-shakes.',
    lightingAndColor:
      'Natural daylight streaming through tram windows, authentic iPhone camera exposure with soft window blowouts.',
    secondaryPhysics:
      'Streets and bicyclists panning smoothly past the tram window, subtle hair flutter.',
    keywords: ['tram commute', 'selfie vlog', 'window blur', 'sticker badge', 'natural daylight'],
    gradient: 'from-emerald-700 via-teal-800 to-cyan-900',
    icon: '🚊',
    presetSteps: [
      {
        shot: 'scene',
        label: 'Tram Pulls In',
        instruction:
          'Film a city tram sliding into a curbside stop on a pastel European street, doors folding open.',
        rationale:
          'Something is already moving in the first half second, which buys the scroll-stop before any pitch starts.',
      },
      {
        shot: 'person',
        label: 'Window Seat Hello',
        instruction:
          'Shoot the creator on a tram window seat in a denim jacket over a hoodie, phone held at arm\'s length, starting a sentence straight to the lens.',
        rationale:
          'One clear look at who is talking is what makes everything after it land as a recommendation instead of an ad.',
      },
      {
        shot: 'product',
        label: 'Product Against The Glass',
        instruction:
          'Hold the product up in front of the tram window with one hand while the street slides past behind it, phone camera close.',
        rationale:
          'The moving background does the job a studio turntable would — the item reads as a real object in a real place because the world behind it keeps sliding.',
      },
      {
        shot: 'detail',
        label: 'Label In Sunlight',
        instruction:
          'Go macro on the label and surface texture as a strip of window sunlight crosses it and flickers with the tram\'s motion.',
        rationale:
          'This is the only frame where the name and material are actually legible, and that is what a viewer goes looking for before they go looking for a person.',
      },
      {
        shot: 'scene',
        label: 'Streets Blurring Past',
        instruction:
          'Fill the frame with the glass — shopfronts, awnings and parked bikes streaking by — and pin a rounded sticker badge reading "On the move 🚊" near the window edge.',
        rationale:
          'A breath between the pitch and the payoff, and the sticker is what tells the feed this is a story post rather than a commercial.',
      },
      {
        shot: 'person',
        label: 'First Reaction Beat',
        instruction:
          'Catch the creator actually using the product on the tram, loose handheld framing, half a laugh, phone tilted slightly off level.',
        rationale:
          'Reaction is the part people screenshot, and a frame that is not quite level is the cheapest proof the moment was not staged.',
      },
      {
        shot: 'product',
        label: 'Off At The Stop',
        instruction:
          'Frame a hand gripping the product beside the tram\'s yellow pole as the doors open onto the street and daylight floods.',
        rationale:
          'Ending on the object leaving with the ride, not on a face, means the last thing held in memory is the thing being sold.',
      },
    ],
  },
  {
    id: 'decades-fashion',
    name: 'Decades Fashion (90s)',
    category: 'Retro',
    badge: 'Trending',
    tagline: '90s Venice Beach promenade with palm trees and sun-drenched vintage film stock.',
    defaultPrompt:
      'A confident creator walking along a 90s Venice Beach palm-lined boardwalk in oversized vintage denim, bathed in warm golden hour sunlight.',
    cameraMotion:
      'Slow smooth walking tracking camera moving backwards keeping pace with the creator, 35mm lens with soft bokeh.',
    lightingAndColor:
      'Golden hour warm amber sunlight, soft lens flare, rich 90s Fuji 35mm film saturation.',
    secondaryPhysics:
      'Palm fronds gently swaying in ocean breeze, subtle lens flare streaks.',
    keywords: ['90s fashion', 'Venice beach', 'palm trees', 'golden hour', 'vintage denim'],
    gradient: 'from-amber-700 via-orange-600 to-yellow-600',
    icon: '🌴',
    presetSteps: [
      {
        shot: 'scene',
        label: 'Empty Golden Promenade',
        instruction:
          'Open wide on a deserted concrete beachside promenade lined with tall California palms, long shadows raking across the sand toward the ocean in low amber sun.',
        rationale:
          'The location dates the whole film before a single garment appears — palms and 6PM light say nineties California faster than any wardrobe can.',
      },
      {
        shot: 'product',
        label: 'Denim Laid Out',
        instruction:
          'Lay an oversized indigo denim shirt and a folded charcoal tee flat across a sun-warmed concrete ledge with classic sunglasses resting on the collar.',
        rationale:
          'People buying vintage-cut clothing want to see the pieces unstyled and flat first; a styled body hides how big the shirt actually is.',
      },
      {
        shot: 'detail',
        label: 'Indigo Weave Macro',
        instruction:
          'Fill the frame with the denim twill in raking sunlight: whiskered fade at the fold, a copper rivet, one loose thread at the seam.',
        rationale:
          'Fade and wear are the difference between real vintage denim and a costume version of it, and that only reads at macro distance.',
      },
      {
        shot: 'person',
        label: 'Walking Tracking Beat',
        instruction:
          'Track backwards at chest height with the creator mid-stride, denim shirt open and swinging, low sun rimming the shoulders.',
        rationale:
          'This is the one frame that has to prove the fit moves — how an oversized shirt hangs and swings when a person actually walks in it.',
      },
      {
        shot: 'product',
        label: 'Cuff And Sneaker',
        instruction:
          'Frame at knee height as a hand rolls the denim cuff above a scuffed white low-top sneaker, cracked concrete and palm shadow underneath.',
        rationale:
          'The cuff roll is the specific thing viewers copy, and at shoe level it shows the exact break and height to wear it at.',
      },
      {
        shot: 'person',
        label: 'Walk Away Wide',
        instruction:
          'Hold a static wide as the creator walks away down the promenade, small between the palms, sun dropping into a soft 35mm flare with fine film grain.',
        rationale:
          'Ends on the silhouette and the light rather than a close face — the outfit is still the last thing on screen, and the flare sells the film stock.',
      },
    ],
  },
  {
    id: 'step-into-history',
    name: 'Step Into History',
    category: 'Cinematic',
    badge: 'Epic',
    tagline: 'Overlooking the ancient Colosseum from a grand marble stone balcony.',
    defaultPrompt:
      'A commanding protagonist standing on a grand marble palace balcony overlooking ancient Rome with the Colosseum bathed in dramatic sunset light.',
    cameraMotion:
      'Epic slow crane push-in from high angle down to eye level, 24mm wide angle with deep focus.',
    lightingAndColor:
      'Dramatic sunset chiaroscuro, warm golden stone highlights against deep valley shadows, crimson flags fluttering.',
    secondaryPhysics:
      'Crimson banners fluttering in the wind, rising smoke from distant braziers.',
    keywords: ['ancient Rome', 'marble balcony', 'Colosseum overlook', 'crimson flags', 'sunset epic'],
    gradient: 'from-amber-900 via-red-950 to-stone-900',
    icon: '🏛️',
    presetSteps: [
      {
        shot: 'scene',
        label: 'Rome, Last Light',
        instruction:
          'Open wide on an empty weathered marble balustrade above a sprawling ancient city, crimson banners snapping on stone poles either side, the Colosseum gold on the horizon.',
        rationale:
          'An empty balcony reads as a vantage somebody is about to take, and the drop to the city below is what gives every later shot its height.',
      },
      {
        shot: 'detail',
        label: 'Two Thousand Years',
        instruction:
          'Fill the frame with the balustrade\'s edge in macro: pitted limestone, hand-cut chisel grooves, dust caught in the pores, sunlight raking sideways across the ridges.',
        rationale:
          'Age is the one thing this template has to sell, and at this distance a viewer can tell cut stone from a rendered rail — the sequence is believed or lost right here.',
      },
      {
        shot: 'person',
        label: 'The Vantage Taken',
        instruction:
          'Place the creator at the balustrade in a leather tunic and deep crimson cloak, three-quarters from behind, low sun cutting a bright rim down one shoulder.',
        rationale:
          'Holding the figure back until the third shot makes the arrival land, and shooting from behind puts the viewer beside the same city rather than in front of a costume.',
      },
      {
        shot: 'product',
        label: 'Set On The Marble',
        instruction:
          'Set the product upright on the sun-warmed stone ledge, a hand steadying it and then drawing out of frame, the Colosseum thrown soft and gold far behind.',
        rationale:
          'Standing it on the same stone the previous shot just proved is ancient borrows the monument\'s permanence without a line of voiceover doing the work.',
      },
      {
        shot: 'detail',
        label: 'Surface In Raking Sun',
        instruction:
          'Push in macro on the front of the product, surface grain and the embossed label edge lit by the low sun, with a crimson banner rippling out of focus behind and spilling red into the highlights.',
        rationale:
          'This is the only frame where the name can actually be read, and the moving red behind stops a static macro from looking like a catalogue photo.',
      },
      {
        shot: 'person',
        label: 'Eye Level, City Burning',
        instruction:
          'Drop the camera to eye level on the creator turned toward the lens, warm bounce off the pale stone filling the face, the lit city falling away behind.',
        rationale:
          'After four shots of stone and object, one direct look turns the spectacle into a claim a specific person is making.',
      },
      {
        shot: 'scene',
        label: 'Out Over The Forum',
        instruction:
          'End on a high wide of the forum below: long architectural shadows across the paving, brazier smoke drifting through the light, heavy 70mm grain and deep contrast.',
        rationale:
          'Cutting away from the person for the last beat leaves scale as the closing impression and keeps a quiet corner of frame free for an end card.',
      },
    ],
  },
  {
    id: 'science-concept',
    name: 'Science Concept Explainer',
    category: 'Sci-Fi',
    badge: 'Tech',
    tagline: 'Futuristic cyber grid background with 3D kinetic typography and holographic effects.',
    defaultPrompt:
      'An engaging tech presenter in front of a curved neon spacetime grid backdrop with glowing 3D "MASS" kinetic typography and orbital particles.',
    cameraMotion:
      'Modern tech-keynote dynamic tracking push with smooth camera breathing and floating HUD depth.',
    lightingAndColor:
      'Cool cyan and electric yellow lighting accents against dark cosmic indigo space.',
    secondaryPhysics:
      'Glowing particle streams curving along grid lines, pulsing holographic wireframes.',
    keywords: ['spacetime grid', '3D typography', 'tech explainer', 'holographic HUD', 'neon science'],
    gradient: 'from-blue-900 via-indigo-900 to-cyan-900',
    icon: '🔬',
    presetSteps: [
      {
        shot: 'scene',
        label: 'Warped Grid Horizon',
        instruction:
          'Open wide on an empty curved neon grid bending into a shallow well beneath a dense starfield, cyan lines fading into cosmic indigo at the edges.',
        rationale:
          'A bent grid reads as physics before a viewer reads a single word, so the ad buys its first second of attention without making a claim yet.',
      },
      {
        shot: 'detail',
        label: 'Gravity Well Close',
        instruction:
          'Push in macro on the point where the grid lines bend, a thin stream of cyan particles running downhill along one line into the dip.',
        rationale:
          'Motion at macro scale is what separates a demonstration from a diagram; the viewer sees something actually being pulled rather than a static graphic.',
      },
      {
        shot: 'person',
        label: 'Presenter On The Grid',
        instruction:
          'Frame the creator chest-up standing on the grid plane in a dark denim jacket over a white tee, warm key on one side and electric blue rim along the shoulders.',
        rationale:
          'This is the only frame where a viewer decides whether to trust the pitch, and one human beat is what keeps the cut from reading as a science-channel bumper.',
      },
      {
        shot: 'product',
        label: 'Product In The Well',
        instruction:
          'A hand lowers the product onto the center of the grid and releases it; the lines dip and tighten underneath with a yellow underglow.',
        rationale:
          'The grid physically reacts to the product, so the metaphor and the sales point become the same image instead of two ideas glued together.',
      },
      {
        shot: 'detail',
        label: 'Label Under Neon',
        instruction:
          'Track macro across the product\'s label grain and surface texture with electric yellow light raking edge to edge and cyan particles drifting out of focus behind.',
        rationale:
          'Close enough to read the name and judge the finish, which is what a viewer needs settled before being asked to want the thing.',
      },
      {
        shot: 'person',
        label: 'MASS Lands',
        instruction:
          'The creator holds the product at chest height as bold 3D glowing yellow typography reading "MASS" and cyan orbital rings resolve behind, blue rim light holding on the shoulders.',
        rationale:
          'One screenshot-able frame that pairs the person the viewer just met with the object being sold, and lets the concept word land on the beat the ad ends on.',
      },
    ],
  },
  {
    id: 'video-game',
    name: 'Cyberpunk RPG',
    category: 'Gaming',
    badge: 'Popular',
    tagline: 'Anime RPG protagonist in a neon-lit futuristic market with HUD status bar.',
    defaultPrompt:
      'A stylized cyberpunk hero in futuristic tactical armor exploring a bustling night market with glowing neon holographic signs and a game HUD.',
    cameraMotion:
      'Third-person RPG over-the-shoulder camera pan moving into a dynamic portrait angle.',
    lightingAndColor:
      'Vivid magenta, cyan, and neon orange lighting reflections on wet pavement and armored plating.',
    secondaryPhysics:
      'Holographic ad signs flickering, steam rising from ramen stalls, glowing data particles.',
    keywords: ['cyberpunk armor', 'neon night market', 'RPG health bar', 'anime hero', 'futuristic HUD'],
    gradient: 'from-fuchsia-950 via-purple-900 to-cyan-950',
    icon: '🎮',
    presetSteps: [
      {
        shot: 'scene',
        label: 'Neon Alley Establish',
        instruction:
          'Open on an empty rain-slick alley between night-market stalls, vertical neon kanji signs stacked overhead and ramen steam drifting across the frame.',
        rationale:
          'The market has to exist before anyone walks into it, and an empty alley lets the wet asphalt reflections read clearly instead of competing with a crowd.',
      },
      {
        shot: 'detail',
        label: 'HUD Boots Up',
        instruction:
          'Hold on floating holographic HUD elements alone against the neon haze: a minimalist health and stamina bar and a quest marker snapping into place.',
        rationale:
          'The HUD is the promise of this format; showing it boot before any character appears tells the viewer they are watching a game, not someone in a costume.',
      },
      {
        shot: 'person',
        label: 'Protagonist Steps In',
        instruction:
          'Follow the creator from over the shoulder in matte-black tactical armor with glowing blue LED seams, walking deeper into the alley as neon rims the plating.',
        rationale:
          'Over-the-shoulder is how a player actually sees their character, so the human beat lands as gameplay footage rather than a posed portrait.',
      },
      {
        shot: 'product',
        label: 'Counter Pickup',
        instruction:
          'Frame a gloved hand lifting the product off a wet stall counter, magenta and cyan light sliding along its edge as it rises.',
        rationale:
          'This is the shot that does the selling: counter height and a hand reaching in is how a viewer imagines first touching the thing themselves.',
      },
      {
        shot: 'detail',
        label: 'Label Under Neon',
        instruction:
          'Push in macro on the product label, catching the label grain, seams, and beads of rain with a hard cel-shaded highlight tracing the edge.',
        rationale:
          'Neon flattens everything at distance, so macro is the only place the label is legible and the finish reads as a real object under stylized light.',
      },
      {
        shot: 'person',
        label: 'Hero Portrait Beat',
        instruction:
          'Cut to a low dynamic portrait angle of the armored creator holding the item at chest height while the HUD stat bar spikes beside them.',
        rationale:
          'One clear look at a face gives the cut its personality, and tying it to the stat spike makes the item feel like it changed something.',
      },
      {
        shot: 'product',
        label: 'Item Acquired Card',
        instruction:
          'End on the product alone on the stall counter inside a glowing pickup ring, a HUD readout reading ITEM ACQUIRED pinned beside it and steam crossing behind.',
        rationale:
          'Treating the product as loot is the frame people screenshot, and it has to be the item in that frame rather than a person holding it.',
      },
    ],
  },
  {
    id: 'meme-me',
    name: 'Meme Me (Office Humor)',
    category: 'Social UGC',
    badge: 'Viral',
    tagline: 'Relatable workplace humor, sipping coffee cup with viral social media comedic timing.',
    defaultPrompt:
      'A relatable office creator sitting at a modern desk with a laptop, calmly sipping a white coffee mug with an amused, deadpan reaction expression.',
    cameraMotion:
      'Slow humorous push-in zoom on the creator’s reaction face with subtle handheld phone shake.',
    lightingAndColor:
      'Clean modern corporate office lighting, warm cozy knit sweater, bright natural window daylight.',
    secondaryPhysics:
      'Gentle steam rising from the coffee mug, office coworkers moving softly in the out-of-focus background.',
    keywords: ['office meme', 'sipping coffee', 'deadpan reaction', 'relatable humor', 'laptop desk'],
    gradient: 'from-amber-800 via-stone-800 to-zinc-900',
    icon: '☕',
    presetSteps: [
      {
        shot: 'scene',
        label: 'Open-Plan Morning',
        instruction:
          'Open wide on a quiet modern office just after nine — wooden desks, low cubicle dividers, a potted plant, sun coming flat through a tall window.',
        rationale:
          'Everyone who has worked in one of these rooms recognises it inside half a second, and that recognition is what makes the joke land later as \'us\' rather than \'them\'.',
      },
      {
        shot: 'detail',
        label: 'Notification Pile-Up',
        instruction:
          'Macro on the laptop screen: unread badges climbing, a calendar stacked with back-to-back blocks, the cursor sitting motionless.',
        rationale:
          'The premise has to be readable with the sound off, and a screen full of unread counts says \'today is already gone\' faster than any line of dialogue could.',
      },
      {
        shot: 'person',
        label: 'Unbothered At The Desk',
        instruction:
          'Shoot wide from across the room — the creator in a cream knit sweater seated at the desk, typing steadily, the rest of the office falling soft.',
        rationale:
          'A single wide is all it takes to attach a human to that desk; spending the close-up on exposition would waste the one frame that has to do comedic work.',
      },
      {
        shot: 'product',
        label: 'Mug Off The Desk',
        instruction:
          'Desk-height shot of a hand closing around a white ceramic mug and lifting it up out of frame, keyboard and a curled sticky note in the foreground.',
        rationale:
          'This is the wind-up. Cutting away to hands buys the half-second of anticipation that makes the next shot read as a punchline instead of a portrait.',
      },
      {
        shot: 'person',
        label: 'The Deadpan Sip',
        instruction:
          'Close on the creator sipping from the white mug held in both hands, eyes sliding sideways, face completely flat.',
        rationale:
          'This is the frame people screenshot and repost, and it is the only close-up in the cut, so it arrives fresh rather than as the fifth version of the same face.',
      },
      {
        shot: 'detail',
        label: 'Steam Over The Rim',
        instruction:
          'Macro on the mug rim with steam curling off the surface, held still, nothing else in the frame moving.',
        rationale:
          'Comedy needs dead air. A silent beat on the steam is the editing equivalent of refusing to explain the joke, which is exactly why the format goes viral.',
      },
      {
        shot: 'product',
        label: 'Mug Down, Caption Space',
        instruction:
          'Mug set back down on the desk beside the laptop, the unread count visibly higher than before, the wall above the desk left clean and empty.',
        rationale:
          'Ending on the running gag quietly getting worse gives the viewer the second laugh, and the bare wall leaves somewhere for the text overlay to live.',
      },
    ],
  },
];



/*
 * Ad formats — what the ad DOES, not where it is set.
 *
 * The ten templates above are one idea in ten costumes: put the creator in an
 * outfit, in a striking location. Astronaut, detective, cyberpunk, ancient
 * Rome. They differ in wardrobe and set, and their plans are consequently the
 * same shape — establish a place, dress the person, light it, crop it.
 *
 * None of them is an advert. This product exists to make UGC ads, and the
 * thing that separates one UGC ad from another is not the costume, it is the
 * STRUCTURE: an unboxing is paced differently from a before-and-after, which is
 * framed differently from a testimonial. Those differences live in the
 * choreography, which is exactly what presetSteps carries — so these templates
 * differ where it matters instead of in their adjectives.
 *
 * Every one of them puts a real product in a real room, because that is the ad
 * a creator is actually being paid to make.
 */
export const AD_FORMAT_TEMPLATES: CreativeTemplate[] = [
  {
    id: 'unboxing',
    name: 'Unboxing',
    category: 'Ad format',
    badge: 'Popular',
    tagline: 'Hands, packaging, and the first look at what is inside.',
    defaultPrompt:
      'A creator at a table opening the product packaging for the first time, hands and box in frame, reacting to what is inside.',
    cameraMotion: 'Locked-off overhead-to-eye-level, close on the hands, the product held up to the lens at the end.',
    lightingAndColor: 'Soft daylight from one side, clean neutral white balance, the product brighter than the background.',
    secondaryPhysics: 'Packaging creases and flexes, tissue paper shifts, a slight wobble as the product is lifted.',
    keywords: ['hands in frame', 'packaging', 'first look', 'product to camera', 'tabletop'],
    gradient: 'from-amber-100 via-orange-50 to-white',
    icon: '📦',
    presetSteps: [
      {
        shot: 'scene',
        label: 'Sealed box, waiting',
        instruction:
          'Frame a sealed shipping box on a clean table in soft side daylight, tape intact, nobody in the shot.',
        rationale:
          'A reveal only pays off if the viewer first saw the thing shut.',
      },
      {
        shot: 'product',
        label: 'Cutting the tape',
        instruction:
          'Shoot close over the box as a hand runs a blade along the seam and the flaps spring loose.',
        rationale:
          'The seal breaking is the moment a scroller stops, because it promises something is about to be shown.',
      },
      {
        shot: 'detail',
        label: 'Tissue parting',
        instruction:
          'Go macro on tissue paper folding back inside the box, with the embossed pattern on the inner lid catching light at the edge of frame.',
        rationale:
          'Packaging texture is how a cheap product and an expensive one tell themselves apart on camera.',
      },
      {
        shot: 'person',
        label: 'First look',
        instruction:
          'Cut to the person looking down into the open box, caught mid-reaction, box edge running across the bottom of frame.',
        rationale:
          'One honest face is what separates a recommendation from a product demo.',
      },
      {
        shot: 'product',
        label: 'Lifted out',
        instruction:
          'Show the product raised out of the box in one hand and turned toward the lens at chest height, packaging soft behind it.',
        rationale:
          'Everything so far has only implied the product; this is the frame someone would screenshot.',
      },
      {
        shot: 'detail',
        label: 'Label, sharp',
        instruction:
          'Fill the frame with the product label, its surface grain and edge crisp, steadied by fingertips at the edge.',
        rationale:
          'Nobody goes looking for a product whose name they could not read.',
      },
    ],
  },
  {
    id: 'before-after',
    name: 'Before and after',
    category: 'Ad format',
    tagline: 'The same person, the same framing, two different days.',
    defaultPrompt:
      'A creator showing the change the product made, using identical framing and lighting so only the result differs.',
    cameraMotion: 'Static, identical framing across both states — the whole point is that nothing else moves.',
    lightingAndColor: 'Flat, even, repeatable light. No mood, no flattering rim — a claim is only believable if nothing else changed.',
    secondaryPhysics: 'Nothing incidental. Any change in background or clothing undermines what is being demonstrated.',
    keywords: ['same framing', 'consistent light', 'visible change', 'held up to camera'],
    gradient: 'from-sky-100 via-slate-50 to-white',
    icon: '↔️',
    presetSteps: [
      {
        shot: 'scene',
        label: 'The fixed frame',
        instruction:
          'Frame an empty plain wall in flat even light with a strip of tape on the floor marking where to stand.',
        rationale:
          'An empty set with a mark on it says the two takes are the same take, and it says it before anyone is in frame to be doubted.',
      },
      {
        shot: 'detail',
        label: 'Before, up close',
        instruction:
          'Fill the frame with a macro of the starting condition — dull, uneven, untreated — under the same flat unforgiving light.',
        rationale:
          'A comparison is only worth watching if the starting state is bad enough to see. Macro makes it a fact rather than a claim.',
      },
      {
        shot: 'person',
        label: 'Before, on the mark',
        instruction:
          'Place the person on the tape mark against the plain wall, squared to the lens in flat even light, showing the starting state plainly.',
        rationale:
          'This is the control frame. Everything after it is judged against this crop, so it has to be unflattering and reproducible rather than good.',
      },
      {
        shot: 'product',
        label: 'What changed it',
        instruction:
          'Stand the product on the mark in the same flat light, steadied upright by one hand, label square to the lens and sharp.',
        rationale:
          'Somewhere in the middle a viewer asks what did this. This is the one frame that answers it, and the only one where the product itself has to be seen up close.',
      },
      {
        shot: 'detail',
        label: 'Working it in',
        instruction:
          'Go macro on the product being applied — a hand moving it across the surface, the texture visibly changing under it.',
        rationale:
          'Without a visible cause, before and after is two photographs and an assertion. This is the frame that connects them.',
      },
      {
        shot: 'person',
        label: 'After, same frame',
        instruction:
          'Return the person to the mark in the identical crop and the identical flat light, now showing the improved state.',
        rationale:
          'The change has to survive being shown at the same size, angle and light as the complaint. Any drift here reads as a trick.',
      },
      {
        shot: 'detail',
        label: 'After, up close',
        instruction:
          'Repeat the macro at the exact distance and angle of the earlier close-up, now on the treated surface.',
        rationale:
          'Cut against the second shot it becomes an A/B the viewer can check without being told what to conclude, which is the only kind of proof this format has.',
      },
    ],
  },
  {
    id: 'testimonial',
    name: 'Talking to camera',
    category: 'Ad format',
    badge: 'Converts',
    tagline: 'One person, one honest recommendation, straight down the lens.',
    defaultPrompt:
      'A creator talking directly to camera about the product, at home, holding it casually, like telling a friend.',
    cameraMotion: 'Handheld at arm\'s length, tiny natural drift, holding a close medium shot the whole way.',
    lightingAndColor: 'Window light on the face, warm and soft. A real room behind them, slightly out of focus.',
    secondaryPhysics: 'Natural breathing movement, hair settling, small hand gestures around the product.',
    keywords: ['direct eye contact', 'at home', 'handheld', 'casual', 'holding the product'],
    gradient: 'from-rose-50 via-amber-50 to-white',
    icon: '💬',
    presetSteps: [
      {
        shot: 'scene',
        label: 'The room, empty',
        instruction:
          'Show a lived-in room in soft window light — a rumpled sofa, a mug left on the table — with the product sitting where it is actually kept.',
        rationale:
          'Before anyone speaks the room has to prove this is a home and not a rented studio, and the clutter is what proves it.',
      },
      {
        shot: 'product',
        label: 'Picked up',
        instruction:
          'Frame a hand reaching in and lifting the product off the surface in one unhurried grip, the room soft behind it.',
        rationale:
          'An object picked up out of habit reads as owned; an object handed in from off-camera reads as supplied.',
      },
      {
        shot: 'person',
        label: 'Straight down the lens',
        instruction:
          'Handheld close medium shot of the person mid-sentence, eyes into the lens, the product resting loosely in one hand at chest height.',
        rationale:
          'Direct address is the whole mechanism here — everything before it was setup for the second someone looks up and talks to the viewer.',
      },
      {
        shot: 'detail',
        label: 'Label, close',
        instruction:
          'Macro on the front of the product: surface grain and finish sharp, everything behind it thrown out of focus.',
        rationale:
          'Spoken claims get discounted, and a viewer who cannot read the name has nothing to go searching for afterwards.',
      },
      {
        shot: 'product',
        label: 'In use, hands only',
        instruction:
          'Show hands opening, applying, or working the product, cropped tight enough that only forearms and the product are in shot, same room and light.',
        rationale:
          'The gap between owning something and actually using it is where testimonials lose people; the ordinary motion closes it without a word.',
      },
      {
        shot: 'person',
        label: 'The last word',
        instruction:
          'Return to the person slightly closer than before, warmer light, a small settled smile as the sentence finishes.',
        rationale:
          'Cutting back to a face after three shots of the object is what makes the object feel vouched for, and the settled expression is what outlasts the pitch.',
      },
    ],
  },
  {
    id: 'problem-solution',
    name: 'Problem, then fix',
    category: 'Ad format',
    tagline: 'Show the annoyance first. That is what earns the two seconds.',
    defaultPrompt:
      'A creator visibly dealing with the everyday problem the product solves, then solving it with the product.',
    cameraMotion: 'Handheld and slightly restless during the problem, settling to steady once it is solved.',
    lightingAndColor: 'Duller and cooler at the start, warming as it resolves — the light does the argument.',
    secondaryPhysics: 'Visible frustration in the hands and shoulders early; loosened posture at the end.',
    keywords: ['relatable problem', 'frustration', 'the fix', 'relief', 'everyday'],
    gradient: 'from-slate-200 via-slate-50 to-amber-50',
    icon: '🔧',
    presetSteps: [
      {
        shot: 'scene',
        label: 'Before the fix',
        instruction:
          'Show the room in the middle of the problem — the pile, the mess, the thing not working — in cool flat light.',
        rationale:
          'A viewer recognises a room in this state faster than they recognise a stranger, and recognition is what buys the next two seconds.',
      },
      {
        shot: 'detail',
        label: 'What\'s going wrong',
        instruction:
          'Go macro on the exact failure point: the snag, the leak, the smear, the jam, held sharp and filling the frame.',
        rationale:
          'A vague complaint gets scrolled past; a problem the eye can locate feels like one worth paying to remove.',
      },
      {
        shot: 'person',
        label: 'The frustration',
        instruction:
          'Cut to the person mid-annoyance, shoulders tight and hands still working at it, in the same cool flat light.',
        rationale:
          'One human beat is what turns a broken object into an inconvenienced day, which is the thing the ad is actually arguing against.',
      },
      {
        shot: 'product',
        label: 'Product arrives',
        instruction:
          'A hand brings the product into the frame over the trouble spot, gripped ready to use rather than held up for display.',
        rationale:
          'The turn lands harder when the product enters the same physical space the problem has been living in.',
      },
      {
        shot: 'detail',
        label: 'It works',
        instruction:
          'Macro on the moment the problem gives way — the snag releasing, the surface clearing, the mechanism catching.',
        rationale:
          'This is the one frame that has to be believed; if it reads as a claim rather than a result, nothing else in the cut matters.',
      },
      {
        shot: 'scene',
        label: 'The room after',
        instruction:
          'Return to the opening angle with the problem gone and the light noticeably warmer and softer.',
        rationale:
          'Matching the first shot lets the viewer run the comparison themselves, which is more convincing than being told there was an improvement.',
      },
      {
        shot: 'person',
        label: 'Easy again',
        instruction:
          'Finish on the person looking to camera, posture loose, the product resting in one hand.',
        rationale:
          'The look to camera is the handoff that turns a demonstration into a personal recommendation.',
      },
    ],
  },
  {
    id: 'grwm',
    name: 'Get ready with me',
    category: 'Ad format',
    tagline: 'The product inside a routine, not interrupting one.',
    defaultPrompt:
      'A creator working the product into their morning routine at a mirror, talking as they go.',
    cameraMotion: 'Phone propped at the mirror, mostly static, the person moving in and out of frame naturally.',
    lightingAndColor: 'Bright bathroom or bedroom light, clean and slightly cool, no mood lighting.',
    secondaryPhysics: 'Steam, running water, hair being moved, objects picked up and put back down.',
    keywords: ['mirror', 'morning routine', 'in the middle of things', 'propped phone'],
    gradient: 'from-cyan-50 via-white to-rose-50',
    icon: '🪞',
    presetSteps: [
      {
        shot: 'scene',
        label: 'Counter before anyone',
        instruction:
          'Show a bathroom counter in morning light with a phone propped against the mirror, the glass fogged at one edge and half-used bottles crowding the sink.',
        rationale:
          'A leaned phone and a cluttered sink date-stamp the footage as somebody\'s real morning, so nothing later has to argue that it is one.',
      },
      {
        shot: 'product',
        label: 'One of the lineup',
        instruction:
          'Frame the product standing among the other bottles on the counter, lit no better and placed no more centrally than they are.',
        rationale:
          'A product photographed level with the ones already trusted borrows their credibility; a hero shot would give that away for nothing.',
      },
      {
        shot: 'person',
        label: 'Already mid-routine',
        instruction:
          'Put the person at the mirror part-way through the routine, hair pushed back, talking toward the propped phone while reaching across the counter.',
        rationale:
          'Arriving after the routine has started skips the introduction a scroller swipes past.',
      },
      {
        shot: 'product',
        label: 'Next thing to hand',
        instruction:
          'Cut close to a hand lifting the product off the damp counter and turning the cap open, framed from the chest down.',
        rationale:
          'The reach is the whole claim of this format — not that the product is best, but that it is the next thing you would already be picking up.',
      },
      {
        shot: 'detail',
        label: 'Texture up close',
        instruction:
          'Hold macro on what comes out of the product — a pump releasing, cream or liquid pooling on the back of a hand, catching the cool bathroom light.',
        rationale:
          'Texture is what people actually decide on, and you cannot judge it from across a bathroom.',
      },
      {
        shot: 'person',
        label: 'Working it in',
        instruction:
          'Frame the person applying the product at the mirror, hands clearly in shot, still talking through it.',
        rationale:
          'Someone speaking while their hands are busy sounds like a person thinking out loud instead of reading a script.',
      },
      {
        shot: 'scene',
        label: 'Back in the lineup',
        instruction:
          'End on the counter with the product capped and set back among the others, mirror still fogged, phone still propped, no one in frame.',
        rationale:
          'A closing shot that matches the opening one implies the product was there before the camera was and will be there tomorrow.',
      },
    ],
  },
  {
    id: 'demo',
    name: 'How it works',
    category: 'Ad format',
    tagline: 'The mechanism, shown close enough to believe.',
    defaultPrompt:
      'A creator demonstrating exactly how the product works, close on the hands and the mechanism.',
    cameraMotion: 'Alternating between the hands and the face — close for the mechanism, back for the reaction.',
    lightingAndColor: 'Bright and even with a clean key on the product itself; nothing dramatic competing with the detail.',
    secondaryPhysics: 'Moving parts, texture, pouring or spreading — whatever the product actually does.',
    keywords: ['close on hands', 'mechanism', 'texture', 'demonstration', 'detail'],
    gradient: 'from-emerald-50 via-white to-slate-50',
    icon: '🔍',
    presetSteps: [
      {
        shot: 'scene',
        label: 'Bare work surface',
        instruction:
          'Show a clean, evenly lit table with the product sitting closed at the centre and nothing else on it.',
        rationale:
          'An empty table means nothing is staged just out of frame, and a demo is only worth watching if the setup looks unrigged.',
      },
      {
        shot: 'product',
        label: 'Held in one hand',
        instruction:
          'Frame the product held in one hand just above the surface, working end turned toward the lens.',
        rationale:
          'Nobody can judge how big a thing is until a hand is next to it, and size is the first question anyone has.',
      },
      {
        shot: 'detail',
        label: 'The mechanism',
        instruction:
          'Go macro on the moving part — the hinge, pump, blade or seam — caught mid-travel.',
        rationale:
          'Watching the part actually move is what separates a claim from evidence.',
      },
      {
        shot: 'person',
        label: 'Working it',
        instruction:
          'Pull back to the person at the surface, both hands on the product, eyes down on what they are doing.',
        rationale:
          'Effort shows in the shoulders and the grip — that it takes almost none is a feature you can only prove by showing it.',
      },
      {
        shot: 'detail',
        label: 'What it does',
        instruction:
          'Hold close on the result as it forms — the pour, the cut, the seal, the spread.',
        rationale:
          'A result arriving in real time is much harder to argue with than the same result already finished.',
      },
      {
        shot: 'person',
        label: 'Says it plain',
        instruction:
          'Finish on the person looking to camera, product held up at chest height.',
        rationale:
          'A scroller\'s eye rests longest on the last frame, and a demonstration needs someone willing to sign it.',
      },
    ],
  },
];

/** Ad formats first: they are what this product is for. */
export const ALL_TEMPLATES: CreativeTemplate[] = [...AD_FORMAT_TEMPLATES, ...CREATIVE_TEMPLATES];

export function getTemplateById(id: string): CreativeTemplate | undefined {
  /* ALL_TEMPLATES, not CREATIVE_TEMPLATES. Searching only the scene templates
     would have let a user pick an ad format and the planner silently receive
     nothing — a template that changes the gallery and not the run. */
  return ALL_TEMPLATES.find((t) => t.id === id);
}
