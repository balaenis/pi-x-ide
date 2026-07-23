// ABOUTME: Caches one dynamic import of the heavy Pi runtime-services module.
// ABOUTME: Exposes preload/load helpers and a test-only importer factory override.
export type RuntimeServicesModule = typeof import("./runtime-services.js");

export type RuntimeServicesImporter = () => Promise<RuntimeServicesModule>;

const defaultImporter: RuntimeServicesImporter = () => import("./runtime-services.js");

let importer: RuntimeServicesImporter = defaultImporter;
let cachedPromise: Promise<RuntimeServicesModule> | undefined;

/** Start (or reuse) the single cached runtime-services import without requiring callers to await. */
export function preloadRuntimeServices(): Promise<RuntimeServicesModule> {
  return loadRuntimeServices();
}

/** Await the single cached runtime-services import; failed imports clear the cache for retry. */
export function loadRuntimeServices(): Promise<RuntimeServicesModule> {
  if (!cachedPromise) {
    cachedPromise = importer().then(
      (module) => module,
      (error) => {
        cachedPromise = undefined;
        throw error;
      },
    );
  }
  return cachedPromise;
}

/**
 * Test-only helper: replace the dynamic importer and reset the module promise cache.
 * Production code must not call this.
 */
export function createRuntimeServicesLoaderForTests(nextImporter: RuntimeServicesImporter = defaultImporter): {
  preloadRuntimeServices: () => Promise<RuntimeServicesModule>;
  loadRuntimeServices: () => Promise<RuntimeServicesModule>;
  reset: () => void;
} {
  let testCached: Promise<RuntimeServicesModule> | undefined;
  const load = (): Promise<RuntimeServicesModule> => {
    if (!testCached) {
      testCached = nextImporter().then(
        (module) => module,
        (error) => {
          testCached = undefined;
          throw error;
        },
      );
    }
    return testCached;
  };
  return {
    preloadRuntimeServices: load,
    loadRuntimeServices: load,
    reset: () => {
      testCached = undefined;
    },
  };
}

/**
 * Test-only helper for the production singleton: override importer and clear cache.
 * Pass undefined to restore the default importer.
 */
export function setRuntimeServicesImporterForTests(nextImporter?: RuntimeServicesImporter): void {
  importer = nextImporter ?? defaultImporter;
  cachedPromise = undefined;
}
