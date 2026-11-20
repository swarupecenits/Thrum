import { hashString } from './random';
import { normalize, tokens } from './text';
import type { Features, Mood, MoodId, Range, Track } from './types';

export type GenreFamily = {
  id: string;
  label: string;
  /** Normalized tag spellings that belong to this family. */
  aliases: string[];
  /** Typical spot on the Mood Map, used when a track has no analysed features. */
  point: { energy: number; valence: number };
  /** Bass-leaning family (counts as bass-heavy without features). */
  bassy: boolean;
};

function fam(
  id: string,
  label: string,
  energy: number,
  valence: number,
  aliases: string[],
  bassy = false,
): GenreFamily {
  return { id, label, aliases: [id, ...aliases], point: { energy, valence }, bassy };
}

export const GENRE_FAMILIES: GenreFamily[] = [
  fam('bollywood', 'Bollywood', 0.55, 0.55, [
    'hindi', 'filmi', 'bollywood music', 'bollywood songs', 'bollywood hits', 'hindi film', 'hindi films',
    'hindi film music', 'hindi film songs', 'hindi songs', 'hindi song', 'hindi music', 'hindi pop', 'indipop',
    'indi pop', 'indian pop', 'bollywood pop', 'bollywood dance', 'bollywood romantic', 'old hindi', 'hindi old',
    'retro bollywood',
  ]),
  fam('punjabi', 'Punjabi', 0.78, 0.68, [
    'bhangra', 'punjabi pop', 'punjabi music', 'punjabi songs', 'punjabi hits', 'punjabi hip hop', 'punjabi rap',
    'punjabi trap', 'punjabi folk', 'desi pop', 'pollywood',
  ], true),
  fam('bengali', 'Bengali', 0.45, 0.5, [
    'bangla', 'bengali songs', 'bangla songs', 'bengali music', 'bangla music', 'rabindra sangeet', 'rabindrasangeet',
    'rabindra sangit', 'tagore songs', 'nazrul geeti', 'nazrul sangeet', 'adhunik', 'bangla rock', 'bangla band',
    'bengali rock', 'bengali film', 'bangla film', 'baul',
  ]),
  fam('assamese', 'Assamese', 0.55, 0.6, ['axomiya', 'asomiya', 'bihu', 'assamese modern', 'goalpariya', 'jollywood']),
  fam('tamil', 'Tamil', 0.62, 0.6, ['kollywood', 'tamil film', 'tamil songs', 'tamil pop']),
  fam('telugu', 'Telugu', 0.65, 0.62, ['telugu film', 'telugu songs']),
  fam('malayalam', 'Malayalam', 0.5, 0.55, ['mollywood', 'malayalam film', 'malayalam songs']),
  fam('kannada', 'Kannada', 0.6, 0.6, ['sandalwood', 'kannada film']),
  fam('marathi', 'Marathi', 0.6, 0.6, ['lavani', 'marathi songs']),
  fam('gujarati', 'Gujarati', 0.7, 0.72, ['garba', 'dandiya']),
  fam('bhojpuri', 'Bhojpuri', 0.8, 0.7, ['bhojpuri songs'], true),
  fam('haryanvi', 'Haryanvi', 0.8, 0.65, ['haryanvi songs'], true),
  fam('sufi', 'Sufi', 0.5, 0.5, ['qawwali', 'qawwalis', 'qawali', 'sufiana', 'sufi rock', 'sufi music', 'coke studio']),
  fam('ghazal', 'Ghazal', 0.25, 0.35, ['ghazals', 'gazal', 'nazm']),
  fam('devotional', 'Devotional', 0.3, 0.55, [
    'bhajan', 'bhajans', 'bhakti', 'aarti', 'arti', 'kirtan', 'kirtans', 'spiritual', 'religious', 'gurbani',
    'shabad', 'mantra', 'mantras', 'chant', 'chants', 'chanting', 'gospel', 'worship', 'christian', 'naat',
    'hamd', 'stotram', 'stotra', 'shloka',
  ]),
  fam('hindustani', 'Hindustani', 0.3, 0.45, [
    'hindustani classical', 'indian classical', 'raga', 'raag', 'ragas', 'thumri', 'khayal', 'dhrupad',
    'semi classical', 'sitar', 'santoor', 'sarod', 'bansuri', 'shehnai',
  ]),
  fam('carnatic', 'Carnatic', 0.35, 0.5, ['carnatic classical', 'carnatic music', 'south indian classical', 'kriti', 'veena']),
  fam('indie', 'Indie', 0.45, 0.5, [
    'indian indie', 'indie pop', 'indie rock', 'indie folk', 'indie hindi', 'hindi indie', 'desi indie',
    'alternative', 'alt', 'alt pop', 'alternative pop', 'bedroom pop', 'dream pop', 'shoegaze', 'singer indie',
  ]),
  fam('lofi', 'Lo-fi', 0.25, 0.45, [
    'lo fi', 'lofi hip hop', 'lo fi hip hop', 'lofi beats', 'lo fi beats', 'lofi chill', 'chillhop', 'chill hop',
    'slowed and reverb', 'slowed reverb', 'slowed', 'lofi flip', 'study beats',
  ]),
  fam('hiphop', 'Hip-hop', 0.7, 0.45, [
    'hip hop', 'rap', 'hip hop rap', 'rap hip hop', 'desi hip hop', 'desi rap', 'hindi rap', 'gully rap', 'trap',
    'gangsta rap', 'drill', 'uk drill', 'grime', 'boom bap', 'underground hip hop', 'conscious hip hop', 'hip hop and rap',
  ], true),
  fam('edm', 'EDM', 0.82, 0.6, [
    'electronic', 'electronica', 'electro', 'house', 'deep house', 'tech house', 'progressive house', 'future house',
    'bass house', 'electro house', 'big room', 'techno', 'trance', 'psytrance', 'dubstep', 'riddim', 'dnb', 'd and b',
    'drum and bass', 'drum n bass', 'jungle', 'phonk', 'drift phonk', 'future bass', 'hardstyle', 'garage',
    'uk garage', 'breakbeat', 'idm', 'electronic dance', 'electronic dance music', 'dance electronic', 'bass music',
    'moombahton', 'edm trap',
  ], true),
  fam('pop', 'Pop', 0.65, 0.68, [
    'pop music', 'top 40', 'dance pop', 'synth pop', 'synthpop', 'electropop', 'electro pop', 'teen pop',
    'pop rock', 'j pop', 'jpop', 'art pop', 'chart',
  ]),
  fam('rock', 'Rock', 0.72, 0.5, [
    'classic rock', 'hard rock', 'soft rock', 'punk', 'punk rock', 'pop punk', 'grunge', 'rock and roll',
    'rock n roll', 'psychedelic rock', 'progressive rock', 'prog rock', 'post rock', 'blues rock', 'emo',
  ]),
  fam('metal', 'Metal', 0.9, 0.3, [
    'heavy metal', 'death metal', 'black metal', 'thrash metal', 'metalcore', 'nu metal', 'djent', 'doom metal',
    'power metal', 'hardcore',
  ]),
  fam('rnb', 'R&B', 0.5, 0.5, [
    'r and b', 'randb', 'rhythm and blues', 'soul', 'neo soul', 'contemporary r and b', 'funk', 'motown', 'alt r and b',
  ]),
  fam('jazz', 'Jazz', 0.4, 0.55, ['smooth jazz', 'jazz fusion', 'bebop', 'swing', 'bossa nova', 'blues']),
  fam('classical', 'Classical', 0.25, 0.45, [
    'western classical', 'orchestral', 'orchestra', 'symphony', 'symphonic', 'baroque', 'opera', 'piano',
    'chamber music', 'neoclassical', 'contemporary classical',
  ]),
  fam('soundtrack', 'Soundtrack', 0.45, 0.45, [
    'score', 'ost', 'original soundtrack', 'film score', 'background score', 'bgm', 'soundtracks',
    'video game music', 'game soundtrack', 'anime', 'musical', 'theme',
  ]),
  fam('acoustic', 'Acoustic', 0.3, 0.5, ['unplugged', 'singer songwriter', 'acoustic pop', 'acoustic cover', 'acoustic covers']),
  fam('ambient', 'Ambient', 0.15, 0.45, [
    'new age', 'meditation', 'relaxing', 'relaxation', 'nature sounds', 'white noise', 'drone', 'chillout',
    'chill out', 'downtempo', 'sleep music', 'healing',
  ]),
  fam('kpop', 'K-pop', 0.75, 0.72, ['k pop', 'korean', 'korean pop', 'k rap']),
  fam('latin', 'Latin', 0.75, 0.72, [
    'reggaeton', 'latin pop', 'latino', 'urbano', 'urbano latino', 'latin trap', 'salsa', 'bachata', 'cumbia',
    'dembow', 'merengue', 'baile funk', 'brazilian funk', 'flamenco',
  ], true),
  fam('reggae', 'Reggae', 0.55, 0.7, ['dancehall', 'dub', 'ska', 'roots reggae'], true),
  fam('afro', 'Afrobeats', 0.72, 0.72, ['afrobeats', 'afrobeat', 'afropop', 'afro pop', 'amapiano', 'afro house', 'afroswing'], true),
  fam('country', 'Country', 0.55, 0.62, ['americana', 'bluegrass', 'country pop']),
  fam('folk', 'Folk', 0.45, 0.55, ['folk rock', 'indian folk', 'rajasthani folk', 'lok geet', 'lokgeet', 'celtic', 'world', 'world music']),
];

