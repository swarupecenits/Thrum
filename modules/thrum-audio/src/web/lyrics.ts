import { hashString, mulberry32 } from '../../../../src/lib/random';
import type { RawTrack } from '../ThrumAudio.types';

// Demo lyrics written for Thrum's web preview. They are original placeholder verses, not the
// words of the songs they are attached to. '' marks an instrumental break.
const SYNCED: Record<string, string[]> = {
  'Blinding Lights': [
    'Midnight on the ring road, engine running warm',
    'Chrome reflections racing out ahead of the storm',
    'Radio is humming something half-remembered',
    'Every streetlamp flickers like a fading ember',
    '',
    'Hold the wheel and let the city fall behind',
    'Synth line pulling like a thread across my mind',
    'Neon in the puddles, pink and electric blue',
    'Every exit sign is pointing back to you',
    '',
    'Faster now, the tunnel hums in four-four time',
    'Bass inside the doors, a heartbeat out of line',
    'Dashboard glowing green across your sleepy face',
    'We never needed maps to find this kind of place',
    '',
    'Overpass and underpass, the skyline breathes',
    'Static on the dial and fog between the trees',
    'Keep it on repeat until the morning shows',
    'Only the road can tell us where the night goes',
  ],
  Excuses: [
    'Two a.m., the screen is glowing in the room',
    'Your message waiting like a trace of late perfume',
    'Sirens singing softly somewhere far below',
    "Rooftop chai gone cold, but I don't want to go",
    '',
    'Say it slow, the night is ours to run',
    'Every word you type lands like a kick drum',
    'Headlights crawling on the flyover line',
    'I count them one by one till you come back online',
    '',
    'Rain is on the way, the air is turning sweet',
    'Footsteps in the alley keep a lazy beat',
    'Leave the window open, let the thunder in',
    'Tell me where the story ends and where we should begin',
    '',
    'Two a.m., the screen goes dark again',
    'Still I hear your voice inside the rain',
  ],
  'Brown Munde': [
    'Convoy moving out beyond the toll gate',
    'Subwoofers waking up the whole estate',
    'Windows down, the cold air cuts like glass',
    'Tail-lamps drawing red lines as we pass',
    '',
    'Bass so deep it rattles every sign',
    'Five cars deep and every one in line',
    'Petrol pumps and paper cups of tea',
    "The highway's wide awake and so are we",
    '',
    'Turn it up until the speakers glow',
    'Every beat a mile marker on the road',
    'Streetlights strobing in a perfect row',
    'Engines keeping tempo down below',
    '',
    'Dhol inside the drum machine tonight',
    'Horns across the bridge in borrowed light',
    'Ring road, river road and round again',
    'Nobody in this town is sleeping until ten',
    '',
    'Convoy coming home, the sky is turning grey',
    'Bass still ringing at the break of day',
  ],
  Baarishein: [
    'Rain on the bus window, tracing little rivers',
    'Streetlights bending gold in every drop that shivers',
    'Umbrellas blooming outside the corner store',
    'Puddles keeping secrets on the station floor',
    '',
    'Wipers keeping time, a slow and steady sway',
    'The city sounds like velvet on a rainy day',
    'Steam above the chai stall, someone humming low',
    'Thunder rumbling somewhere we will never know',
    '',
    'Hold my hand across the flooded lane',
    'We can laugh about the clouds again',
    'Every gutter sings a different note',
    'Paper boats and promises afloat',
    '',
    'Rain on the bus window, fading into blue',
    'Every drop a little postcard sent to you',
  ],
  Kasoor: [
    'Last train out, the carriage almost bare',
    'Platform lamps are buzzing in the air',
    'Your reflection floating on the glass',
    'Stations blurring as the minutes pass',
    '',
    'Headphones on, the world turned down low',
    'Guitar strings and somewhere soft to go',
    'Every tunnel holds its breath for me',
    'Every bridge a line of melody',
    '',
    'If I fall asleep, just wake me at your stop',
    'We can walk until the streetlamps drop',
    'Hands in pockets, warm against the cold',
    "Little stories that we haven't told",
    '',
    'Last train home, the city hums along',
    'Every lit-up window keeps a song',
  ],
  'Tum Hi Ho (Lofi Flip)': [
    'Tape hiss and a kettle on the stove',
    'Desk lamp glowing on the notes I wrote',
    'Rain outside is slowly writing letters',
    'Every crackle makes the evening better',
    '',
    'Slow it down, the evening has no hurry',
    'Every thought is soft and a little blurry',
    'Kick drum pillowed under velvet keys',
    'Window fogging in the evening breeze',
    '',
    'Half past late, the street is fast asleep',
    'A distant scooter humming soft and deep',
    'Lo-fi heartbeat, steady as the rain',
    'Loop it once and let it start again',
    '',
    'Tape runs out, the kettle whistles low',
    "Stay a little longer, there's nowhere else to go",
  ],
  'Kesariya (Lofi Flip)': [
    'Late sun spilling over water tanks',
    'Kites still drifting over river banks',
    'Pressure cooker whistles, someone tunes a radio',
    'Evening slipping in a little slow',
    '',
    'Warm keys drifting through the open door',
    'Sandals on the stairway, footsteps on the floor',
    'Soft snare brushing like a passing train',
    'Clouds are thinking quietly of rain',
    '',
    'Streetlights waking one by one below',
    'Chai and conversation, taking it slow',
    'Bassline swaying like a hammock in the heat',
    'The whole town breathing to a lazy beat',
    '',
    'Late sun melting into blue',
    'Leave the record spinning, I will stay with you',
  ],
  Faded: [
    'Frost on the windshield, breath against the glass',
    'Empty highway glowing as the snowploughs pass',
    'Pylons humming slowly in the frozen air',
    'Radio is reaching for a signal anywhere',
    '',
    'Hold on, the drop is coming in',
    'Feel the low end shaking underneath the skin',
    'Silver mile markers counting down the night',
    'Headlamps cutting tunnels through the white',
    '',
    'Static on the airwaves, voices on the wire',
    'Keep the heater running, turn the volume higher',
    'Synth pads drifting slowly like the snow',
    'Every streetlamp halo burning soft and low',
    '',
    'Hold on, the drop is coming in',
    'Feel the low end shaking underneath the skin',
    'Frozen city waking in a sodium glow',
    'Bass beneath the bridges where the rivers go',
  ],
};

