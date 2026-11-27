import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * Server and shared tests. Every test file in a run shares one private test
 * database (named after WORKTREE_ID), so files run one at a time.
 */
export default defineConfig({
  root: repoRoot,
  resolve: {
    alias: { "@shared": fileURLToPath(new URL("../shared", import.meta.url)) },
  },
  test: {
    include: ["server/test/**/*.test.ts", "shared/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: process.env.DATABASE_URL ?? "postgres://mest:mest@127.0.0.1:54329/mest",
      DATABASE_URL_TEST:
        process.env.DATABASE_URL_TEST ?? "postgres://mest:mest@127.0.0.1:54329/mest_test",
      APP_ORIGIN: process.env.APP_ORIGIN ?? "http://127.0.0.1:8787",
      SESSION_SECRET: process.env.SESSION_SECRET ?? "test-session-secret-test-session-secret",
      EMAIL_FROM: process.env.EMAIL_FROM ?? "MEST Network <network@example.test>",
    },
  },
});
