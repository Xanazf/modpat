import Atomizer from "@atomics/LogicAtomizer";
import SemanticAtomizer from "@atomics/SemanticAtomizer";
import SpectralAtomizer from "@atomics/SpectralAtomizer";
import System from "@core_i/System";
import Traveler from "@core_i/Traveler";
import Store from "@core_s/Memory";
import logger from "@src/utils/SpectralLogger";

export type AtomizerType = "base" | "semantic" | "spectral";

export interface TestEnvironment<A extends Atomic.Engine = Atomic.Engine> {
  system: System;
  atomizer: A;
  store: Store;
  resolver: Traveler;
}

const sharedEnvs: Map<AtomizerType, TestEnvironment<Atomic.Engine>> = new Map();
let useSharedEnv = false;

export const TestHarness = {
  /**
   * Configures whether tests should share the same System and Atomizer instances.
   */
  setSharedEnv(enabled: boolean) {
    useSharedEnv = enabled;
  },

  /**
   * Retrieves a test environment. If shared mode is enabled, it returns a persistent instance.
   * Otherwise, it returns a fresh instance.
   */
  async getEnvironment<A extends Atomic.Engine = Atomic.Engine>(
    type: AtomizerType = "base",
    dbPath?: string
  ): Promise<TestEnvironment<A>> {
    if (useSharedEnv && sharedEnvs.has(type)) {
      return sharedEnvs.get(type)! as unknown as TestEnvironment<A>;
    }

    const system = new System();
    let atomizer: Atomic.Engine;
    switch (type) {
      case "semantic":
        atomizer = new SemanticAtomizer();
        break;
      case "spectral":
        atomizer = new SpectralAtomizer();
        break;
      default:
        atomizer = new Atomizer();
    }
    await atomizer.init();
    const store = new Store(system, atomizer, dbPath);
    await store.waitForInit();
    const resolver = new Traveler(system, atomizer, store);

    const env = { system, atomizer, store, resolver };
    if (useSharedEnv) {
      sharedEnvs.set(type, env);
    }
    return env as unknown as TestEnvironment<A>;
  },

  /**
   * Disposes of a test environment if it's not being shared.
   */
  async disposeEnvironment(env: TestEnvironment<Atomic.Engine>) {
    if (useSharedEnv) return;
    await env.resolver.dispose();
    await env.store.close();
  },

  /**
   * Disposes of all shared environments.
   */
  async disposeAll() {
    for (const env of sharedEnvs.values()) {
      await env.resolver.dispose();
      await env.store.close();
    }
    sharedEnvs.clear();
  },
};

/**
 * Standardized 'describe' block for test suites.
 */
export async function describe(label: string, fn: () => Promise<void>) {
  logger.header(label);
  await fn();
}

/**
 * Standardized 'it' block for test cases.
 */
export async function it(label: string, fn: () => Promise<void>) {
  logger.step(label);
  try {
    await fn();
  } catch (e) {
    logger.error(`  ✗ Test case failed: ${label}`, e);
    throw e;
  }
}
