import { GoogleGenAI } from "@google/genai";
import { loadConfig } from "./config.js";
import { OwnSearchError } from "./errors.js";
import { normalizeVector } from "./utils.js";

let client: GoogleGenAI | undefined;
const MAX_EMBED_BATCH_SIZE = 20;

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new OwnSearchError("GEMINI_API_KEY is required.");
  }

  if (!client) {
    client = new GoogleGenAI({ apiKey });
  }

  return client;
}

async function embed(contents: string[], taskType: string): Promise<number[][]> {
  const config = await loadConfig();
  const vectors: number[][] = [];
  const debug = process.env.OWNSEARCH_DEBUG_INDEX === "1";

  for (let index = 0; index < contents.length; index += MAX_EMBED_BATCH_SIZE) {
    const batch = contents.slice(index, index + MAX_EMBED_BATCH_SIZE);
    if (debug) {
      console.log("[ownsearch:embed]", "batch", index / MAX_EMBED_BATCH_SIZE + 1, "size", batch.length, "chars", batch.reduce((sum, text) => sum + text.length, 0));
    }

    const response = await getClient().models.embedContent({
      model: config.embeddingModel,
      contents: batch,
      config: {
        taskType,
        outputDimensionality: config.vectorSize
      }
    });

    if (!response.embeddings?.length) {
      throw new OwnSearchError("Gemini returned no embeddings.");
    }

    vectors.push(...response.embeddings.map((embedding) => normalizeVector(embedding.values ?? [])));
  }

  return vectors;
}

export async function embedDocuments(contents: string[]): Promise<number[][]> {
  return embed(contents, "RETRIEVAL_DOCUMENT");
}

export async function embedQuery(query: string): Promise<number[]> {
  const [vector] = await embed([query], "RETRIEVAL_QUERY");
  return vector;
}
