/**
 * What the ants say. Purely cosmetic: picked on the main thread with `Math.random`, never
 * fed back into the (deterministic) sim. Keep lines short — bubbles are a few words wide.
 */

/** A back-and-forth: speakers alternate, starting with the first ant. */
export type Exchange = readonly string[];

/** Two ants of the same colony bump antennae. */
export const SMALL_TALK: readonly Exchange[] = [
  ['Nice weather for lifting 50× my body weight.', 'Every weather is, if you’re us.'],
  ['The queen laid 300 eggs today.', 'Show-off.'],
  ['Where are you going?', 'Following the smell.', '…of what?', 'No idea. That’s the fun part.'],
  ['I think I’m lost.', 'You’re standing on the trail.', 'I’m lost ON the trail.'],
  ['Ever wonder what’s beyond the yard?', 'No. I wonder what’s beyond this crumb.'],
  ['Smell that?', 'Was that you?', 'It’s a pheromone. It’s how we TALK.'],
  ['Tag, you’re it!', 'We’re a superorganism. We’re ALL it.'],
  ['How’s work?', 'Same as yesterday.', 'Living the dream.'],
  ['I lifted a whole seed today!', 'I lifted you earlier. You were napping.'],
  ['Why do we march in a line?', 'Dave did it once. Now it’s tradition.'],
  ['Is it Monday?', 'We don’t have Mondays.', 'Then why do I feel like this?'],
  ['Have you seen my sister?', 'Which one?', 'Fair. There are 4,000.'],
  ['Is this a trail or a queue?', 'Yes.'],
  ['Big news: I found a crumb.', 'How big?', 'Life-changing.'],
  ['Why do we never take breaks?', 'We took one in 1987. Chaos.'],
  ['What’s your name?', 'Worker.', 'Mine too! What are the odds?'],
  ['Left or right?', 'The scent says left.', 'My stomach says crumbs.'],
  ['Union meeting tonight?', 'We ARE the union.'],
  ['Excuse me.', 'Excuse YOU.', '…we’re just touching antennae, it’s fine.'],
  ['Do I have something on my mandible?', 'Half a cookie.', 'Saving it for later.'],
  ['I named a pebble Kevin.', 'That’s nice.', 'Kevin is gone now.'],
  ['Hot take: sugar is good.', 'Bold. Controversial. Correct.'],
  ['What’s the plan?', 'Find food. Bring food. Repeat.', 'Love a simple plan.'],
];

/** Two red ants gossiping. */
export const RED_TALK: readonly Exchange[] = [
  ['The black ones are getting bold.', 'Let them come.', 'Your plan?', 'Run. Dramatically.'],
  ['Red is the colour of victory.', 'And of sunburn.', '…mostly victory.'],
  ['Our queen is the best queen.', 'She’s the only queen we know.', 'Still counts.'],
  ['Spotted a black ant earlier.', 'What was it doing?', 'Being smug, mostly.'],
  ['Do I look fierce?', 'Terrifying.', 'Thanks. I practise in puddles.'],
];

/** A black ant (first) meets a red one. */
export const RIVAL_TALK: readonly Exchange[] = [
  ['Nice crumbs. Shame if they went missing.', 'Try it, inkblot.'],
  ['The lawn doesn’t have sides!', 'It does now!'],
  ['Your queen called. Wants her crumbs back.', '…YOU took those?!'],
  ['You smell weird.', 'We smell FAMOUS.'],
  ['Sunburn, or are you just red?', 'It’s called STYLE.'],
  ['Out of my way, ketchup.', 'Make me, licorice.'],
  ['This is our trail.', 'Then why does it smell like us?', '…'],
  ['Lovely day for a turf war.', 'Every day is, pal.'],
];

/** One ant comments on the player's (yellow) ant as it walks past. */
export const TO_PLAYER = [
  'Ooh, it’s the yellow one!',
  'Who made YOU the boss?',
  'Nice glow. Is that contagious?',
  'Lead the way, chief!',
  'Why do you get to be yellow?',
  'Is that… the chosen one?',
  'Hey, where’s the fire?',
  'I’d follow you anywhere. Along a trail.',
  'Psst. Can I have your autograph?',
  'Act natural, it’s the boss.',
] as const;

