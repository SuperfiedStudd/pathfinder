// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MAX_SPEECH_CHARS, validateAudio, validateSpeechText } from "../server/voice";

describe("voice request validation", () => {
  it("accepts supported browser audio with Content-Type parameters", () => {
    expect(validateAudio(Buffer.from("audio"), "audio/webm;codecs=opus")).toBeNull();
    expect(validateAudio(Buffer.from("audio"), "audio/mp4")).toBeNull();
  });

  it("rejects empty or unsupported recordings", () => {
    expect(validateAudio(Buffer.alloc(0), "audio/webm")).toBe("Recording is empty.");
    expect(validateAudio(Buffer.from("audio"), "application/octet-stream")).toMatch(/WebM/);
  });

  it("limits non-empty TTS text", () => {
    expect(validateSpeechText(" Hello ")).toBeNull();
    expect(validateSpeechText("   ")).toBe("Text is required.");
    expect(validateSpeechText("x".repeat(MAX_SPEECH_CHARS + 1))).toMatch(/characters/);
  });
});
