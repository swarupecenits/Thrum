import { contrast, hexToRgb } from '../color';
import { MOODS, classifyMoods, genreFamily, genreFamilyLabel, moodById, moodScore } from '../moods';
import { mulberry32 } from '../random';
import type { MoodId } from '../types';
import { feat, libOf } from './fixtures';

const ALL_MOODS: MoodId[] = [
  'chill', 'energetic', 'happy', 'sad', 'romantic', 'focus', 'party', 'workout',
  'latenight', 'devotional', 'bass', 'acoustic', 'drive', 'sleep',
];

describe('MOODS', () => {
  it('defines every mood once with readable jewel-tone tiles', () => {
    expect(MOODS.map((m) => m.id).sort()).toEqual([...ALL_MOODS].sort());
    for (const m of MOODS) {
      expect(m.label.length).toBeGreaterThan(0);
      expect(m.blurb.length).toBeGreaterThan(0);
      expect(hexToRgb(m.color)).not.toBeNull();
      expect(hexToRgb(m.color2)).not.toBeNull();
      // White tile labels must stay legible on both gradient stops.
      expect(contrast('#FFFFFF', m.color)).toBeGreaterThanOrEqual(3);
      expect(contrast('#FFFFFF', m.color2)).toBeGreaterThanOrEqual(3);
      expect(m.synonyms.length).toBeGreaterThan(0);
    }
    expect(new Set(MOODS.map((m) => m.color)).size).toBe(MOODS.length);
    expect(moodById('latenight')).toMatchObject({ label: 'Late night', blurb: 'City lights, low volume' });
  });

  it.each<[MoodId, string[]]>([
    ['romantic', ['pyaar', 'ishq', 'mohabbat', 'romantic']],
    ['sad', ['dard', 'udaas', 'sad', 'broken', 'heartbreak']],
    ['party', ['masti', 'nach', 'party', 'dance', 'bhangra']],
    ['devotional', ['bhakti', 'bhajan', 'aarti', 'devotional', 'kirtan', 'sufi']],
    ['workout', ['gym', 'workout', 'run', 'pump']],
    ['chill', ['chill', 'relax', 'sukoon', 'calm']],
    ['focus', ['focus', 'study', 'padhai', 'work', 'deep']],
    ['drive', ['drive', 'road trip', 'highway']],
    ['sleep', ['sleep', 'neend', 'lullaby', 'rain']],
    ['bass', ['bass', 'thump', '808', 'boom']],
  ])('%s understands Hinglish and English synonyms', (id, words) => {
    expect(moodById(id).synonyms).toEqual(expect.arrayContaining(words));
  });
});

describe('genreFamily', () => {
  it.each([
    ['Bollywood', 'bollywood'], ['Hindi', 'bollywood'], ['Filmi', 'bollywood'], ['Bollywood Music', 'bollywood'],
    ['Hindi Film', 'bollywood'], ['Bhangra', 'punjabi'], ['Punjabi Pop', 'punjabi'], ['Rabindra Sangeet', 'bengali'],
    ['Bangla', 'bengali'], ['Assamese', 'assamese'], ['Tamil', 'tamil'], ['Telugu', 'telugu'],
    ['Malayalam', 'malayalam'], ['Marathi', 'marathi'], ['Qawwali', 'sufi'], ['Coke Studio', 'sufi'],
    ['Ghazal', 'ghazal'], ['Bhajan', 'devotional'], ['Bhakti', 'devotional'], ['Aarti', 'devotional'],
    ['Indian Classical', 'hindustani'], ['Carnatic', 'carnatic'], ['Indian Indie', 'indie'], ['Indie Pop', 'indie'],
    ['Lo-Fi', 'lofi'], ['Lofi Hip Hop', 'lofi'], ['Chillhop', 'lofi'], ['Bollywood Lofi', 'lofi'],
    ['Hip-Hop/Rap', 'hiphop'], ['Desi Hip Hop', 'hiphop'], ['Trap', 'hiphop'], ['Electronic', 'edm'],
    ['House', 'edm'], ['Techno', 'edm'], ['Dubstep', 'edm'], ['DnB', 'edm'], ['Drum & Bass', 'edm'],
    ['Phonk', 'edm'], ['Pop', 'pop'], ['Rock', 'rock'], ['Metal', 'metal'], ['R&B/Soul', 'rnb'], ['Soul', 'rnb'],
    ['Jazz', 'jazz'], ['Western Classical', 'classical'], ['Score', 'soundtrack'], ['OST', 'soundtrack'],
    ['Acoustic', 'acoustic'], ['Ambient', 'ambient'], ['K-Pop', 'kpop'], ['Reggaeton', 'latin'],
    ['Country', 'country'], ['Folk', 'folk'],
  ])('%s -> %s', (tag, family) => {
    expect(genreFamily(tag)).toBe(family);
  });

  it('returns null for empty or meaningless tags and labels families', () => {
    expect(genreFamily('')).toBeNull();
    expect(genreFamily('Other')).toBeNull();
    expect(genreFamily('Podcast')).toBeNull();
    expect(genreFamilyLabel('punjabi')).toBe('Punjabi');
    expect(genreFamilyLabel('lofi')).toBe('Lo-fi');
    expect(genreFamilyLabel('hiphop')).toBe('Hip-hop');
    expect(genreFamilyLabel('edm')).toBe('EDM');
    expect(genreFamilyLabel('')).toBe('');
  });
});