/** Answers when the player recruits ants. */
export const RECRUITED = [
  'Right behind you, boss!',
  'Where are we going?',
  'Recruited! I didn’t even apply.',
  'Following! Mostly.',
  'Charge! Wait, which way?',
  'Ooh, a field trip!',
] as const;

/** Solo lines by what the ant is doing. */
export const SOLO = {
  food: [
    'Coming through! Hot crumb!',
    'Delivery for Her Majesty!',
    'Beep beep! Wide load!',
    'Lift with your legs. All six.',
    'Not for me. Never for me.',
    'Who drops a whole cookie?!',
    'Five-second rule? Try five days.',
    'Heavier than it looks.',
    'Dinner’s on me! Literally.',
  ],
  dirt: [
    'Dirt out, dreams in.',
    'Another day, another grain.',
    'I’m basically an architect.',
    'Hole lotta work.',
    'Dig, dig, dig… why are we digging?',
    'This mound won’t build itself.',
    'Who keeps putting dirt in the tunnel?!',
  ],
  wander: [
    'I’m not lost, I’m exploring.',
    'Wait, which way is home?',
    '*sniff sniff* …grass. Again.',
    'Smells like opportunity.',
    'I could do this all day. I will.',
    'Left, left, left… am I in a circle?',
    'Six legs and still no direction.',
    'Ooh, a pebble! …a boring pebble.',
    'Has anyone seen my trail?',
    'Just ant things.',
    'Crumbs, crumbs, where art thou?',
  ],
  fight: [
    'For the queen!',
    'Mandibles up!',
    'Is that all you’ve got?',
    'I trained my whole three weeks for this!',
    'Not the antennae!',
    'Six legs of fury!',
    'Have at you!',
  ],
  soldier: [
    'Stand back, civilians.',
    'My head isn’t big. It’s armoured.',
    'Soldier on!',
    'These mandibles are registered weapons.',
    'Nothing to see here. Move along.',
  ],
  breeder: [
    'One day I’ll fly…',
    'Wings? Just something I threw on.',
    'Saving myself for the mating flight.',
  ],
  red: [
    'Red alert! Wait, that’s just me.',
    'Smells like black ants. Ew.',
    'Seeing red. Always.',
    'Our trails are spicier.',
  ],
  nest: [
    'Watch the ceiling!',
    'Who left eggs in the hallway?',
    'Shh, the larvae are sleeping.',
    'Fresh tunnel smell!',
    'Cosy down here.',
    'The queen’s in a mood today.',
    'Nursery’s full, try next door.',
  ],
} as const;

export type SoloKind = keyof typeof SOLO;

/** Shouted by a nearby ant when something happens. Keys match `SimEvent['type']` (plus a few variants). */
export const EVENT_LINES: Record<string, readonly string[]> = {
  rainWarning: [
    'My antennae say rain.',
    'Is it getting dark or is that a shoe?',
    'Smells like wet.',
  ],
  rainStarted: ['Raindrop the size of a house!', 'Everyone underground!', 'Can we swim?! Can we?!'],
  rainEnded: ['We survived! …did we survive?', 'Is it over?', 'Puddles! I hate puddles.'],
  mowerWarning: ['What’s that rumbling?', 'THE BEAST AWAKENS.', 'Underground! I mean it!'],
  mowerStarted: ['RUN!', 'Not the grass! Not the GRASS!', 'It’s the big spinny death!'],
  mowerEnded: ['Okay, who’s still here?', 'Grass is so short now…', 'Nobody tell the queen.'],
  humansWarning: ['Giant incoming!', 'Nobody move! Wait — everybody move!', 'Is that… a sock?'],
  footstep: ['WHOA, that was close!', 'Rude!', 'Watch where you’re stepping!'],
  spiderKilled: ['We got the spider!', 'Who’s laughing now, eight-legs?', 'Spider sushi tonight!'],
  antlionKilled: ['Pit’s closed, buddy.', 'Not so tough without your hole, huh?'],
  queenKilled: ['The red queen is down!', 'Long live OUR queen!', 'We did it!'],
  playerEaten: ['Oh no, the yellow one!', 'Who’s in charge now?!', 'Not it! Not it!'],
  season: ['New season, same crumbs.', 'Time flies. Not us, though.'],
};
