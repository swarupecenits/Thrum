import {
  cleanAlbum,
  cleanArtist,
  cleanGenre,
  cleanTitle,
  fuzzyScore,
  initials,
  normalize,
  sectionLetter,
  sortKey,
  splitArtists,
  tokens,
} from '../text';

describe('normalize', () => {
  it('lowercases, strips diacritics and punctuation, collapses whitespace', () => {
    expect(normalize('  Café   Déjà-Vu!! ')).toBe('cafe deja vu');
    expect(normalize('Rock & Roll')).toBe('rock and roll');
    expect(normalize("Don't Start Now")).toBe('dont start now');
    expect(normalize('A.R. Rahman')).toBe('ar rahman');
  });

  it('keeps every script and folds stylised dollars', () => {
    expect(normalize('तुम ही हो')).toBe('तुम ही हो');
    expect(normalize('ज़िंदगी')).toBe(normalize('जिंदगी'));
    expect(normalize('আমি, তোমার!')).toBe('আমি তোমার'.normalize('NFKD'));
    expect(normalize('KR$NA')).toBe('krsna');
    expect(normalize('A$AP Rocky')).toBe('asap rocky');
    expect(normalize('$100 Bill')).toBe('100 bill');
  });

  it('is idempotent and safe on empty input', () => {
    const once = normalize('Kun Fāyā Kun (From "Rockstar")');
    expect(normalize(once)).toBe(once);
    expect(normalize('')).toBe('');
    expect(tokens('Tum Hi Ho')).toEqual(['tum', 'hi', 'ho']);
    expect(tokens('  ')).toEqual([]);
  });
});

describe('sortKey and sectionLetter', () => {
  it('drops leading articles, punctuation and emoji', () => {
    expect(sortKey('The Weeknd')).toBe('weeknd');
    expect(sortKey('An Evening in Paris')).toBe('evening in paris');
    expect(sortKey('A Sky Full of Stars')).toBe('sky full of stars');
    expect(sortKey('...Baby One More Time')).toBe('baby one more time');
    expect(sortKey('🔥 Fire')).toBe('fire');
    expect(sortKey('The')).toBe('the');
  });

  it('buckets into A-Z or #', () => {
    expect(sectionLetter('the local train')).toBe('L');
    expect(sectionLetter('Écoute')).toBe('E');
    expect(sectionLetter('295')).toBe('#');
    expect(sectionLetter('তুমি')).toBe('#');
    expect(sectionLetter('')).toBe('#');
  });
});

describe('splitArtists', () => {
  it('splits every common credit separator, primary first', () => {
    expect(splitArtists('Arijit Singh, Shreya Ghoshal')).toEqual(['Arijit Singh', 'Shreya Ghoshal']);
    expect(splitArtists('AP Dhillon x Gurinder Gill & Shinda Kahlon')).toEqual(['AP Dhillon', 'Gurinder Gill', 'Shinda Kahlon']);
    expect(splitArtists('Calvin Harris X Dua Lipa')).toEqual(['Calvin Harris', 'Dua Lipa']);
    expect(splitArtists('Badshah feat. Aastha Gill')).toEqual(['Badshah', 'Aastha Gill']);
    expect(splitArtists('Badshah feat Aastha Gill')).toEqual(['Badshah', 'Aastha Gill']);
    expect(splitArtists('Diljit Dosanjh ft. Sia')).toEqual(['Diljit Dosanjh', 'Sia']);
    expect(splitArtists('Divine ft Naezy')).toEqual(['Divine', 'Naezy']);
    expect(splitArtists('Pritam featuring Arijit Singh')).toEqual(['Pritam', 'Arijit Singh']);
    expect(splitArtists('Pritam (feat. Arijit Singh)')).toEqual(['Pritam', 'Arijit Singh']);
    expect(splitArtists('Raftaar;KR$NA')).toEqual(['Raftaar', 'KR$NA']);
    expect(splitArtists('Raftaar / KR$NA')).toEqual(['Raftaar', 'KR$NA']);
    expect(splitArtists('Seedhe Maut vs Raftaar')).toEqual(['Seedhe Maut', 'Raftaar']);
  });

  it('dedupes case-insensitively and keeps names that contain separators', () => {
    expect(splitArtists('Arijit Singh, arijit singh, ARIJIT SINGH')).toEqual(['Arijit Singh']);
    expect(splitArtists('AC/DC')).toEqual(['AC/DC']);
    expect(splitArtists('Tyler, The Creator')).toEqual(['Tyler, The Creator']);
    expect(splitArtists('Vishal & Shekhar, Shilpa Rao')).toEqual(['Vishal & Shekhar', 'Shilpa Rao']);
    expect(splitArtists('Xzibit')).toEqual(['Xzibit']);
    expect(splitArtists('')).toEqual([]);
  });
});

