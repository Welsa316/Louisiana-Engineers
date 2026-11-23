import { createHash } from "node:crypto";
import type { Db } from "../src/db/tx";

/**
 * Seed accounts. Every seeded person has a stable id derived from their
 * prototype key, so tests and end-to-end specs can name a seeded user
 * (through `SEED` in seed.ts) without reading the database, and re-running
 * the seed updates the same rows instead of adding new ones.
 */

/** A deterministic UUID for a seed key (name-based, version 5 layout). */
export function seedUserId(key: string): string {
  const bytes = createHash("sha256").update(`mest-seed:${key}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Seed addresses use the reserved `.test` domain, so no mail can reach a real inbox. */
export function seedEmail(key: string): string {
  return `${key}@example.test`;
}

export interface SeedAccount {
  key: string;
  /** When the account was created and its email verified. */
  joinedAt: Date;
  /** Last sign-in; defaults to `joinedAt`. */
  lastSignInAt?: Date;
}

/**
 * Inserts or refreshes one verified `users` row per account. Runs as the
 * table owner inside the seed's `withSystem` transaction.
 */
export async function seedUsers(db: Db, accounts: SeedAccount[]): Promise<void> {
  for (const account of accounts) {
    const id = seedUserId(account.key);
    const email = seedEmail(account.key);
    const clash = await db.maybeOne<{ id: string }>("SELECT id FROM users WHERE email = $1 AND id <> $2", [email, id]);
    if (clash) {
      throw new Error(
        `seed: ${email} already belongs to another account (${clash.id}); reset the local database before seeding`,
      );
    }
    await db.query(
      `INSERT INTO users (id, email, email_verified_at, created_at, last_sign_in_at)
       VALUES ($1, $2, $3, $3, $4)
       ON CONFLICT (id) DO UPDATE
         SET email = EXCLUDED.email,
             email_verified_at = EXCLUDED.email_verified_at,
             last_sign_in_at = EXCLUDED.last_sign_in_at,
             suspended_at = NULL,
             deleted_at = NULL`,
      [id, email, account.joinedAt, account.lastSignInAt ?? account.joinedAt],
    );
  }
}