const FAMILY_BY_ID = new Map(GENRE_FAMILIES.map((f) => [f.id, f]));

// Tie-break when a tag mentions several families: sound-defining styles beat language families,
// which beat broad styles ("Punjabi Pop" -> punjabi, "Hindi Rap" -> hiphop, "Bollywood Lofi" -> lofi).
const PRIORITY = [
  'lofi', 'sufi', 'ghazal', 'devotional', 'hindustani', 'carnatic', 'punjabi', 'bhojpuri', 'haryanvi', 'metal',
  'hiphop', 'edm', 'kpop', 'latin', 'reggae', 'afro', 'bengali', 'assamese', 'tamil', 'telugu', 'malayalam',
  'kannada', 'marathi', 'gujarati', 'indie', 'bollywood', 'rnb', 'jazz', 'classical', 'soundtrack', 'acoustic',
  'ambient', 'country', 'folk', 'rock', 'pop',
];
// Only used when nothing else matches.
const WEAK_ALIASES: [string, string][] = [
  ['remix', 'edm'],
  ['remixes', 'edm'],
  ['club', 'edm'],
  ['dance', 'edm'],
  ['mashup', 'edm'],
  ['party', 'edm'],
  ['film', 'soundtrack'],
  ['movie', 'soundtrack'],
];

