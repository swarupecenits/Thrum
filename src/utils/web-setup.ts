import { Platform } from 'react-native';

// Web-only polish for the demo build: no tap flashes, no rubber-banding, no focus rings.
if (Platform.OS === 'web' && typeof document !== 'undefined' && !document.getElementById('thrum-web')) {
  const style = document.createElement('style');
  style.id = 'thrum-web';
  style.textContent = [
    'html, body { overscroll-behavior: none; background: #09090B; }',
    '* { -webkit-tap-highlight-color: transparent; }',
    'input, textarea { outline: none; caret-color: currentColor; }',
    'input::placeholder, textarea::placeholder { opacity: 1; }',
    '::-webkit-scrollbar { width: 0; height: 0; }',
    '@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; } }',
  ].join('\n');
  document.head.appendChild(style);
}
