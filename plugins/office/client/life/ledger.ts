// Port of habblaud client/src/world/sim/spots.ts @ faa1a012b5fbf632c66dc6801c5383e53a542406 (MIT; notice in LICENSES/habblaud-MIT.txt, added by plan 07-05).
// Ported: one holder per spot, all-or-nothing reservation of several spots, and the by-kind and by-group indexes; setSpots, get and the findFree searches live in wander.ts and social.ts.
// Spot ids and owner ids are agent- or room-derived strings, so every table here is a Map and never an object keyed by an id (T-07-81).
import type { AreaKind, AreaLayout, SpotDef, SpotKind } from "../../shared/layout/types.ts";

export interface SpotLedger {
  readonly size: number;
  isFree(spotId: string, by?: string): boolean;
  ownerOf(spotId: string): string | undefined;
  reserve(spotId: string, by: string): boolean;
  release(spotId: string, by: string): void;
  releaseAll(by: string): void;
  // All spots or none: one spot held by another owner leaves the ledger unchanged and gives false.
  reserveAll(spotIds: readonly string[], by: string): boolean;
  reservedBy(by: string): string[];
}

export function createSpotLedger(): SpotLedger {
  const owners = new Map<string, string>();
  const isFree = (spotId: string, by?: string): boolean => {
    const owner = owners.get(spotId);
    return owner === undefined || owner === by;
  };
  return {
    get size() {
      return owners.size;
    },
    isFree,
    ownerOf: (spotId) => owners.get(spotId),
    reserve(spotId, by) {
      if (!isFree(spotId, by)) return false;
      owners.set(spotId, by);
      return true;
    },
    release(spotId, by) {
      if (owners.get(spotId) === by) owners.delete(spotId);
    },
    releaseAll(by) {
      for (const [spotId, owner] of [...owners]) if (owner === by) owners.delete(spotId);
    },
    reserveAll(spotIds, by) {
      if (!spotIds.every((spotId) => isFree(spotId, by))) return false;
      for (const spotId of spotIds) owners.set(spotId, by);
      return true;
    },
    reservedBy(by) {
      const out: string[] = [];
      for (const [spotId, owner] of owners) if (owner === by) out.push(spotId);
      return out;
    },
  };
}

export interface SpotIndex {
  // Every spot once, in area order then spot order.
  readonly spots: readonly SpotDef[];
  ofKind(kind: SpotKind): readonly SpotDef[];
  group(group: string): readonly SpotDef[];
  areaOf(spotId: string): string | undefined;
  areaKindOf(spotId: string): AreaKind | undefined;
}

export function indexSpots(building: { readonly areas: readonly AreaLayout[] }): SpotIndex {
  const spots: SpotDef[] = [];
  const byId = new Map<string, { areaId: string; areaKind: AreaKind }>();
  const byKind = new Map<SpotKind, SpotDef[]>();
  const byGroup = new Map<string, SpotDef[]>();
  for (const area of building.areas) {
    for (const spot of area.spots) {
      if (byId.has(spot.id)) continue;
      byId.set(spot.id, { areaId: area.id, areaKind: area.kind });
      spots.push(spot);
      const kindList = byKind.get(spot.kind);
      if (kindList) kindList.push(spot);
      else byKind.set(spot.kind, [spot]);
      if (spot.group !== undefined) {
        const groupList = byGroup.get(spot.group);
        if (groupList) groupList.push(spot);
        else byGroup.set(spot.group, [spot]);
      }
    }
  }
  return {
    spots,
    ofKind: (kind) => byKind.get(kind) ?? [],
    group: (group) => byGroup.get(group) ?? [],
    areaOf: (spotId) => byId.get(spotId)?.areaId,
    areaKindOf: (spotId) => byId.get(spotId)?.areaKind,
  };
}
