const DEFAULT_REF_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_GENERATIONS = 5;
const DEFAULT_MAX_REFS = 1000;

interface SnapshotGeneration<TElement> {
  readonly id: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly refs: ReadonlyMap<string, TElement>;
}

export class ElementRefRegistry<TElement> {
  readonly #ttlMs: number;
  readonly #maxGenerations: number;
  readonly #maxRefs: number;
  #counter = 0;
  #latestGenerationId: string | undefined;
  readonly #generations = new Map<string, SnapshotGeneration<TElement>>();

  constructor(
    options: {
      readonly ttlMs?: number;
      readonly maxGenerations?: number;
      readonly maxRefs?: number;
    } = {},
  ) {
    this.#ttlMs = options.ttlMs ?? DEFAULT_REF_TTL_MS;
    this.#maxGenerations = options.maxGenerations ?? DEFAULT_MAX_GENERATIONS;
    this.#maxRefs = options.maxRefs ?? DEFAULT_MAX_REFS;
  }

  createGeneration(
    elements: readonly TElement[],
    now = Date.now(),
  ): {
    readonly generationId: string;
    readonly refsByElement: ReadonlyMap<TElement, string>;
    readonly refCount: number;
  } {
    this.#prune(now);
    this.#counter += 1;
    const generationId = `g${now.toString(36)}-${this.#counter.toString(36)}`;
    const refs = new Map<string, TElement>();
    const refsByElement = new Map<TElement, string>();
    for (const [index, element] of elements.slice(0, this.#maxRefs).entries()) {
      const ref = `@e${String(index + 1)}`;
      refs.set(ref, element);
      refsByElement.set(element, ref);
    }

    this.#generations.set(generationId, {
      id: generationId,
      createdAt: now,
      expiresAt: now + this.#ttlMs,
      refs,
    });
    this.#latestGenerationId = generationId;
    this.#trimGenerations();
    return { generationId, refsByElement, refCount: refs.size };
  }

  resolve(ref: string, options: { readonly generationId?: string; readonly now?: number } = {}): TElement {
    return this.resolveRef(ref, options).element;
  }

  resolveRef(
    ref: string,
    options: { readonly generationId?: string; readonly now?: number } = {},
  ): { readonly element: TElement; readonly generationId: string } {
    const now = options.now ?? Date.now();
    this.#prune(now);
    const generationId = options.generationId ?? this.#latestGenerationId;
    const generation = generationId === undefined ? undefined : this.#generations.get(generationId);
    const element = generation?.refs.get(ref);
    if (generation === undefined || element === undefined || isDetachedElement(element)) {
      throw new ElementRefRegistryError("REF_NOT_FOUND", "Element ref is stale or unknown.");
    }

    return { element, generationId: generation.id };
  }

  invalidate(): void {
    this.#latestGenerationId = undefined;
    this.#generations.clear();
  }

  #prune(now: number): void {
    for (const generation of this.#generations.values()) {
      if (generation.expiresAt <= now) {
        this.#generations.delete(generation.id);
      }
    }

    if (this.#latestGenerationId !== undefined && !this.#generations.has(this.#latestGenerationId)) {
      this.#latestGenerationId = [...this.#generations.values()].sort((a, b) => b.createdAt - a.createdAt).at(0)?.id;
    }
  }

  #trimGenerations(): void {
    const ordered = [...this.#generations.values()].sort((a, b) => b.createdAt - a.createdAt);
    for (const generation of ordered.slice(this.#maxGenerations)) {
      this.#generations.delete(generation.id);
    }
  }
}

export class ElementRefRegistryError extends Error {
  readonly code = "REF_NOT_FOUND";

  constructor(code: "REF_NOT_FOUND", message: string) {
    super(message);
    this.name = "ElementRefRegistryError";
    this.code = code;
  }
}

function isDetachedElement(value: unknown): boolean {
  return typeof value === "object" && value !== null && "isConnected" in value && value.isConnected === false;
}
