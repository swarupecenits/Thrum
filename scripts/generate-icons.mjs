// Extracts only the icons (and weights) Thrum uses from phosphor-react-native into a tiny static
// path table, so the app ships a few KB of SVG data instead of the whole icon library.
// Usage: npm run icons
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defsDir = path.join(root, 'node_modules', 'phosphor-react-native', 'src', 'defs');
const outFile = path.join(root, 'src', 'components', 'icon-glyphs.ts');

// r = regular, b = bold, f = fill, t = duotone (tint layer; detail layer is regular unless it differs)
const ICONS = {
  // tabs + navigation
  house: 'rf',
  'vinyl-record': 'rf',
  'magnifying-glass': 'rb',
  equalizer: 'rb',
  'caret-down': 'rb',
  'caret-left': 'rb',
  'caret-right': 'rb',
  'caret-up': 'rb',
  'arrow-left': 'r',
  'arrow-right': 'rb',
  'arrow-up-right': 'r',
  x: 'rb',
  check: 'rb',
  plus: 'rb',
  minus: 'rb',
  'dots-three': 'rb',
  'dots-three-vertical': 'rb',
  'dots-six-vertical': 'r',
  'gear-six': 'r',
  // transport
  play: 'f',
  pause: 'f',
  'skip-forward': 'f',
  'skip-back': 'f',
  shuffle: 'rb',
  repeat: 'rb',
  'repeat-once': 'rb',
  queue: 'r',
  heart: 'rf',
  'list-plus': 'r',
  'arrow-bend-up-right': 'r',
  timer: 'r',
  gauge: 'r',
  quotes: 'rf',
  info: 'r',
  'share-network': 'r',
  'speaker-high': 'r',
  'speaker-slash': 'r',
  // library
  'music-note': 'rf',
  'music-notes': 'rt',
  'music-notes-simple': 'r',
  playlist: 'rt',
  disc: 'rt',
  'users-three': 'r',
  'microphone-stage': 'r',
  folder: 'rt',
  tag: 'r',
  'arrows-down-up': 'r',
  'squares-four': 'r',
  rows: 'r',
  'clock-counter-clockwise': 'r',
  fire: 'rf',
  sparkle: 'rf',
  'magic-wand': 'r',
  'shooting-star': 'rt',
  'chart-bar': 'r',
  trophy: 'rt',
  pencil: 'r',
  'pencil-simple': 'r',
  trash: 'r',
  'arrows-clockwise': 'r',
  'arrow-counter-clockwise': 'r',
  'map-trifold': 'r',
  crosshair: 'r',
  // sound
  waveform: 'rb',
  'wave-sine': 'r',
  'speaker-hifi': 'rt',
  headphones: 'rt',
  bluetooth: 'r',
  usb: 'r',
  'device-mobile-speaker': 'r',
  'sliders-horizontal': 'r',
  lightning: 'rf',
  ear: 'r',
  'shield-check': 'rt',
  // moods
  leaf: 'rt',
  barbell: 'rt',
  smiley: 'rt',
  'heart-break': 'rt',
  'hand-heart': 'rt',
  brain: 'rt',
  confetti: 'rt',
  'cloud-moon': 'rt',
  'flower-lotus': 'rt',
  guitar: 'rt',
  'steering-wheel': 'rt',
  bed: 'rt',
  'sun-horizon': 'rt',
  moon: 'rf',
  sun: 'r',
  coffee: 'rt',
  // system
  warning: 'r',
  lock: 'r',
  'circle-half': 'r',
  palette: 'r',
  'text-aa': 'r',
  eye: 'r',
  'eye-slash': 'r',
  'github-logo': 'r',
  database: 'r',
  hourglass: 'r',
  clock: 'r',
  'calendar-blank': 'r',
  'seal-check': 'f',
  'file-audio': 'r',
  broom: 'r',
  'user-circle': 'r',
  heartbeat: 'r',
  vibrate: 'r',
  swatches: 'r',
};

