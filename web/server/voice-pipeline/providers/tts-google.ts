// ─── Google Cloud TTS Provider ───────────────────────────────────────────────
// Uses the REST API (single synthesize call). For telephony we request LINEAR16
// at 8000 Hz which can be sent directly to FreeSWITCH without resampling.

import { GoogleAuth } from "google-auth-library";
import type { TTSConfig, TTSProvider, TTSResult } from "../types.js";

const TTS_BASE = "https://texttospeech.googleapis.com/v1";
const SCOPES = ["https://www.googleapis.com/auth/cloud-platform"];

function getKeyFile(): string {
  return process.env.GCP_SERVICE_ACCOUNT_KEY
    || "/opt/agentplatform/gcp-service-account.json";
}

let cachedAuth: GoogleAuth | null = null;
async function getToken(): Promise<string> {
  if (!cachedAuth) {
    cachedAuth = new GoogleAuth({ keyFile: getKeyFile(), scopes: SCOPES });
  }
  const client = await cachedAuth.getClient();
  const tok = await client.getAccessToken();
  if (!tok.token) throw new Error("No access token from GoogleAuth");
  return tok.token;
}

/** Map our format enum → Google Cloud TTS audioEncoding + sampleRateHertz */
function mapFormat(format: TTSConfig["format"]): { audioEncoding: string; sampleRateHertz?: number } {
  switch (format) {
    case "PCM_8000":
      return { audioEncoding: "LINEAR16", sampleRateHertz: 8000 };
    case "MP3":
      return { audioEncoding: "MP3" };
    case "OGG_OPUS":
      return { audioEncoding: "OGG_OPUS" };
  }
}

/** PCM_8000 returns audio as a WAV container (~44 byte header). Strip it for FreeSWITCH. */
function stripWavHeader(audio: Uint8Array): Uint8Array {
  // WAV header is "RIFF....WAVE" - find "data" chunk and skip 8 bytes after it
  if (audio.length < 44) return audio;
  if (audio[0] === 0x52 && audio[1] === 0x49 && audio[2] === 0x46 && audio[3] === 0x46) {
    // RIFF header detected - search for "data" marker
    for (let i = 12; i < Math.min(audio.length - 8, 256); i++) {
      if (audio[i] === 0x64 && audio[i + 1] === 0x61 && audio[i + 2] === 0x74 && audio[i + 3] === 0x61) {
        // Skip "data" (4 bytes) + chunk size (4 bytes) = 8 bytes
        return audio.slice(i + 8);
      }
    }
  }
  return audio;
}

export class GoogleTTSProvider implements TTSProvider {
  readonly id = "google" as const;

  async synthesize(text: string, config: TTSConfig): Promise<TTSResult> {
    const token = await getToken();
    const fmt = mapFormat(config.format);

    const body = {
      input: { text },
      voice: {
        languageCode: config.language,
        name: config.voice,
      },
      audioConfig: {
        audioEncoding: fmt.audioEncoding,
        ...(fmt.sampleRateHertz ? { sampleRateHertz: fmt.sampleRateHertz } : {}),
        speakingRate: config.speakingRate ?? 1.0,
      },
    };

    const res = await fetch(`${TTS_BASE}/text:synthesize`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Google TTS error ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json() as { audioContent?: string };
    if (!data.audioContent) {
      throw new Error("Google TTS returned no audioContent");
    }

    const decoded = Buffer.from(data.audioContent, "base64");
    let audio: Uint8Array = new Uint8Array(decoded.buffer.slice(decoded.byteOffset, decoded.byteOffset + decoded.byteLength));
    if (config.format === "PCM_8000") {
      audio = new Uint8Array(stripWavHeader(audio));
    }

    return {
      audio,
      format: config.format,
      voice: config.voice,
      bytes: audio.byteLength,
    };
  }

  async listVoices(language: string): Promise<Array<{ name: string; gender?: string; type?: string }>> {
    const token = await getToken();
    const res = await fetch(`${TTS_BASE}/voices?languageCode=${encodeURIComponent(language)}`, {
      headers: { "Authorization": `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Google TTS listVoices ${res.status}`);
    const data = await res.json() as {
      voices?: Array<{ name: string; ssmlGender?: string }>;
    };
    return (data.voices || []).map((v) => {
      let type = "Standard";
      if (v.name.includes("Studio")) type = "Studio";
      else if (v.name.includes("Chirp")) type = "Chirp HD";
      else if (v.name.includes("Neural2")) type = "Neural2";
      else if (v.name.includes("Wavenet")) type = "WaveNet";
      return { name: v.name, gender: v.ssmlGender, type };
    });
  }
}
