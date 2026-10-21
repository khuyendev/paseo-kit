// Ported from marmottajr/habblaud client/src/art/api.ts at faa1a012b5fbf632c66dc6801c5383e53a542406 (MIT; notice added by 07-05).
// Shared character types only (no runtime export). Pose and Dir come from shared/art-types.ts; the canvas, furniture and
// World types of the upstream file are not ported.
import type { Dir, Pose } from '../../../shared/art-types.ts';
import type { ACCESSORIES, BOTTOM_STYLES, FACIAL_HAIR, HAIR_STYLES, TOP_STYLES } from './parts.ts';

export type HairStyle = (typeof HAIR_STYLES)[number];
export type TopStyle = (typeof TOP_STYLES)[number];
export type Accessory = (typeof ACCESSORIES)[number];
export type FacialHair = (typeof FACIAL_HAIR)[number];
export type BottomStyle = (typeof BOTTOM_STYLES)[number];

export type HeldItem = 'none' | 'coffee' | 'water' | 'papers' | 'laptop' | 'book' | 'box' | 'paddle' | 'popcorn'
  // --- social life (additive)
  | 'controller' // video game controller (pose 'game'; standing/walking, in one hand)
  | 'rock' // pose 'rps': closed hand (rock)
  | 'paper' // pose 'rps': open hand, palm down (paper)
  | 'scissors' // pose 'rps': index and middle finger in a V (scissors)
  | 'phone' // phone (with 'read' or 'sit': looking at the screen, thumb scrolling; bluish lit screen)
  | 'lipstick' // lipstick (pose 'groom')
  | 'comb'; // comb (pose 'groom')

export interface Appearance {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  eyes: string;
  top: string;
  topAccent: string;
  topStyle: TopStyle;
  bottom: string;
  shoes: string;
  accessory: Accessory;
  accessoryColor: string;
  /** Badge/lanyard around the neck (used to tell subagents apart). null = no badge. */
  lanyard: string | null;
  look: 'f' | 'm';
  /** (Optional, additive) Beard/moustache: only drawn for look 'm'. Absent = no facial hair. */
  facialHair?: FacialHair;
  /** (Optional, additive) Lower part of the clothes. Absent = trousers. */
  bottomStyle?: BottomStyle;
}

export type Costume = 'santa' | 'witch' | 'pumpkin' | 'vampire';

export interface CharacterFrameRequest {
  appearance: Appearance;
  dir: Dir;
  pose: Pose;
  frame: number;
  held?: HeldItem;
  /** For poses that can be standing or seated (raise_hand, read, talk). */
  seated?: boolean;
  /** Seasonal accessory; absent keeps the original look. */
  costume?: Costume;
}
