export type VoiceStatus = "idle" | "starting" | "listening" | "transcribing" | "thinking" | "speaking";

const MAX_RECORDING_MS = 55_000;
const AUDIO_FORMATS = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"];

async function responseError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return body.error || `Voice request failed (${response.status}).`;
}

export class VoiceController {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private timer: number | null = null;
  private audio: HTMLAudioElement | null = null;
  private audioUrl: string | null = null;
  private speechRequest: AbortController | null = null;
  private generation = 0;
  private disposed = false;
  private status: VoiceStatus = "idle";

  constructor(
    private readonly onStatus: (status: VoiceStatus) => void,
    private readonly onTranscript: (transcript: string) => void,
    private readonly onError: (message: string) => void,
  ) {}

  getStatus(): VoiceStatus { return this.status; }

  markIdle(): void { if (this.status === "thinking") this.setStatus("idle"); }

  private setStatus(status: VoiceStatus): void {
    this.status = status;
    if (!this.disposed) this.onStatus(status);
  }

  async toggleRecording(): Promise<void> {
    if (this.recorder?.state === "recording") {
      this.recorder.stop();
      return;
    }
    if (this.status === "starting" || this.status === "transcribing") return;
    this.stopPlayback();
    const generation = ++this.generation;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      this.onError("Microphone recording is unavailable in this browser.");
      return;
    }
    try {
      this.setStatus("starting");
      const mimeType = AUDIO_FORMATS.find((format) => MediaRecorder.isTypeSupported(format));
      if (!mimeType) throw new Error("This browser cannot record a supported audio format.");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (this.disposed || generation !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      const recorder = new MediaRecorder(stream, { mimeType });
      this.recorder = recorder;
      const chunks: BlobPart[] = [];
      let recordingFailed = false;
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => {
        recordingFailed = true;
        this.onError("Recording failed. Try the microphone again.");
        if (recorder.state === "recording") recorder.stop();
      };
      recorder.onstop = () => {
        if (this.timer !== null) window.clearTimeout(this.timer);
        this.timer = null;
        this.releaseMicrophone();
        if (this.disposed || generation !== this.generation) return;
        if (recordingFailed) { this.setStatus("idle"); return; }
        void this.transcribe(new Blob(chunks, { type: mimeType }), generation);
      };
      recorder.start();
      this.setStatus("listening");
      this.timer = window.setTimeout(() => recorder.stop(), MAX_RECORDING_MS);
    } catch (error) {
      this.releaseMicrophone();
      const denied = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "PermissionDeniedError");
      this.onError(denied ? "Microphone access was denied. You can still type a message." : error instanceof Error ? error.message : "Microphone could not start.");
      this.setStatus("idle");
    }
  }

  private async transcribe(blob: Blob, generation: number): Promise<void> {
    if (!blob.size) {
      this.onError("Recording is empty. Try again.");
      this.setStatus("idle");
      return;
    }
    this.setStatus("transcribing");
    try {
      const response = await fetch("/api/voice/transcribe", {
        method: "POST", headers: { "Content-Type": blob.type }, body: blob,
      });
      if (!response.ok) throw new Error(await responseError(response));
      const data = (await response.json()) as { transcript: string };
      if (this.disposed || generation !== this.generation) return;
      this.setStatus("thinking");
      this.onTranscript(data.transcript);
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      this.onError(error instanceof Error ? error.message : "Transcription failed.");
      this.setStatus("idle");
    }
  }

  async speak(text: string): Promise<void> {
    if (this.status === "starting" || this.status === "listening" || this.status === "transcribing") return;
    this.stopPlayback();
    if (this.disposed) return;
    const generation = ++this.generation;
    const request = new AbortController();
    this.speechRequest = request;
    try {
      const response = await fetch("/api/voice/speak", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }), signal: request.signal,
      });
      if (!response.ok) throw new Error(await responseError(response));
      const blob = await response.blob();
      if (this.disposed || generation !== this.generation) return;
      this.audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(this.audioUrl);
      this.audio = audio;
      audio.onended = () => { this.stopPlayback(); this.setStatus("idle"); };
      audio.onerror = () => { this.stopPlayback(); this.onError("Audio playback failed."); this.setStatus("idle"); };
      this.setStatus("speaking");
      await audio.play();
    } catch (error) {
      if (this.disposed || generation !== this.generation || request.signal.aborted) return;
      this.stopPlayback();
      this.onError(error instanceof Error ? error.message : "Speech playback failed.");
      this.setStatus("idle");
    }
  }

  stopPlayback(): void {
    this.generation++;
    this.speechRequest?.abort();
    this.speechRequest = null;
    if (this.audio) {
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
    }
    this.audio = null;
    if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
    this.audioUrl = null;
    if (this.status === "speaking") this.setStatus("idle");
  }

  private releaseMicrophone(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.recorder = null;
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    if (this.timer !== null) window.clearTimeout(this.timer);
    if (this.recorder?.state === "recording") this.recorder.stop();
    this.releaseMicrophone();
    this.stopPlayback();
  }
}
