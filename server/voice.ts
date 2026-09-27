import express, { type Router } from "express";
import { v2 as speech } from "@google-cloud/speech";
import { TextToSpeechClient } from "@google-cloud/text-to-speech";

export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
export const MAX_SPEECH_CHARS = 3000;
const AUDIO_TYPES = new Set(["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg"]);
const DEFAULT_VOICE = "en-US-Chirp3-HD-Charon";

export interface VoiceServices {
  transcribe(audio: Buffer): Promise<string>;
  synthesize(text: string): Promise<Buffer>;
}

let speechClient: speech.SpeechClient | undefined;
let ttsClient: TextToSpeechClient | undefined;

export const googleVoice: VoiceServices = {
  async transcribe(audio) {
    const project = process.env.GOOGLE_CLOUD_PROJECT;
    if (!project) throw new Error("voice project is not configured");
    const location = process.env.PF_STT_LOCATION || "us";
    speechClient ??= new speech.SpeechClient({ apiEndpoint: `${location}-speech.googleapis.com` });
    const [result] = await speechClient.recognize({
      recognizer: `projects/${project}/locations/${location}/recognizers/_`,
      config: { autoDecodingConfig: {}, languageCodes: ["en-US"], model: "chirp_3" },
      content: audio,
    });
    return (result.results ?? []).map((part) => part.alternatives?.[0]?.transcript ?? "").join(" ").trim();
  },
  async synthesize(text) {
    ttsClient ??= new TextToSpeechClient();
    const [result] = await ttsClient.synthesizeSpeech({
      input: { text },
      voice: { languageCode: "en-US", name: process.env.PF_TTS_VOICE || DEFAULT_VOICE },
      audioConfig: { audioEncoding: "MP3" },
    });
    if (!result.audioContent) throw new Error("empty speech response");
    return Buffer.from(result.audioContent);
  },
};

export function validateAudio(body: unknown, contentType: string | undefined): string | null {
  const mime = contentType?.split(";")[0].toLowerCase();
  if (!mime || !AUDIO_TYPES.has(mime)) return "Record audio as WebM, Ogg, or MP4.";
  if (!Buffer.isBuffer(body) || body.length === 0) return "Recording is empty.";
  return null;
}

export function validateSpeechText(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return "Text is required.";
  if (value.trim().length > MAX_SPEECH_CHARS) return `Text must be ${MAX_SPEECH_CHARS} characters or fewer.`;
  return null;
}

export function createVoiceRouter(services: VoiceServices = googleVoice): Router {
  const router = express.Router();

  router.post("/transcribe", express.raw({ type: () => true, limit: MAX_AUDIO_BYTES }), async (req, res) => {
    const error = validateAudio(req.body, req.headers["content-type"]);
    if (error) {
      res.status(error === "Recording is empty." ? 400 : 415).json({ error });
      return;
    }
    try {
      const transcript = await services.transcribe(req.body);
      if (!transcript) {
        res.status(422).json({ error: "No speech was detected. Try again." });
        return;
      }
      res.json({ transcript });
    } catch {
      res.status(502).json({ error: "Transcription failed. Check Google Cloud voice setup and try again." });
    }
  });

  router.post("/speak", express.json({ limit: "16kb" }), async (req, res) => {
    const value: unknown = req.body?.text;
    const error = validateSpeechText(value);
    if (error) {
      res.status(error === "Text is required." ? 400 : 413).json({ error });
      return;
    }
    const text = (value as string).trim();
    try {
      const audio = await services.synthesize(text);
      res.set("Content-Type", "audio/mpeg").send(audio);
    } catch {
      res.status(502).json({ error: "Speech playback is unavailable. Check Google Cloud voice setup." });
    }
  });

  router.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof Error && "type" in err && err.type === "entity.too.large") {
      res.status(413).json({ error: req.path === "/transcribe" ? "Recording is too large. Keep it under 8 MB." : "Speech request is too large." });
      return;
    }
    res.status(400).json({ error: "Invalid voice request." });
  });
  return router;
}
