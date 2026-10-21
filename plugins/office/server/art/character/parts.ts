// Ported from marmottajr/habblaud shared/appearance.ts at faa1a012b5fbf632c66dc6801c5383e53a542406 (MIT; notice added by 07-05).
// Style lists of the appearance parts; the editor and API helpers of the upstream file are not ported. Pure: no Node, no DOM.

export const HAIR_STYLES = [
  'short', 'buzz', 'spiky', 'side_part', 'curly', 'afro', 'bob', 'long', 'ponytail', 'bun', 'pigtails', 'mohawk', 'bald', 'wavy',
] as const;
export const TOP_STYLES = ['tshirt', 'hoodie', 'shirt_tie', 'sweater', 'jacket', 'blouse', 'polo'] as const;
export const ACCESSORIES = ['none', 'glasses', 'sunglasses', 'headphones', 'cap', 'beanie', 'earrings', 'bow'] as const;
export const FACIAL_HAIR = ['none', 'stubble', 'beard', 'mustache', 'goatee'] as const;
export const BOTTOM_STYLES = ['pants', 'shorts', 'skirt'] as const;
