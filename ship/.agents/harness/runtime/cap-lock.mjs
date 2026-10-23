// G133: the caller-wide agent cap is one count for every process of a caller (spawn, fanout, collect and each workflow
// run). The count and the create of a new agent hold one lock per caller, kept in the project's _workspace/locks.
import path from "node:path";
import { acquireMutex } from "../adapter/mutex.mjs";

// Takes the caller's cap lock, waiting while another process holds it; returns the release function.
export const takeCapLock = (root, caller, clock) => acquireMutex(`agent-cap-${caller}`, { clock, tmp: path.join(root, "_workspace", "locks") });
