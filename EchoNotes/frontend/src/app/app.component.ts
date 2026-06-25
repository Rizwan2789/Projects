import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AudioRecorderService } from './core/services/audio-recorder.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  private recorder = inject(AudioRecorderService);

  isRecording = false;
  hasStopped = false;
  status = 'Ready to record';
  elapsedSeconds = 0;
  savedDuration = '';
  blobSize = '';
  private blob: Blob | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  get formattedTime(): string {
    const m = Math.floor(this.elapsedSeconds / 60).toString().padStart(2, '0');
    const s = (this.elapsedSeconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  async startRec() {
    try {
      this.hasStopped = false;
      this.blob = null;
      this.status = 'Starting — select your screen and enable "Share audio"...';
      await this.recorder.startRecording();
      this.isRecording = true;
      this.elapsedSeconds = 0;
      this.timer = setInterval(() => this.elapsedSeconds++, 1000);
      this.status = '';
    } catch (err: any) {
      this.status = 'Error: ' + err.message;
    }
  }

  async stopRec() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.status = 'Stopping...';
    this.blob = await this.recorder.stopRecording();
    this.isRecording = false;
    this.hasStopped = true;
    this.savedDuration = this.formattedTime;
    this.blobSize = (this.blob.size / 1024).toFixed(1) + ' KB';
    this.status = '';
  }

  saveRecording() {
    if (!this.blob) return;
    const url = URL.createObjectURL(this.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `recording-${this.savedDuration.replace(':', 'm')}s.webm`;
    a.click();
    URL.revokeObjectURL(url);
    this.status = 'Saved to Downloads folder.';
    this.hasStopped = false;
    this.blob = null;
  }

  discardRecording() {
    this.blob = null;
    this.hasStopped = false;
    this.elapsedSeconds = 0;
    this.status = 'Recording discarded. Ready to start again.';
  }
}