type AliasEntry = { words: string[]; family: string; rank: number };

const EXACT = new Map<string, string>();
const ALIAS_LIST: AliasEntry[] = [];
for (const f of GENRE_FAMILIES) {
  const rank = PRIORITY.indexOf(f.id);
  for (const a of f.aliases) {
    const n = normalize(a);
    const compact = n.replace(/ /g, '');
    if (!EXACT.has(n)) EXACT.set(n, f.id);
    if (!EXACT.has(compact)) EXACT.set(compact, f.id);
    ALIAS_LIST.push({ words: n.split(' '), family: f.id, rank });
    if (compact !== n) ALIAS_LIST.push({ words: [compact], family: f.id, rank });
  }
}
const WEAK = new Map(WEAK_ALIASES);

function containsWords(hay: string[], words: string[]): boolean {
  outer: for (let i = 0; i + words.length <= hay.length; i++) {
    for (let j = 0; j < words.length; j++) if (hay[i + j] !== words[j]) continue outer;
    return true;
  }
  return false;
}

function lookupFamily(n: string, allowWeak: boolean): string | null {
  const exact = EXACT.get(n) ?? EXACT.get(n.replace(/ /g, ''));
  if (exact) return exact;
  const hay = n.split(' ');
  let best: AliasEntry | null = null;
  for (const a of ALIAS_LIST) {
    // Longest alias wins ("desi hip hop" over "desi"), then PRIORITY.
    if (best && (a.words.length < best.words.length || (a.words.length === best.words.length && a.rank >= best.rank))) {
      continue;
    }
    if (containsWords(hay, a.words)) best = a;
  }
  if (best) return best.family;
  if (allowWeak) {
    for (const w of hay) {
      const weak = WEAK.get(w);
      if (weak) return weak;
    }
  }
  return null;
}

const familyCache = new Map<string, string | null>();

/** Maps a messy genre tag ("Bollywood Music", "Hip-Hop/Rap", "lo-fi") to a family id, or null. */
export function genreFamily(genre: string): string | null {
  const n = normalize(genre || '');
  if (!n) return null;
  const cached = familyCache.get(n);
  if (cached !== undefined) return cached;
  const out = lookupFamily(n, true);
  if (familyCache.size > 5000) familyCache.clear();
  familyCache.set(n, out);
  return out;
}

export function genreFamilyInfo(id: string): GenreFamily | undefined {
  return FAMILY_BY_ID.get(id);
}

/** Display label for a family id ("punjabi" -> "Punjabi", "lofi" -> "Lo-fi"). */
export function genreFamilyLabel(id: string): string {
  const f = FAMILY_BY_ID.get(id);
  if (f) return f.label;
  return id ? id.charAt(0).toUpperCase() + id.slice(1) : '';
}

export function isBassyFamily(id: string | null | undefined): boolean {
  return !!id && !!FAMILY_BY_ID.get(id)?.bassy;
}

