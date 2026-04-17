// ─── Audio Recorder ──────────────────────────────────────────────────────────
// Records call audio as stereo WAV (caller = left channel, AI = right channel).
// Both channels are 8kHz PCM 16-bit. The WAV is written on call end.

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CALLS_DIR = join(homedir(), ".heyhank", "telephony", "calls");
const SAMPLE_RATE = 8000;

export class AudioRecorder {
  private callerChunks: Uint8Array[] = [];
  private aiChunks: Uint8Array[] = [];
  private callerBytes = 0;
  private aiBytes = 0;
  private callId: string;

  constructor(callId: string) {
    this.callId = callId;
  }

  /** Record caller audio (8kHz PCM 16-bit mono from FreeSWITCH) */
  addCallerAudio(pcm: Buffer | Uint8Array): void {
    const chunk = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    this.callerChunks.push(chunk);
    this.callerBytes += chunk.byteLength;
  }

  /** Record AI audio (already downsampled to 8kHz PCM 16-bit mono) */
  addAiAudio(pcm: Uint8Array): void {
    this.aiChunks.push(pcm);
    this.aiBytes += pcm.byteLength;
  }

  /** Write stereo WAV file and return the file path */
  save(): string | null {
    if (this.callerBytes === 0 && this.aiBytes === 0) {
      return null;
    }

    if (!existsSync(CALLS_DIR)) {
      mkdirSync(CALLS_DIR, { recursive: true });
    }

    // Merge chunks into contiguous buffers
    const callerPcm = mergeChunks(this.callerChunks, this.callerBytes);
    const aiPcm = mergeChunks(this.aiChunks, this.aiBytes);

    // Interleave into stereo: caller = left, AI = right
    // Both are 16-bit samples. The longer channel determines total length.
    const callerSamples = callerPcm.byteLength / 2;
    const aiSamples = aiPcm.byteLength / 2;
    const totalSamples = Math.max(callerSamples, aiSamples);

    // Stereo PCM: 2 channels * 2 bytes per sample * totalSamples
    const stereoData = new Uint8Array(totalSamples * 4);
    const stereoView = new DataView(stereoData.buffer);
    const callerView = new DataView(callerPcm.buffer, callerPcm.byteOffset, callerPcm.byteLength);
    const aiView = new DataView(aiPcm.buffer, aiPcm.byteOffset, aiPcm.byteLength);

    for (let i = 0; i < totalSamples; i++) {
      const callerSample = i < callerSamples ? callerView.getInt16(i * 2, true) : 0;
      const aiSample = i < aiSamples ? aiView.getInt16(i * 2, true) : 0;
      // Left = caller, Right = AI
      stereoView.setInt16(i * 4, callerSample, true);
      stereoView.setInt16(i * 4 + 2, aiSample, true);
    }

    // Build WAV file
    const wav = buildWav(stereoData, SAMPLE_RATE, 2);
    const filePath = join(CALLS_DIR, `${this.callId}.wav`);
    writeFileSync(filePath, wav);

    console.log(`[telephony] Saved call recording: ${filePath} (${(wav.byteLength / 1024).toFixed(0)} KB, ${(totalSamples / SAMPLE_RATE).toFixed(1)}s)`);

    // Free memory
    this.callerChunks = [];
    this.aiChunks = [];
    this.callerBytes = 0;
    this.aiBytes = 0;

    return filePath;
  }
}

function mergeChunks(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  if (chunks.length === 0) return new Uint8Array(0);
  if (chunks.length === 1) return chunks[0];
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/** Build a WAV file from raw PCM data */
function buildWav(pcmData: Uint8Array, sampleRate: number, channels: number): Uint8Array {
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcmData.byteLength;
  const headerSize = 44;
  const fileSize = headerSize + dataSize;

  const wav = new Uint8Array(fileSize);
  const view = new DataView(wav.buffer);

  // RIFF header
  wav.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  view.setUint32(4, fileSize - 8, true);
  wav.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE"

  // fmt chunk
  wav.set([0x66, 0x6D, 0x74, 0x20], 12); // "fmt "
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  wav.set([0x64, 0x61, 0x74, 0x61], 36); // "data"
  view.setUint32(40, dataSize, true);
  wav.set(pcmData, 44);

  return wav;
}
