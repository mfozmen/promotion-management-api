import { driverFault } from './driver-fault.js';

/** One walk of the cause chain lives in `driverFault`; this asks it a yes-or-no question. */
export function hasSqlState(error: unknown, state: string): boolean {
  return driverFault(error)?.code === state;
}