// Well-known artists, used as a family hint when a track has no usable genre tag.
const ARTIST_FAMILY_LIST: Record<string, string> = {
  bollywood:
    'arijit singh|pritam|shreya ghoshal|ar rahman|a r rahman|sonu nigam|kumar sanu|udit narayan|alka yagnik|' +
    'lata mangeshkar|kishore kumar|mohammed rafi|mohammad rafi|asha bhosle|atif aslam|jubin nautiyal|neha kakkar|' +
    'sunidhi chauhan|shankar mahadevan|vishal and shekhar|vishal shekhar|vishal dadlani|shankar ehsaan loy|' +
    'shankar ehsaan and loy|amit trivedi|mithoon|sachin jigar|sachin and jigar|kk|mohit chauhan|armaan malik|' +
    'darshan raval|sachet tandon|parampara tandon|tulsi kumar|javed ali|sukhwinder singh|shaan|palak muchhal|' +
    'b praak|vishal mishra|ankit tiwari|tanishk bagchi|salim sulaiman|ajay atul|rahat fateh ali khan|shilpa rao|' +
    'lucky ali|r d burman|rd burman|laxmikant pyarelal|nadeem shravan|jatin lalit|anu malik|himesh reshammiya|' +
    'shalmali kholgade|neeti mohan|monali thakur|benny dayal|vishal bhardwaj|shekhar ravjiani|sanjay leela bhansali',
  punjabi:
    'ap dhillon|diljit dosanjh|karan aujla|sidhu moose wala|sidhu moosewala|shubh|guru randhawa|yo yo honey singh|' +
    'honey singh|gurinder gill|shinda kahlon|jassie gill|harrdy sandhu|hardy sandhu|ammy virk|gippy grewal|babbu maan|' +
    'gurdas maan|jazzy b|daler mehndi|jasmine sandhu|nimrat khaira|sunanda sharma|parmish verma|mankirt aulakh|' +
    'garry sandhu|the prophec|arjan dhillon|imran khan|mika singh|amrit maan|r nait|jordan sandhu|tegi pannu|' +
    'intense|ikky|gurlez akhtar|afsana khan|satinder sartaaj',
  bengali:
    'anupam roy|rupam islam|fossils|nachiketa|anjan dutt|lopamudra mitra|iman chakraborty|ishan mitra|arnob|' +
    'chandrabindoo|moheener ghoraguli|cactus|bhoomi|somlata|june banerjee|shilajit|kabir suman|manna dey|' +
    'hemanta mukherjee|hemant kumar|lagnajita chakraborty|anirban bhattacharya|timir biswas',
  assamese: 'zubeen garg|bhupen hazarika|angaraag mahanta|neel akash|priyanka bharali|zublee baruah',
  hiphop:
    'divine|seedhe maut|krsna|raftaar|emiway bantai|mc stan|naezy|prabh deep|ikka|hanumankind|yashraj|' +
    'dino james|kaam bhaari|mc altaf|brodha v|bohemia|travis scott|drake|kendrick lamar|kanye west|j cole|eminem|' +
    '21 savage|lil baby|playboi carti|metro boomin|tyler the creator|asap rocky|nas|jay z|' +
    'tupac|2pac|the notorious big|snoop dogg|dr dre|50 cent|lil wayne|nicki minaj|cardi b|megan thee stallion|' +
    'jack harlow|lil nas x|juice wrld|xxxtentacion|central cee|dave|stormzy',
  indie:
    'prateek kuhad|the local train|anuv jain|when chai met toast|lifafa|peter cat recording co|the yellow diary|' +
    'osho jain|nikhil dsouza|raghav meattle|aditya rikhari|jasleen royal|taba chake|parvaaz|indian ocean|' +
    'thaikkudam bridge|easy wanderlings|kamakshi khanna|sanjeeta bhattacharya|ankur tewari|the ghalib project|' +
    'chaar diwaari|kaavish|bharat chauhan|dhruv visvanath|anumita nadesan|arctic monkeys|tame impala|' +
    'cigarettes after sex|the 1975|hozier|bon iver|mitski|phoebe bridgers|the neighbourhood|glass animals|' +
    'lana del rey|clairo|beabadoobee|rex orange county',
  lofi: 'nujabes|lofi girl|idealism|tomppabeats|jinsang|kupla|mondo loops|chillhop music|potsu|j dilla|bollywood lofi',
  edm:
    'ritviz|nucleya|martin garrix|avicii|david guetta|calvin harris|marshmello|alan walker|the chainsmokers|' +
    'major lazer|dj snake|zedd|kygo|skrillex|diplo|swedish house mafia|tiesto|armin van buuren|alesso|' +
    'porter robinson|odesza|flume|fred again|kshmr|sartek|lost stories|daft punk|deadmau5|illenium|' +
    'rufus du sol|disclosure|peggy gou|john summit|fisher|anyma',
  rnb:
    'the weeknd|sza|frank ocean|daniel caesar|her|khalid|chris brown|usher|beyonce|alicia keys|' +
    'summer walker|brent faiyaz|giveon|jhene aiko|bryson tiller|6lack|john legend',
  pop:
    'dua lipa|taylor swift|ed sheeran|justin bieber|ariana grande|billie eilish|olivia rodrigo|harry styles|' +
    'bruno mars|shawn mendes|selena gomez|katy perry|lady gaga|rihanna|coldplay|maroon 5|one direction|' +
    'charlie puth|sia|doja cat|post malone|lauv|alec benjamin|sabrina carpenter|miley cyrus|camila cabello|' +
    'the kid laroi|benson boone|chappell roan|tate mcrae|halsey|lorde|adele|sam smith|zayn|calum scott',
  rock:
    'imagine dragons|linkin park|the beatles|queen|nirvana|ac dc|guns n roses|pink floyd|foo fighters|' +
    'green day|the rolling stones|led zeppelin|red hot chili peppers|radiohead|oasis|the killers|muse|' +
    'u2|bon jovi|euphoria|strings|junoon',
  metal: 'metallica|bloodywood|iron maiden|slipknot|megadeth|black sabbath|avenged sevenfold|system of a down',
  sufi:
    'nusrat fateh ali khan|abida parveen|kailash kher|sabri brothers|the sabri brothers|wadali brothers|' +
    'kavita seth|harshdeep kaur|zeb and haniya|fareed ayaz|nooran sisters|kailasa',
  ghazal:
    'jagjit singh|ghulam ali|mehdi hassan|pankaj udhas|talat aziz|chitra singh|farida khanum|begum akhtar|' +
    'jagjit singh and chitra singh|talat mahmood',
  devotional: 'anuradha paudwal|gulshan kumar|anup jalota|sharma bandhu|krishna das|hari om sharan',
  hindustani:
    'bhimsen joshi|pandit bhimsen joshi|ravi shankar|zakir hussain|hariprasad chaurasia|shivkumar sharma|' +
    'kaushiki chakraborty|rashid khan|ustad rashid khan|ajoy chakrabarty|kishori amonkar|amjad ali khan',
  carnatic: 'm s subbulakshmi|ms subbulakshmi|bombay jayashri|t m krishna|sudha ragunathan|l subramaniam',
  tamil: 'anirudh ravichander|anirudh|sid sriram|yuvan shankar raja|ilaiyaraaja|harris jayaraj|g v prakash kumar|d imman|santhosh narayanan',
  telugu: 'devi sri prasad|thaman s|s s thaman|m m keeravani|mm keeravani',
  malayalam: 'sushin shyam|vineeth sreenivasan|k s chithra',
  kpop: 'bts|blackpink|twice|stray kids|newjeans|seventeen|exo|red velvet|jungkook|jimin|aespa|le sserafim',
  latin: 'bad bunny|j balvin|daddy yankee|shakira|karol g|ozuna|maluma|rauw alejandro|luis fonsi|peso pluma',
  afro: 'burna boy|wizkid|rema|tems|davido|ckay|asake',
  country: 'morgan wallen|luke combs|johnny cash|dolly parton|zach bryan|kacey musgraves',
  reggae: 'bob marley|bob marley and the wailers|sean paul|shaggy',
  ambient: 'brian eno|marconi union|stars of the lid',
  classical:
    'ludwig van beethoven|beethoven|mozart|wolfgang amadeus mozart|bach|johann sebastian bach|chopin|' +
    'frederic chopin|ludovico einaudi|yiruma|max richter|vivaldi|antonio vivaldi|tchaikovsky|debussy|claude debussy',
  soundtrack: 'hans zimmer|john williams|ennio morricone|ludwig goransson|joe hisaishi|ramin djawadi',
  jazz: 'miles davis|john coltrane|norah jones|louis armstrong|frank sinatra|ella fitzgerald|nina simone|chet baker|michael buble',
};

