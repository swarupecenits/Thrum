import type { IconName } from '../icon';
import type { AudioRoute, RouteKind } from '@/audio/native';

const CAR = /\b(car|auto|sync|carplay|mylink|uconnect|bmw|audi|mercedes|toyota|honda|hyundai|kia|maruti|suzuki|tata|mahindra|skoda|volkswagen|vw|ford|mg)\b/i;
const BUDS = /(bud|pods|ear|head|airdopes|rockerz|tws|neckband|wh-|wf-)/i;
const SPEAKER = /(speaker|jbl|boom|soundbar|sonos|bose|marshall|flip|charge|stone|echo|nest)/i;

export const ROUTE_KIND: Record<RouteKind, string> = {
  speaker: 'Built-in',
  wired: 'Wired',
  bluetooth: 'Bluetooth',
  usb: 'USB audio',
  other: 'External',
};

/** A best guess at what a Bluetooth device is from its name: buds, a car, a speaker. */
export function routeIcon(route: Pick<AudioRoute, 'kind' | 'name'>): IconName {
  switch (route.kind) {
    case 'speaker':
      return 'device-mobile-speaker';
    case 'wired':
      return 'headphones';
    case 'usb':
      return 'usb';
    case 'bluetooth':
      if (CAR.test(route.name)) return 'steering-wheel';
      if (BUDS.test(route.name)) return 'headphones';
      if (SPEAKER.test(route.name)) return 'speaker-hifi';
      return 'bluetooth';
    default:
      return 'speaker-high';
  }
}

/** Display name for a saved profile key: "bluetooth:Galaxy Buds3 Pro" -> "Galaxy Buds3 Pro". */
export function profileName(key: string): string {
  if (key === 'speaker') return 'Phone speaker';
  if (key === 'wired') return 'Wired headphones';
  const sep = key.indexOf(':');
  const name = sep >= 0 ? key.slice(sep + 1).trim() : key.trim();
  return name || 'External output';
}