const pascal = (kebab) =>
  kebab
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');

const WEIGHTS = ['bold', 'duotone', 'fill', 'light', 'regular', 'thin'];

const NUMBER = /[\s,]*[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

/**
 * Makes a path's leading relative moveto absolute so several paths can be joined into one string.
 * Coordinate pairs straight after a moveto are implicit linetos that take its case, so they get an
 * explicit relative "l" — otherwise "m10 20 5 5" would turn into an absolute line to (5, 5).
 */
function absoluteStart(d) {
  if (d[0] !== 'm') return d;
  let end = 1;
  for (let k = 0; k < 2; k++) {
    NUMBER.lastIndex = end;
    if (!NUMBER.exec(d)) throw new Error(`Unexpected path start: ${d.slice(0, 24)}`);
    end = NUMBER.lastIndex;
  }
  const rest = d.slice(end).replace(/^[\s,]+/, '');
  return `M${d.slice(1, end)}${/^[+\-.\d]/.test(rest) ? 'l' : ''}${rest}`;
}

function readWeights(file) {
  const src = readFileSync(file, 'utf8');
  const marks = WEIGHTS.map((w) => ({ w, i: src.indexOf(`'${w}',`) }))
    .filter((m) => m.i >= 0)
    .sort((a, b) => a.i - b.i);
  const out = {};
  marks.forEach((m, idx) => {
    const chunk = src.slice(m.i, idx + 1 < marks.length ? marks[idx + 1].i : undefined);
    out[m.w] = [...chunk.matchAll(/<Path\b([\s\S]*?)\/>/g)].map((p) => {
      const d = /\bd="([^"]+)"/.exec(p[1])?.[1];
      if (!d) throw new Error(`Path without d in ${file}`);
      return { d: absoluteStart(d), tint: /opacity=\{duotoneOpacity\}/.test(p[1]) };
    });
  });
  return out;
}

const join = (paths) => paths.map((p) => p.d).join('');
const lines = [];
let bytes = 0;
for (const [name, weights] of Object.entries(ICONS)) {
  const w = readWeights(path.join(defsDir, `${pascal(name)}.tsx`));
  // Fill-only icons (transport) never draw the outline, so their fill path doubles as the default.
  const entry = { r: weights.includes('r') ? join(w.regular) : join(w.fill) };
  for (const k of weights) {
    if (k === 'b') entry.b = join(w.bold);
    else if (k === 'f' && weights.includes('r')) entry.f = join(w.fill);
    else if (k === 't') {
      const tint = w.duotone.filter((p) => p.tint);
      const detail = join(w.duotone.filter((p) => !p.tint));
      if (!tint.length) throw new Error(`${name} has no duotone tint layer`);
      entry.t = join(tint);
      if (detail !== entry.r) entry.d = detail;
    }
  }
  bytes += Object.values(entry).reduce((n, s) => n + s.length, 0);
  const body = Object.entries(entry)
    .map(([k, v]) => `${k}: '${v}'`)
    .join(', ');
  lines.push(`  '${name}': { ${body} },`);
}

const header = `/* eslint-disable */
// GENERATED by scripts/generate-icons.mjs — do not edit by hand.
// Glyph outlines from Phosphor Icons (https://phosphoricons.com), MIT License,
// Copyright (c) 2020-2023 Phosphor Icons. Permission is hereby granted, free of charge, to any person
// obtaining a copy of this software, to deal in the Software without restriction, subject to including
// this notice. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
// Keys: r = regular, b = bold, f = fill, t = duotone tint layer, d = duotone detail layer when it
// differs from regular. viewBox 0 0 256 256.
`;
writeFileSync(outFile, `${header}export const glyphs = {\n${lines.join('\n')}\n} as const;\n\nexport type IconName = keyof typeof glyphs;\n`);
console.log(`wrote ${Object.keys(ICONS).length} icons, ${(bytes / 1024).toFixed(1)} KB path data -> ${path.relative(root, outFile)}`);
