// An expected failure of a kit verb: printed as `failed: <msg>` (exit 1); anything else prints `error: <msg>` (INST-01).
export class KitFailure extends Error {}

export const fail = (msg) => {
  throw new KitFailure(msg);
};