const ARTIST_FAMILY = new Map<string, string>();
for (const [family, names] of Object.entries(ARTIST_FAMILY_LIST)) {
  for (const name of names.split('|')) if (!ARTIST_FAMILY.has(name)) ARTIST_FAMILY.set(name, family);
}

/** Family hint for a well-known artist name, or null. */
export function artistFamily(name: string): string | null {
  return ARTIST_FAMILY.get(normalize(name)) ?? null;
}

const folderCache = new Map<string, string | null>();

function folderFamily(folder: string): string | null {
  const cached = folderCache.get(folder);
  if (cached !== undefined) return cached;
  let out: string | null = null;
  const parts = folder.split('/').filter(Boolean);
  for (let i = parts.length - 1; i >= 0 && !out; i--) {
    const n = normalize(parts[i]);
    if (n) out = lookupFamily(n, false);
  }
  if (folderCache.size > 2000) folderCache.clear();
  folderCache.set(folder, out);
  return out;
}

const candidateCache = new WeakMap<Track, string[]>();

/**
 * Families a track may belong to. A genre tag is authoritative; otherwise the folder ("Music/Punjabi/")
 * and well-known credited artists are used as hints, in that order.
 */
export function familyCandidates(t: Track): string[] {
  const cached = candidateCache.get(t);
  if (cached) return cached;
  const tag = genreFamily(t.genre);
  let out: string[];
  if (tag) out = [tag];
  else {
    out = [];
    const fromFolder = folderFamily(t.folder || '');
    if (fromFolder) out.push(fromFolder);
    for (const a of t.artists) {
      const f = artistFamily(a);
      if (f && !out.includes(f)) out.push(f);
    }
  }
  candidateCache.set(t, out);
  return out;
}

/** Best-guess family for a track (genre tag, else folder, else artist), or null. */
export function trackFamily(t: Track): string | null {
  return familyCandidates(t)[0] ?? null;
}
const r = (lo: number, hi: number): Range => [lo, hi];

