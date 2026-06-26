import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class AudioRecorderService {
  private recorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private audioContext: AudioContext | null = null;
  private activeStreams: MediaStream[] = [];

  async startRecording(): Promise<void> {
    this.chunks = [];

    // Step 1: Capture screen + system audio.
    // main.js intercepts this via setDisplayMediaRequestHandler and returns
    // the primary screen with WASAPI loopback audio — no picker needed.
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });
    // Drop the video track — we only need the system audio track.
    displayStream.getVideoTracks().forEach(t => t.stop());

    // Step 2: Open the microphone
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        sampleRate: 48000,
      },
    });

    this.activeStreams = [displayStream, micStream];

    // Step 3: Mix both streams into one using the Web Audio API graph
    this.audioContext = new AudioContext();
    const destination = this.audioContext.createMediaStreamDestination();
    this.audioContext.createMediaStreamSource(displayStream).connect(destination);
    this.audioContext.createMediaStreamSource(micStream).connect(destination);

    // Step 5: Record the mixed stream as WebM/Opus chunks every second
    this.recorder = new MediaRecorder(destination.stream, {
      mimeType: 'audio/webm;codecs=opus',
    });
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start(1000);
  }

  stopRecording(): Promise<Blob> {
    return new Promise((resolve) => {
      if (!this.recorder) {
        resolve(new Blob([], { type: 'audio/webm' }));
        return;
      }
      this.recorder.onstop = () => {
        resolve(new Blob(this.chunks, { type: 'audio/webm' }));
        this.cleanup();
      };
      this.recorder.stop();
    });
  }

  private cleanup(): void {
    this.activeStreams.forEach(s => s.getTracks().forEach(t => t.stop()));
    this.audioContext?.close();
    this.audioContext = null;
    this.activeStreams = [];
    this.chunks = [];
    this.recorder = null;
  }
}
