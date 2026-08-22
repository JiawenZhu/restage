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
  presetSteps: {
    label: string;
    instruction: string;
    rationale: string;
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
        label: 'Lunar Surface Base',
        instruction: 'Place the enrolled user on the monochrome lunar crater surface with the brilliant blue Earth in the upper quadrant.',
        rationale: 'Establishes the surreal outer-space setting before introducing the vehicle and tech props.',
      },
      {
        label: 'Electric Rover Cockpit',
        instruction: 'Position a sleek metallic electric blue Tesla rover driving across the lunar dirt at a dynamic three-quarter angle.',
        rationale: 'The vivid vehicle paint creates punchy color contrast against the gray terrain.',
      },
      {
        label: 'Visor & Helmet Detail',
        instruction: 'Place the enrolled user inside the minimalist spacesuit helmet visible through the cockpit glass, holding the steering yoke with a relaxed posture.',
        rationale: 'Personalizes the cosmic scene with the recognizable creator in command.',
      },
      {
        label: 'Low-Gravity Dust Arcs',
        instruction: 'Add crisp, low-gravity parabolic arcs of fine gray lunar dust churning up behind the spinning tires.',
        rationale: 'Communicates forward momentum and reinforces authentic space physics.',
      },
      {
        label: 'Direct Solar High-Key',
        instruction: 'Apply sharp direct solar highlights with jet-black shadows across craters, adding subtle cyan Earth-glow rim light to the visor.',
        rationale: 'Gives the shot high-budget cinematic sci-fi authenticity.',
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
        label: 'Pop-Art Grid Frame',
        instruction: 'Frame the shot within an authentic vintage comic book panel grid with textured paper grain and halftone dot shading.',
        rationale: 'Instantly establishes the graphic novel world and comic aesthetic.',
      },
      {
        label: 'Hero Tracksuit Style',
        instruction: 'Dress the creator in a vibrant retro yellow and teal tracksuit with bold black cel-shaded contour lines.',
        rationale: 'Creates a striking pop-art wardrobe that pops off the page.',
      },
      {
        label: 'Dynamic Power Surge',
        instruction: 'Add a brilliant cyan energy blast radiating from the creator’s outstretched palm with explosive black ink splatters.',
        rationale: 'Injects dynamic superhero action and narrative tension.',
      },
      {
        label: 'Action Speed Lines',
        instruction: 'Draw dramatic radial action speed lines converging on the creator’s determined facial expression.',
        rationale: 'Focuses viewer attention and enhances motion kinetic energy.',
      },
      {
        label: 'Halftone Print Finish',
        instruction: 'Apply a subtle 4-color CMYK misprint offset and authentic vintage comic paper texture across the full composition.',
        rationale: 'Delivers a tactile, collector-grade graphic novel look.',
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
        label: 'Rain-Slicked Alley',
        instruction: 'Build a narrow 1940s urban brick alleyway at night, with glistening wet asphalt reflecting ambient streetlights.',
        rationale: 'Establishes the quintessential detective mystery environment.',
      },
      {
        label: 'Classic Noir Wardrobe',
        instruction: 'Dress the enrolled creator in a tailored dark trench coat with the collar turned up and a classic fedora hat angled low over the brow.',
        rationale: 'Instantly transforms the persona into a timeless noir protagonist.',
      },
      {
        label: 'Glowing Neon Signage',
        instruction: 'Place a vintage illuminated neon ramen shop sign casting sharp glowing reflections onto the wet pavement and brick walls.',
        rationale: 'Creates rich lighting motivation and atmospheric color contrast.',
      },
      {
        label: 'Atmospheric Rain & Steam',
        instruction: 'Add fine vertical rain streaks catching the lamplight, with plumes of soft white steam billowing from a manhole cover.',
        rationale: 'Provides dynamic secondary motion and tactile atmospheric depth.',
      },
      {
        label: 'Chiaroscuro Venetian Lighting',
        instruction: 'Apply dramatic high-contrast film-noir shadows across the creator’s face, leaving one eye sharply lit in the moody shadows.',
        rationale: 'Achieves authentic vintage 35mm Hollywood mystery cinematography.',
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
        label: 'Pastel Symmetrical Room',
        instruction: 'Build a perfectly symmetrical room with powder-blue paneled walls and centered vintage oil paintings in ornate gold frames.',
        rationale: 'Creates the iconic auteur symmetry and curated aesthetic world.',
      },
      {
        label: 'Mustard Cardigan Style',
        instruction: 'Dress the creator in a tailored mustard-yellow knit cardigan with a crisp collared shirt and vintage horn-rimmed glasses.',
        rationale: 'Introduces the signature contrasting color blocking.',
      },
      {
        label: 'Centered Deadpan Posture',
        instruction: 'Position the creator dead-center looking directly into the lens with a calm, deadpan, intellectually curious expression.',
        rationale: 'Delivers the charming quirky humor intrinsic to the indie aesthetic.',
      },
      {
        label: 'Chapter One Title Card',
        instruction: 'Add elegant gold serif title text reading "CHAPTER ONE" centered across the upper third with vintage book typography.',
        rationale: 'Framing device that enriches the narrative storytelling feel.',
      },
      {
        label: 'Warm Analog Film Tone',
        instruction: 'Apply a warm Kodak Portra 400 film grain texture with soft pastel highlights and gentle shadow rolloff.',
        rationale: 'Completes the authentic 35mm indie cinema look.',
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
        label: 'Moving Tram Interior',
        instruction: 'Place the creator holding a smartphone selfie camera inside a sunlit European city tram with window seats.',
        rationale: 'Sets up an authentic, everyday lifestyle creator setting.',
      },
      {
        label: 'Blurring City Backdrop',
        instruction: 'Show colorful pastel city facades, pedestrians, and cyclists panning smoothly past the large glass tram window.',
        rationale: 'Provides dynamic background parallax and motion energy.',
      },
      {
        label: 'Casual Streetwear Style',
        instruction: 'Dress the creator in a relaxed denim jacket over a neutral hoodie, speaking enthusiastically to the phone lens.',
        rationale: 'Reinforces organic UGC relatable creator appeal.',
      },
      {
        label: 'Social Sticker Callout',
        instruction: 'Add a stylish rounded sticker badge with bold font and emoji reading "On the move 🚊" pinned near the window frame.',
        rationale: 'Natively emulates Instagram Stories and TikTok visual grammar.',
      },
      {
        label: 'Authentic Phone Exposure',
        instruction: 'Grade the shot with natural smartphone camera dynamic range, warm sunlight flare, and authentic handheld depth.',
        rationale: 'Ensures the ad looks 100% native and non-commercial.',
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
        label: 'Venice Beach Promenade',
        instruction: 'Place the creator on a wide sandy beachside promenade lined with tall Californian palm trees under a sunny blue sky.',
        rationale: 'Instantly evokes the iconic 90s coastal lifestyle aesthetic.',
      },
      {
        label: '90s Vintage Streetwear',
        instruction: 'Dress the creator in an open unbuttoned denim shirt over a charcoal tee with relaxed-fit chinos and classic sunglasses.',
        rationale: 'Delivers timeless retro fashion appeal.',
      },
      {
        label: 'Walking Tracking Cadence',
        instruction: 'Position the creator in a confident forward-striding pose with a warm relaxed smile engaging with the viewer.',
        rationale: 'Creates an inviting, aspirational creator presence.',
      },
      {
        label: 'Golden Hour Sunlight',
        instruction: 'Cast rich warm amber backlight across the creator’s shoulders and hair, creating a luminous rim light.',
        rationale: 'Elevates visual production quality with cinematic golden hour glow.',
      },
      {
        label: 'Analog Film Texture',
        instruction: 'Apply fine 35mm color film grain, gentle chromatic aberration at the borders, and rich vintage color grading.',
        rationale: 'Completes the authentic 90s film look.',
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
        label: 'Imperial Balcony Vista',
        instruction: 'Construct a grand weathered stone balustrade overlooking a sprawling ancient Roman city with the Colosseum on the horizon.',
        rationale: 'Establishes an awe-inspiring historical scale and cinematic atmosphere.',
      },
      {
        label: 'Commanding Wardrobe',
        instruction: 'Dress the creator in a tailored historical leather tunic with subtle brass buckles and a deep crimson cloak draped over one shoulder.',
        rationale: 'Transforms the creator into an epic historical leader.',
      },
      {
        label: 'Fluttering Red Banners',
        instruction: 'Add ornate imperial flags with gold emblems fluttering dynamically on stone poles flanking the balcony.',
        rationale: 'Introduces strong secondary motion and regal heraldry.',
      },
      {
        label: 'Dramatic Sunset Glare',
        instruction: 'Illuminate the stone cityscape with low-angle golden sunset rays casting long architectural shadows across the forum.',
        rationale: 'Infuses the scene with emotional weight and cinematic grandeur.',
      },
      {
        label: 'Cinematic Film Master',
        instruction: 'Apply rich 70mm cinema film grading with deep contrast, sharp stone textures, and atmospheric haze over the distant hills.',
        rationale: 'Delivers a blockbuster movie-still finish.',
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
        label: 'Spacetime Grid Backdrop',
        instruction: 'Build a curved dark neon grid backdrop representing warped gravitational spacetime under a starry sky.',
        rationale: 'Creates an immediate visual metaphor for high-concept science storytelling.',
      },
      {
        label: 'Modern Presenter Wardrobe',
        instruction: 'Dress the creator in a sleek dark denim jacket with a clean white inner tee, presenting with an energetic, welcoming posture.',
        rationale: 'Balances professional expertise with approachable creator charisma.',
      },
      {
        label: 'Kinetic 3D Typography',
        instruction: 'Render bold 3D glowing yellow typography reading "MASS" floating dynamically in the lower third with clean drop shadows.',
        rationale: 'Provides instant visual anchor and educational clarity.',
      },
      {
        label: 'Orbital Particle Streams',
        instruction: 'Add glowing cyan particle rings orbiting gently around the text and curving along the grid lines.',
        rationale: 'Enriches the shot with lively science-fiction secondary physics.',
      },
      {
        label: 'Tech Keynote Lighting',
        instruction: 'Apply dual-tone studio key lighting: soft warm key on the face with crisp electric blue rim light along the shoulders.',
        rationale: 'Gives the video a premium Apple keynote / Vox explainer production polish.',
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
        label: 'Neon Market Setting',
        instruction: 'Construct a dense futuristic cyberpunk night market filled with glowing vertical neon kanji signs, ramen vendors, and crowded alleys.',
        rationale: 'Builds an immersive, layered gaming environment.',
      },
      {
        label: 'Tactical Armor Wardrobe',
        instruction: 'Outfit the creator in sleek matte-black tactical armor plating with subtle glowing blue LED accents and high collar.',
        rationale: 'Delivers an iconic playable-character protagonist aesthetic.',
      },
      {
        label: 'Holographic HUD Elements',
        instruction: 'Add subtle floating sci-fi HUD elements: a minimalist health/stamina bar and quest indicator pinned in the upper left corner.',
        rationale: 'Directly immerses viewers in an interactive RPG gameplay experience.',
      },
      {
        label: 'Volumetric Neon Lighting',
        instruction: 'Cast vivid magenta and cyan neon rim lighting across the armor edges, with reflections dancing on rain-slicked asphalt.',
        rationale: 'Creates rich color saturation and high-tech contrast.',
      },
      {
        label: 'Anime Cinematic Finish',
        instruction: 'Apply sharp cel-shaded edge highlights, subtle lens bloom on light sources, and crisp 4K game-engine fidelity.',
        rationale: 'Delivers a AAA next-gen video game cinematic quality.',
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
        label: 'Modern Office Workspace',
        instruction: 'Place the creator seated at a clean wooden office desk with a laptop, potted desk plant, and soft background office cubicles.',
        rationale: 'Creates an instantly recognizable and relatable workplace setting.',
      },
      {
        label: 'Cozy Knit Wardrobe',
        instruction: 'Dress the creator in a cozy cream-colored knit sweater, looking relaxed and approachable.',
        rationale: 'Maximizes relatable, authentic everyday creator appeal.',
      },
      {
        label: 'Coffee Sip Reaction',
        instruction: 'Show the creator holding a white ceramic coffee mug with both hands, taking a calm sip while glancing sideways with an amused expression.',
        rationale: 'Captures the classic viral "sipping tea / enjoying the chaos" meme reaction.',
      },
      {
        label: 'Soft Window Ambient Light',
        instruction: 'Illuminate the scene with bright, flattering natural daylight coming from an adjacent office window.',
        rationale: 'Ensures the creator looks fresh, warm, and natural.',
      },
      {
        label: 'Social Viral Grade',
        instruction: 'Apply crisp high-key TikTok/Reels exposure with sharp focus on the creator’s eyes and soft background blur.',
        rationale: 'Optimized for instant engagement on social feeds.',
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
      { label: 'Table and box', instruction: 'Place the person at a clean table with the sealed product box in front of them, hands resting near it.', rationale: 'The box has to be recognisable before it is opened or the reveal lands on nothing.' },
      { label: 'Opening', instruction: 'Move to their hands lifting the lid, packaging visibly in motion.', rationale: 'Hands doing the work is what makes an unboxing feel like a person rather than a product shot.' },
      { label: 'First look', instruction: 'Show their face reacting as they see the contents, product still in the box.', rationale: 'The reaction is the ad; the product is the reason for it.' },
      { label: 'Product up', instruction: 'Have them lift the product out and hold it toward the lens at chest height.', rationale: 'One clear, legible look at the thing being sold.' },
      { label: 'Label legible', instruction: 'Refine so the product label is sharp and readable, with the face still in frame behind it.', rationale: 'A viewer who cannot read the label cannot buy it.' },
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
      { label: 'Before, framed', instruction: 'Place the person against a plain wall in flat even light, facing the camera squarely, showing the starting state.', rationale: 'The framing has to be reproducible, because the comparison depends on it.' },
      { label: 'The product', instruction: 'Add the product held in one hand at chest height, without changing the framing or the light.', rationale: 'Naming what caused the change, without breaking the comparison.' },
      { label: 'Using it', instruction: 'Show them actually applying or using the product, same position, same light.', rationale: 'The middle step is the proof that the two states are connected.' },
      { label: 'After', instruction: 'Show the improved state in the identical framing and lighting as the first frame.', rationale: 'Any drift in angle or light reads as a trick.' },
      { label: 'Hold the result', instruction: 'Refine the final frame so the change is clearly visible and the person looks relaxed and pleased.', rationale: 'The result has to be legible in the first second of a scroll.' },
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
      { label: 'Real room', instruction: 'Place the person in a lived-in room with soft window light, seated or standing close to camera.', rationale: 'A room someone actually lives in is what separates this from an advert shot in a studio.' },
      { label: 'Eye contact', instruction: 'Bring their gaze directly into the lens with a relaxed, mid-sentence expression.', rationale: 'Direct address is the entire mechanism of a testimonial.' },
      { label: 'Product in hand', instruction: 'Add the product held loosely in one hand, near chest height, not presented.', rationale: 'Held casually reads as ownership; held up reads as an advert.' },
      { label: 'Closer', instruction: 'Tighten to a close medium shot so the face fills more of the frame.', rationale: 'Vertical feeds reward faces, and trust is carried in the face.' },
      { label: 'Warmth', instruction: 'Warm the light slightly and soften the shadows so they look rested and approachable.', rationale: 'Somebody you would take a recommendation from.' },
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
      { label: 'The annoyance', instruction: 'Show the person mid-problem, expression and posture conveying the everyday frustration, in cooler flatter light.', rationale: 'A scroll stops on a problem the viewer recognises, not on a product.' },
      { label: 'Close on it', instruction: 'Move closer to the specific thing going wrong, so the problem is unmistakable.', rationale: 'Naming the problem visually beats saying it.' },
      { label: 'Product arrives', instruction: 'Bring the product into frame in their hand as the solution.', rationale: 'The turn should be a moment, not a cut.' },
      { label: 'It works', instruction: 'Show the problem resolved, posture loosened, light warmer.', rationale: 'Relief is the payoff the first frame promised.' },
      { label: 'Look up', instruction: 'Finish with them looking to camera with an easy expression, product still in hand.', rationale: 'The look to camera is what converts a demonstration into a recommendation.' },
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
      { label: 'At the mirror', instruction: 'Place the person at a bathroom or bedroom mirror with the phone propped, mid-routine.', rationale: 'Propped-phone framing signals a routine being documented rather than performed.' },
      { label: 'Routine in motion', instruction: 'Show them part-way through the routine with other products visible on the counter.', rationale: 'A product alone on a counter is an advert; a product among others is a life.' },
      { label: 'Reach for it', instruction: 'Have them pick up the product as the natural next step.', rationale: 'Belonging in the sequence is the whole claim of this format.' },
      { label: 'Using it', instruction: 'Show the product actually being applied or used, hands clearly in frame.', rationale: 'Use is more persuasive than display.' },
      { label: 'Carry on', instruction: 'Return them to the routine, product set back down among the others.', rationale: 'Ending mid-routine implies it was always there.' },
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
      { label: 'Set it up', instruction: 'Place the person at a clear surface with the product in front of them, ready to demonstrate.', rationale: 'A demonstration needs a stage that does not compete with it.' },
      { label: 'Close on hands', instruction: 'Move in close on their hands operating the product, face out of frame or soft behind.', rationale: 'The mechanism is the argument, and it has to be seen to be believed.' },
      { label: 'The moment', instruction: 'Capture the specific moment the product does the thing it is for, in sharp detail.', rationale: 'One frame carries the proof.' },
      { label: 'Back to the face', instruction: 'Pull back to include their face reacting to the result.', rationale: 'A mechanism without a person is a manual, not an ad.' },
      { label: 'Both in frame', instruction: 'Finish with the product and their face both clearly readable in one frame.', rationale: 'The last frame is the one a scroller sees longest.' },
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