export const MOODS: Mood[] = [
  {
    id: 'chill',
    label: 'Chill',
    blurb: 'Easy grooves, zero pressure',
    color: '#1D6F7A',
    color2: '#0F2F45',
    target: { energy: r(0.15, 0.5), valence: r(0.3, 0.75), bpm: r(70, 110) },
    genres: ['lofi', 'indie', 'ambient', 'acoustic', 'rnb', 'jazz'],
    keywords: ['lofi', 'lo fi', 'chill', 'chillout', 'slowed', 'reverb', 'slowed and reverb', 'mellow', 'sukoon', 'chillhop', 'breeze', 'relax'],
    synonyms: ['chill', 'chilled', 'chilling', 'relax', 'relaxing', 'relaxed', 'sukoon', 'calm', 'mellow', 'easy', 'laid back', 'laidback', 'unwind', 'cozy', 'cosy', 'peaceful', 'lazy', 'breezy', 'chill out', 'chillout'],
  },
  {
    id: 'energetic',
    label: 'Energetic',
    blurb: 'Turn it up, keep it moving',
    color: '#C2410C',
    color2: '#7C2D12',
    target: { energy: r(0.7, 1), bpm: r(115, 180), danceability: r(0.5, 1) },
    genres: ['edm', 'punjabi', 'rock', 'hiphop', 'haryanvi', 'bhojpuri', 'metal', 'pop'],
    keywords: ['power', 'fire', 'jump', 'rage', 'wild', 'beast', 'dhamaka', 'josh', 'thunder', 'electric'],
    synonyms: ['energetic', 'energy', 'hype', 'hyped', 'high energy', 'fire', 'power', 'powerful', 'josh', 'junoon', 'adrenaline', 'full power', 'banger', 'bangers', 'lit'],
  },
  {
    id: 'happy',
    label: 'Happy',
    blurb: 'Sunshine in your ears',
    color: '#B7791F',
    color2: '#744210',
    target: { valence: r(0.62, 1), energy: r(0.45, 0.9) },
    genres: ['pop', 'punjabi', 'kpop', 'latin', 'bollywood', 'country', 'reggae', 'afro'],
    keywords: ['happy', 'khushi', 'sunshine', 'smile', 'good vibes', 'celebration', 'badhai', 'mubarak', 'good time', 'good times', 'sunny'],
    synonyms: ['happy', 'khush', 'khushi', 'cheerful', 'joyful', 'joy', 'feel good', 'feelgood', 'uplifting', 'sunny', 'sunshine', 'positive', 'fun', 'good mood', 'good vibes', 'mast'],
  },
  {
    id: 'sad',
    label: 'Sad',
    blurb: "For the feelings you can't text",
    color: '#3B4A7A',
    color2: '#1B2240',
    target: { valence: r(0, 0.35), energy: r(0, 0.5), bpm: r(60, 105) },
    genres: ['ghazal', 'acoustic', 'indie', 'sufi', 'bollywood'],
    keywords: [
      'dard', 'judaai', 'judai', 'tanha', 'tanhai', 'bewafa', 'broken', 'heartbreak', 'sad', 'alvida', 'aansu', 'akela',
      'tears', 'cry', 'crying', 'lonely', 'hurt', 'goodbye', 'bichhad', 'toota', 'udaas', 'udas', 'virah', 'gham', 'sad version',
    ],
    synonyms: ['sad', 'dard', 'udaas', 'udas', 'broken', 'heartbreak', 'heartbroken', 'breakup', 'break up', 'crying', 'cry', 'lonely', 'emotional', 'melancholy', 'melancholic', 'gham', 'judaai', 'tanha', 'toota', 'dil toota', 'bewafa', 'tearjerker'],
  },
  {
    id: 'romantic',
    label: 'Romantic',
    blurb: 'Pyaar, slow dances, late calls',
    color: '#9F1239',
    color2: '#4C0519',
    target: { valence: r(0.35, 0.75), energy: r(0.2, 0.6), bpm: r(65, 110) },
    genres: ['bollywood', 'rnb', 'bengali', 'acoustic', 'indie', 'ghazal', 'punjabi', 'pop'],
    keywords: [
      'love', 'pyaar', 'pyar', 'ishq', 'mohabbat', 'dil', 'sanam', 'jaan', 'jaanu', 'humsafar', 'hamsafar', 'prem',
      'bhalobasha', 'valobasha', 'romance', 'romantic', 'kiss', 'darling', 'mehboob', 'saajan', 'sajna', 'piya',
      'aashiqui', 'dilbar', 'chahat', 'mahiya', 'soniye', 'heeriye', 'raanjhana', 'jaaneman', 'pehla pyaar',
    ],
    synonyms: ['romantic', 'romance', 'love', 'love songs', 'pyaar', 'pyar', 'ishq', 'mohabbat', 'prem', 'bhalobasha', 'valobasha', 'date night', 'couple', 'aashiqui'],
  },
  {
    id: 'focus',
    label: 'Focus',
    blurb: 'Head down, world muted',
    color: '#2D6A4F',
    color2: '#12352A',
    target: { energy: r(0.15, 0.5), valence: r(0.3, 0.7), bpm: r(70, 120) },
    genres: ['lofi', 'ambient', 'classical', 'hindustani', 'carnatic', 'jazz'],
    keywords: ['focus', 'study', 'deep work', 'concentration', 'instrumental', 'beats', 'piano', 'ambient'],
    synonyms: ['focus', 'focused', 'study', 'studying', 'padhai', 'work', 'working', 'deep', 'deep work', 'concentrate', 'concentration', 'coding', 'code', 'reading', 'productive', 'exam', 'exams'],
  },
  {
    id: 'party',
    label: 'Party',
    blurb: 'Dhol, drops and dance floors',
    color: '#A21CAF',
    color2: '#4A044E',
    target: { danceability: r(0.7, 1), energy: r(0.7, 1), valence: r(0.5, 1), bpm: r(95, 135) },
    genres: ['punjabi', 'edm', 'haryanvi', 'bhojpuri', 'latin', 'hiphop', 'kpop', 'pop', 'afro'],
    keywords: ['party', 'remix', 'dj', 'club', 'dance', 'nach', 'naach', 'nachle', 'bhangra', 'dhol', 'mashup', 'disco', 'shaadi', 'baraat', 'peg', 'daru', 'sharaab', 'botal', 'thumka'],
    synonyms: ['party', 'masti', 'nach', 'naach', 'dance', 'dancing', 'bhangra', 'club', 'clubbing', 'shaadi', 'wedding', 'baraat', 'sangeet', 'dance floor', 'disco', 'festive', 'turn up', 'celebration'],
  },
  {
    id: 'workout',
    label: 'Workout',
    blurb: 'One more rep, one more drop',
    color: '#B91C1C',
    color2: '#5A0F0F',
    target: { energy: r(0.75, 1), bpm: r(120, 180), bass: r(0.55, 1) },
    genres: ['hiphop', 'edm', 'punjabi', 'metal', 'rock', 'haryanvi'],
    keywords: ['workout', 'gym', 'pump', 'beast mode', 'warrior', 'champion', 'fight', 'run', 'stronger', 'unstoppable'],
    synonyms: ['workout', 'work out', 'gym', 'run', 'running', 'jog', 'jogging', 'pump', 'pumped', 'pump up', 'lift', 'lifting', 'cardio', 'exercise', 'training', 'beast mode', 'sweat', 'hiit', 'cycling'],
  },
  {
    id: 'latenight',
    label: 'Late night',
    blurb: 'City lights, low volume',
    color: '#312E81',
    color2: '#140F33',
    target: { energy: r(0.2, 0.55), valence: r(0.15, 0.55), bass: r(0.4, 0.85) },
    genres: ['rnb', 'lofi', 'hiphop', 'indie', 'jazz', 'ambient'],
    keywords: ['raat', 'midnight', 'night', 'nights', 'after hours', 'late night', '3am', '2am', 'moonlight', 'chand', 'chaand', 'neon', 'after dark'],
    synonyms: ['late night', 'latenight', 'midnight', 'night', 'nights', 'raat', 'after hours', 'after dark', '2am', '3am', 'nocturnal', 'night owl'],
  },
  {
    id: 'devotional',
    label: 'Devotional',
    blurb: 'Bhajans, qawwalis, quiet faith',
    color: '#C26A12',
    color2: '#6E2E08',
    target: { energy: r(0.1, 0.5), acousticness: r(0.4, 1) },
    genres: ['devotional', 'sufi', 'hindustani', 'carnatic', 'ghazal'],
    keywords: [
      'bhajan', 'aarti', 'arti', 'bhakti', 'maula', 'khwaja', 'allah', 'mantra', 'krishna', 'shiva', 'shiv', 'hanuman',
      'ganesh', 'ganpati', 'durga', 'waheguru', 'namah', 'radhe', 'govind', 'prabhu', 'bhagwan', 'har har', 'kun faya kun',
      'noor', 'sajda', 'ibadat', 'rehmat', 'karam', 'qalandar', 'chalisa', 'stotram', 'shabad', 'kirtan',
    ],
    synonyms: ['devotional', 'bhakti', 'bhajan', 'bhajans', 'aarti', 'arti', 'kirtan', 'sufi', 'qawwali', 'spiritual', 'prayer', 'pooja', 'puja', 'worship', 'religious', 'god', 'bhagwan', 'mandir', 'gurbani', 'shabad', 'morning prayer'],
  },
  {
    id: 'bass',
    label: 'Bass',
    blurb: 'Feel it in your chest',
    color: '#3F6212',
    color2: '#1A2E05',
    target: { bass: r(0.65, 1), energy: r(0.5, 1) },
    genres: ['hiphop', 'edm', 'punjabi', 'haryanvi', 'bhojpuri', 'latin', 'reggae', 'afro'],
    keywords: ['808', 'bass', 'bass boosted', 'dhol', 'boom', 'thump', 'phonk', 'drop', 'wobble', 'subwoofer'],
    synonyms: ['bass', 'bassy', 'bass heavy', 'heavy bass', 'bass boosted', 'thump', 'thumping', '808', '808s', 'boom', 'subwoofer', 'sub bass', 'low end'],
  },
  {
    id: 'acoustic',
    label: 'Acoustic',
    blurb: 'Strings, voice and nothing else',
    color: '#9A5B34',
    color2: '#4A2A17',
    target: { acousticness: r(0.65, 1), energy: r(0, 0.5) },
    genres: ['acoustic', 'folk', 'indie', 'country', 'ghazal'],
    keywords: ['acoustic', 'unplugged', 'guitar', 'stripped', 'reprise', 'piano version', 'acoustic version', 'cover', 'live session'],
    synonyms: ['acoustic', 'unplugged', 'guitar', 'stripped', 'stripped back', 'raw', 'mtv unplugged'],
  },
  {
    id: 'drive',
    label: 'Drive',
    blurb: 'Windows down, highway on',
    color: '#B4532A',
    color2: '#4B1D3F',
    target: { energy: r(0.5, 0.85), bpm: r(95, 130), valence: r(0.4, 0.85) },
    genres: ['punjabi', 'pop', 'rock', 'edm', 'hiphop', 'indie', 'bollywood'],
    keywords: ['drive', 'driving', 'road', 'highway', 'gaddi', 'gaadi', 'safar', 'musafir', 'ride', 'cruise', 'journey', 'road trip', 'raahi', 'manzil'],
    synonyms: ['drive', 'driving', 'road trip', 'roadtrip', 'highway', 'road', 'cruise', 'cruising', 'car', 'ride', 'long drive', 'travel', 'travelling', 'traveling', 'safar', 'journey', 'commute'],
  },
  {
    id: 'sleep',
    label: 'Sleep',
    blurb: 'Soft landings for tired minds',
    color: '#4C3F7A',
    color2: '#1C1833',
    target: { energy: r(0, 0.25), bpm: r(50, 90) },
    genres: ['ambient', 'lofi', 'classical', 'hindustani', 'acoustic'],
    keywords: ['lori', 'lullaby', 'neend', 'sleep', 'sleeping', 'baarish', 'barish', 'rain', 'sapna', 'sapne', 'dream', 'dreams', 'soja', 'goodnight', 'good night'],
    synonyms: ['sleep', 'sleepy', 'neend', 'lullaby', 'lori', 'rain', 'rainy', 'baarish', 'barish', 'bedtime', 'fall asleep', 'wind down', 'nap', 'dreamy', 'insomnia'],
  },
];

