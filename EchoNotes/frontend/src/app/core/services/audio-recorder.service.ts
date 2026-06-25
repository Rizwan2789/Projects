import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class AudioRecorderService {
  private recorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private audioContext: AudioContext | null = null;
  private activeStreams: MediaStream[] = [];

  async startRecording(): Promise<void> {
    this.chunks = [];

    // Step 1: Get desktop screen source ID from Electron main process.
    // desktopCapturer is a Node.js API — cannot run inside the sandboxed renderer.
    // preload.js bridges the call safely via contextBridge.
    const sources = await window.electronAPI.getDesktopSources();
    const primarySource = sources[0];

    // Step 2: Open system audio (WASAPI loopback on Windows).
    // Chromium requires a video constraint alongside chromeMediaSourceId —
    // we stop the video track immediately after, keeping only audio.
    const systemStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: primarySource.id,
        },
      } as MediaStreamConstraints['audio'],
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: primarySource.id,
        },
      } as MediaStreamConstraints['video'],
    });
    systemStream.getVideoTracks().forEach(t => t.stop());

    // Step 3: Open the microphone
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        sampleRate: 48000,
      },
    });

    this.activeStreams = [systemStream, micStream];

    // Step 4: Mix both streams into one using the Web Audio API graph
    this.audioContext = new AudioContext();
    const destination = this.audioContext.createMediaStreamDestination();
    this.audioContext.createMediaStreamSource(systemStream).connect(destination);
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
