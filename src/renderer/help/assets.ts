// src/renderer/help/assets.ts
// Icons and pictures for the guide. Topic files name these as plain strings.
import {
  Banknote,
  ChefHat,
  CircleAlert,
  ClipboardList,
  CloudOff,
  MoonStar,
  PencilLine,
  Printer,
  ShieldCheck,
  ShoppingBag,
  Sunrise,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';
import type { HelpIconName, HelpLang, HelpMarker, HelpMarkers } from './types';
import markersJson from './images/markers.json';

export const HELP_ICONS: Record<HelpIconName, LucideIcon> = {
  start: Sunrise,
  order: ShoppingBag,
  table: UtensilsCrossed,
  pay: Banknote,
  change: PencilLine,
  orders: ClipboardList,
  kitchen: ChefHat,
  printer: Printer,
  offline: CloudOff,
  closing: MoonStar,
  manager: ShieldCheck,
  trouble: CircleAlert,
};

// Bundled into the app, so the guide works with no internet.
const files = import.meta.glob('./images/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

export function pictureUrl(file: string, lang: HelpLang): string | undefined {
  return files[`./images/${file}.${lang}.webp`];
}

const MARKERS = markersJson as HelpMarkers;

export function pictureMarkers(file: string, lang: HelpLang): HelpMarker[] {
  return MARKERS[file]?.[lang] ?? [];
}
