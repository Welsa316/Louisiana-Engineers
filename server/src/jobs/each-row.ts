import { withSystem, type Db } from "../db/tx";
import { safeErrorSummary } from "../http/errors";

export interface RowTotals {
  /** Rows the lifecycle function moved (it returned true). */
  moved: number;
  /** Rows whose transaction threw; they are tried again on the next run. */
  errored: number;
}

/**
 * Calls a lifecycle function once per selected row, each in its own short
 * system transaction. One row that fails never rolls back the rows already
 * moved (and their notifications), and never stops the rest of the run.
 * The functions move a row at most once, so a row a failed run left behind
 * is simply picked up again next time.
 */
export async function eachRow<T>(
  job: string,
  rows: T[],
  describe: (row: T) => string,
  step: (tx: Db, row: T) => Promise<boolean>,
): Promise<RowTotals> {
  const totals: RowTotals = { moved: 0, errored: 0 };
  for (const row of rows) {
    try {
      if (await withSystem((tx) => step(tx, row))) totals.moved += 1;
    } catch (error) {
      totals.errored += 1;
      console.error(`[jobs] ${job}: ${describe(row)} failed`, safeErrorSummary(error));
    }
  }
  return totals;
}