const MOOD_BY_ID = new Map(MOODS.map((m) => [m.id, m]));

export function moodById(id: MoodId): Mood {
  return MOOD_BY_ID.get(id) ?? MOODS[0];
}

export const MOOD_IDS: MoodId[] = MOODS.map((m) => m.id);
const clamp01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x);

// How much the genre/keyword prior counts when features exist: audio features can't hear faith or romance.
const PRIOR_WEIGHT: Record<MoodId, number> = {
  chill: 0.1,
  energetic: 0.1,
  happy: 0.1,
  sad: 0.2,
  romantic: 0.35,
  focus: 0.35,
  party: 0.2,
  workout: 0.1,
  latenight: 0.15,
  devotional: 0.6,
  bass: 0.05,
  acoustic: 0.15,
  drive: 0.2,
  sleep: 0.25,
};

const KEYWORD_PATTERNS = MOODS.map((m) => ({ id: m.id, words: m.keywords.map((k) => ` ${normalize(k)} `) }));
const keywordCache = new WeakMap<Track, Set<MoodId>>();

/** Moods whose keywords appear in the track's title, album or genre ("unplugged", "remix", "lori"). */
export function keywordMoods(t: Track): Set<MoodId> {
  const cached = keywordCache.get(t);
  if (cached) return cached;
  const hay = ` ${tokens(`${t.title} ${t.album} ${t.genre}`).join(' ')} `;
  const out = new Set<MoodId>();
  for (const { id, words } of KEYWORD_PATTERNS) if (words.some((w) => hay.includes(w))) out.add(id);
  keywordCache.set(t, out);
  return out;
}

