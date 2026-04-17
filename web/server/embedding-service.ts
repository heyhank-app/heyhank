// ─── Embedding Service ──────────────────────────────────────────────────────
// Singleton: lazy-loads transformers.js pipeline for local embeddings.
// Model: Xenova/multilingual-e5-small (384 dims, ~118MB quantized, 100 languages)

type Pipeline = {
  (texts: string[], options?: { pooling?: string; normalize?: boolean }): Promise<{ tolist(): number[][] }>;
};

let pipeline: Pipeline | null = null;
let initPromise: Promise<Pipeline> | null = null;

async function ensureModel(): Promise<Pipeline> {
  if (pipeline) return pipeline;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    console.log("[embedding] Loading multilingual-e5-small model (first run downloads ~118MB)...");
    const { pipeline: createPipeline } = await import("@huggingface/transformers");
    const pipe = await createPipeline("feature-extraction", "Xenova/multilingual-e5-small", {
      dtype: "q8",
    });
    pipeline = pipe as unknown as Pipeline;
    console.log("[embedding] Model loaded successfully.");
    return pipeline;
  })();

  initPromise.catch((err) => {
    console.error("[embedding] Failed to load model:", err);
    initPromise = null;
  });

  return initPromise;
}

/**
 * Get embedding vector for text.
 * @param text - The text to embed
 * @param prefix - e5-specific prefix: "passage: " for documents, "query: " for search queries
 */
export async function getEmbedding(text: string, prefix = "passage: "): Promise<number[]> {
  const pipe = await ensureModel();
  const result = await pipe([`${prefix}${text}`], { pooling: "mean", normalize: true });
  return result.tolist()[0];
}

/** Check if the embedding model is loaded and ready */
export function isEmbeddingReady(): boolean {
  return pipeline !== null;
}