/** Embedded plain (unsynced) lyrics, to exercise the scroll-only view. */
const PLAIN: Record<string, string[]> = {
  'Alag Aasmaan': [
    'Morning bus is running late again',
    'Shutters rising one by one',
    'Pigeons lined along the power lines',
    'Waiting for the sun',
    '',
    'Paper cups and pencil notes',
    "Songs I haven't finished yet",
    'Every corner of this little town',
    "Is a tune I can't forget",
    '',
    'Walk me to the station',
    'Talk about the weather',
    'Small things, slow things',
    'Hold the day together',
  ],
};

const pad = (n: number): string => String(n).padStart(2, '0');

function stamp(ms: number): string {
  const cs = Math.floor(ms / 10);
  return `${pad(Math.floor(cs / 6000))}:${pad(Math.floor(cs / 100) % 60)}.${pad(cs % 100)}`;
}

/** Spreads the lines over the song: a 8–15 s intro, breaks held longer, the last line ~10 s before the end. */
function toLrc(track: RawTrack, lines: string[]): string {
  const rng = mulberry32(hashString(`lyrics|${track.id}`));
  const start = 8000 + rng() * 7000;
  const end = Math.max(start + lines.length * 1500, track.durationMs - 10_000);
  const gaps = lines.slice(0, -1).map((line) => (line ? 1 : 1.8));
  const total = gaps.reduce((a, b) => a + b, 0) || 1;
  const out = [`[ti:${track.title}]`, `[ar:${track.artist}]`, `[al:${track.album}]`, '[by:Thrum web demo]'];
  let at = start;
  lines.forEach((line, i) => {
    const step = ((end - start) * (gaps[i] ?? 1)) / total;
    const jitter = i > 0 && i < lines.length - 1 ? (rng() - 0.5) * 0.24 * step : 0;
    out.push(`[${stamp(Math.max(0, Math.round(at + jitter)))}]${line ? ` ${line}` : ''}`);
    at += step;
  });
  return out.join('\n');
}

/** LRC text for the demo tracks that have synced lyrics, plain text for a few others, else null. */
export function lyricsFor(track: RawTrack): { text: string; synced: boolean } | null {
  const synced = SYNCED[track.title];
  if (synced) return { text: toLrc(track, synced), synced: true };
  const plain = PLAIN[track.title];
  return plain ? { text: plain.join('\n'), synced: false } : null;
}