/** 0..1 evidence for a mood from genre family and keywords alone. */
export function moodPrior(mood: Mood, t: Track): number {
  let p = 0;
  for (const family of familyCandidates(t)) {
    const i = mood.genres.indexOf(family);
    if (i >= 0) p = Math.max(p, Math.max(0.4, 1 - 0.08 * i));
  }
  if (keywordMoods(t).has(mood.id)) p = p > 0 ? Math.min(1, p + 0.3) : 0.75;
  return p;
}

const SIGMA = 0.12;
const BPM_SIGMA = 15;

/** 1 inside the range, gaussian fall-off outside it. */
export function rangeCloseness(v: number, range: Range, sigma = SIGMA): number {
  const d = v < range[0] ? range[0] - v : v > range[1] ? v - range[1] : 0;
  return d === 0 ? 1 : Math.exp(-(d * d) / (2 * sigma * sigma));
}

/** Tempo fit that forgives half/double-time detection; null when the tempo is unknown. */
export function bpmCloseness(f: Features, range: Range): number | null {
  if (!(f.bpm > 0) || f.bpmConfidence < 0.2) return null;
  return Math.max(
    rangeCloseness(f.bpm, range, BPM_SIGMA),
    0.85 * rangeCloseness(f.bpm * 2, range, BPM_SIGMA),
    0.85 * rangeCloseness(f.bpm / 2, range, BPM_SIGMA),
  );
}

const FIT_KEYS = ['energy', 'valence', 'bass', 'acousticness', 'danceability'] as const;

/**
 * Closeness to a mood's target ranges: geometric mean blended with the worst dimension, so one clearly
 * wrong axis (a 100 BPM banger for "sleep") isn't averaged away by the others.
 */
export function featureFit(target: Mood['target'], f: Features): number {
  let logSum = 0;
  let worst = 1;
  let n = 0;
  const add = (c: number): void => {
    logSum += Math.log(Math.max(c, 1e-4));
    if (c < worst) worst = c;
    n++;
  };
  for (const key of FIT_KEYS) {
    const range = target[key];
    const v = f[key];
    if (range && Number.isFinite(v)) add(rangeCloseness(v, range));
  }
  if (target.bpm) {
    const c = bpmCloseness(f, target.bpm);
    if (c !== null) add(c);
  }
  return n ? 0.6 * Math.exp(logSum / n) + 0.4 * worst : 0.5;
}

/** 0..1: feature fit when analysed (blended with priors), otherwise genre/keyword priors capped at 0.6. */
export function moodScore(mood: Mood, track: Track, f: Features | undefined): number {
  const prior = moodPrior(mood, track);
  if (!f) return 0.6 * prior;
  const w = PRIOR_WEIGHT[mood.id] ?? 0.1;
  return clamp01((1 - w) * featureFit(mood.target, f) + w * prior);
}

/** Up to two strongest moods scoring at least 0.5. */
export function classifyMoods(track: Track, f: Features | undefined): MoodId[] {
  const scored: { id: MoodId; s: number; i: number }[] = [];
  MOODS.forEach((m, i) => {
    const s = moodScore(m, track, f);
    if (s >= 0.5) scored.push({ id: m.id, s, i });
  });
  scored.sort((a, b) => b.s - a.s || a.i - b.i);
  return scored.slice(0, 2).map((x) => x.id);
}

function mid(range: Range | undefined, fallback: number): number {
  return range ? (range[0] + range[1]) / 2 : fallback;
}

/** Centre of a mood on the energy/valence plane. */
export function moodCenter(mood: Mood): { energy: number; valence: number } {
  return { energy: mid(mood.target.energy, 0.5), valence: mid(mood.target.valence, 0.5) };
}

/** Estimated Mood Map position from family and keywords, with a little per-track jitter so tracks don't stack. */
export function priorPoint(t: Track): { energy: number; valence: number } {
  const family = trackFamily(t);
  const base = (family && FAMILY_BY_ID.get(family)?.point) || { energy: 0.5, valence: 0.5 };
  let energy = base.energy;
  let valence = base.valence;
  for (const id of keywordMoods(t)) {
    const c = moodCenter(moodById(id));
    energy += (c.energy - energy) * 0.3;
    valence += (c.valence - valence) * 0.3;
  }
  const h = hashString(t.id);
  energy += ((h & 0xffff) / 0xffff - 0.5) * 0.12;
  valence += (((h >>> 16) & 0xffff) / 0xffff - 0.5) * 0.12;
  return { energy: clamp01(energy), valence: clamp01(valence) };
}