describe('moodScore and classifyMoods', () => {
  const lib = libOf([
    { id: 'gym', title: 'Brown Munde', artist: 'AP Dhillon', genre: 'Punjabi' },
    { id: 'bhajan', title: 'Achyutam Keshavam', artist: 'Vikram Hazra', genre: 'Bhajan' },
    { id: 'unplugged', title: 'Tum Se Hi (Unplugged)', artist: 'Someone', genre: '' },
    { id: 'plain', title: 'Untitled 3', artist: 'Nobody', genre: '' },
  ]);
  const t = (id: string) => {
    const track = lib.byId.get(id);
    if (!track) throw new Error(id);
    return track;
  };
  const pumped = feat({ energy: 0.92, valence: 0.65, bpm: 140, danceability: 0.8, bass: 0.85, acousticness: 0.05 });
  const sleepy = feat({ energy: 0.1, valence: 0.3, bpm: 68, danceability: 0.2, bass: 0.2, acousticness: 0.85 });

  it('stays within 0..1 for any features', () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 200; i++) {
      const f = feat({ energy: rng(), valence: rng(), bpm: 40 + rng() * 160, bass: rng(), acousticness: rng(), danceability: rng() });
      for (const m of MOODS) {
        const s = moodScore(m, t('plain'), f);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
      }
    }
  });

  it('caps genre/keyword priors at 0.6 without features', () => {
    for (const id of ['gym', 'bhajan', 'unplugged', 'plain']) {
      for (const m of MOODS) expect(moodScore(m, t(id), undefined)).toBeLessThanOrEqual(0.6);
    }
    expect(moodScore(moodById('devotional'), t('bhajan'), undefined)).toBeGreaterThanOrEqual(0.5);
    expect(moodScore(moodById('acoustic'), t('unplugged'), undefined)).toBeGreaterThan(0.4);
    expect(classifyMoods(t('bhajan'), undefined)).toContain('devotional');
    expect(classifyMoods(t('plain'), undefined)).toEqual([]);
  });

  it('follows the features when they exist', () => {
    expect(moodScore(moodById('workout'), t('plain'), pumped)).toBeGreaterThan(0.75);
    expect(moodScore(moodById('sleep'), t('plain'), pumped)).toBeLessThan(0.3);
    expect(moodScore(moodById('sleep'), t('plain'), sleepy)).toBeGreaterThanOrEqual(0.7);
    const loud = classifyMoods(t('gym'), pumped);
    expect(loud.length).toBeGreaterThan(0);
    expect(loud.length).toBeLessThanOrEqual(2);
    expect(loud.some((m) => ['workout', 'energetic', 'party', 'bass'].includes(m))).toBe(true);
    expect(classifyMoods(t('plain'), sleepy).some((m) => ['sleep', 'chill'].includes(m))).toBe(true);
  });
});