describe('cleanTitle', () => {
  it.each([
    ['Kesariya (PagalWorld.com)', 'Kesariya'],
    ['Tum Hi Ho (Official Video)', 'Tum Hi Ho'],
    ['Raataan Lambiyan [Lyrics]', 'Raataan Lambiyan'],
    ['Kesariya (Audio)', 'Kesariya'],
    ['Apna Bana Le 128 Kbps', 'Apna Bana Le'],
    ['Apna Bana Le - 320kbps', 'Apna Bana Le'],
    ['Chaleya - DJMaza', 'Chaleya'],
    ['Brown Munde - Mr-Jatt.com', 'Brown Munde'],
    ['01 - Tum Se Hi www.Songs.PK', 'Tum Se Hi'],
    ['Tujhe Dekha To [SongsPK]', 'Tujhe Dekha To'],
    ['Ilahi - Webmusic.IN', 'Ilahi'],
    ['Kun Faya Kun (Raag.Fm)', 'Kun Faya Kun'],
    ['Saiyaara DownloadMing', 'Saiyaara'],
    ['Pasoori MyMp3Song', 'Pasoori'],
    ['Tauba Tauba Mp3Mad.Com', 'Tauba Tauba'],
    ['Dil Se Re hindi song', 'Dil Se Re'],
    ['[www.DJMaza.Info] Chaleya', 'Chaleya'],
    ['Ve_Kamleya_(Rocky Aur Rani)_320kbps.mp3', 'Ve Kamleya (Rocky Aur Rani)'],
    ['song.mp3', 'song'],
  ])('%s -> %s', (input, expected) => {
    expect(cleanTitle(input)).toBe(expected);
  });

  it('keeps meaningful brackets', () => {
    expect(cleanTitle('Arjan Vailly (From "Animal")')).toBe('Arjan Vailly (From "Animal")');
    expect(cleanTitle('Tum Hi Ho (Remix)')).toBe('Tum Hi Ho (Remix)');
    expect(cleanTitle('Kesariya (Lofi Flip)')).toBe('Kesariya (Lofi Flip)');
    expect(cleanTitle('Tum Se Hi (Unplugged) [PagalWorld.com]')).toBe('Tum Se Hi (Unplugged)');
    expect(cleanTitle('22')).toBe('22');
    expect(cleanTitle('')).toBe('');
  });
});

describe('cleanArtist / cleanAlbum / cleanGenre', () => {
  it('turns unknowns into empty strings', () => {
    expect(cleanArtist('<unknown>')).toBe('');
    expect(cleanArtist('Unknown')).toBe('');
    expect(cleanArtist('')).toBe('');
    expect(cleanAlbum('Unknown album')).toBe('');
    expect(cleanAlbum('Download')).toBe('');
  });

  it('removes download-site junk', () => {
    expect(cleanArtist('Arijit Singh - PagalWorld.com')).toBe('Arijit Singh');
    expect(cleanAlbum('Aashiqui 2 [Songs.PK]')).toBe('Aashiqui 2');
    expect(cleanAlbum('Dil Se..')).toBe('Dil Se..');
    expect(cleanGenre('(17)')).toBe('Rock');
    expect(cleanGenre('Other')).toBe('');
    expect(cleanGenre('Bollywood Music')).toBe('Bollywood Music');
  });
});

describe('initials', () => {
  it('takes the first grapheme of up to two words', () => {
    expect(initials('Arijit Singh')).toBe('AS');
    expect(initials('Diljit Dosanjh Live')).toBe('DD');
    expect(initials('The Weeknd')).toBe('W');
    expect(initials('anuv jain')).toBe('AJ');
    expect(initials('#BFF')).toBe('B');
    expect(initials('অনুপম রায়')).toBe('অরা');
    expect(initials('तुम ही हो')).toBe('तुही');
    expect(initials('   ')).toBe('');
  });
});

describe('fuzzyScore', () => {
  const ddlj = 'Dilwale Dulhania Le Jayenge';

  it('orders exact > prefix > word prefix > initials > substring > subsequence > typo > none', () => {
    const scores = [
      fuzzyScore(ddlj, ddlj),
      fuzzyScore('dilwale', ddlj),
      fuzzyScore('dulhania', ddlj),
      fuzzyScore('ddlj', ddlj),
      fuzzyScore('lhani', ddlj),
      fuzzyScore('dlwl', ddlj),
      fuzzyScore('jayange', ddlj),
      fuzzyScore('xyz', ddlj),
    ];
    expect(scores[0]).toBe(1);
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeLessThan(scores[i - 1]);
    expect(scores[scores.length - 1]).toBe(0);
  });

  it('matches common misspellings of 4+ letter words', () => {
    expect(fuzzyScore('arjit', 'Arijit Singh')).toBeGreaterThan(0);
    expect(fuzzyScore('arijot', 'Arijit Singh')).toBeGreaterThan(0);
    expect(fuzzyScore('sigh', 'Arijit Singh')).toBeGreaterThan(0);
    expect(fuzzyScore('ar', 'Bz')).toBe(0);
    expect(fuzzyScore('', 'anything')).toBe(0);
  });

  it('accepts pre-normalized input and handles multi-word queries', () => {
    expect(fuzzyScore('tum hi ho', 'tum hi ho')).toBe(1);
    expect(fuzzyScore('ho tum', 'Tum Hi Ho')).toBeGreaterThan(fuzzyScore('lhani', ddlj));
    expect(fuzzyScore('tum ho', 'Tum Hi Ho')).toBeGreaterThan(0.7);
  });
});
