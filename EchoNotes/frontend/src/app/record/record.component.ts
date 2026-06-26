import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AudioRecorderService } from '../core/services/audio-recorder.service';
import { MeetingApiService } from '../core/services/meeting-api.service';
import { MeetingSessionService } from '../core/services/meeting-session.service';

@Component({
  selector: 'app-record',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './record.component.html',
})
export class RecordComponent {
  private recorder = inject(AudioRecorderService);
  private api = inject(MeetingApiService);
  private session = inject(MeetingSessionService);

  isRecording = false;
  hasStopped = false;
  isTranscribing = false;
  status = '';
  elapsedSeconds = 0;
  savedDuration = '';
  blobSize = '';
  meetingTitle = '';
  private blob: Blob | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  get formattedTime(): string {
    const m = Math.floor(this.elapsedSeconds / 60).toString().padStart(2, '0');
    const s = (this.elapsedSeconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  get transcript(): string {
    return this.session.transcript();
  }

  async startRec() {
    try {
      this.hasStopped = false;
      this.blob = null;
      this.session.transcript.set('');
      this.session.lastMeetingId.set(null);
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
    this.session.audioBlob.set(this.blob);
    this.isRecording = false;
    this.hasStopped = true;
    this.savedDuration = this.formattedTime;
    this.blobSize = (this.blob.size / 1024).toFixed(1) + ' KB';
    this.status = '';
  }

  transcribeRec() {
    if (!this.blob) return;
    this.hasStopped = false;
    this.isTranscribing = true;
    this.status = '';

    this.api.transcribe(this.blob, this.meetingTitle, this.elapsedSeconds).subscribe({
      next: (meeting) => {
        this.session.transcript.set(meeting.transcript ?? '');
        this.session.lastMeetingId.set(meeting.id);
        this.isTranscribing = false;
      },
      error: (err) => {
        const msg: string = err?.error?.detail ?? err?.message ?? 'Unknown error';
        this.status = msg.includes('fetch') || err.status === 0
          ? 'Backend is not ready yet. Please wait a few seconds and try again.'
          : 'Transcription failed: ' + msg;
        this.hasStopped = true;
        this.isTranscribing = false;
      },
    });
  }

  discardRecording() {
    this.blob = null;
    this.hasStopped = false;
    this.elapsedSeconds = 0;
    this.session.audioBlob.set(null);
    this.session.transcript.set('');
    this.status = 'Recording discarded.';
  }

  startNew() {
    this.blob = null;
    this.hasStopped = false;
    this.isTranscribing = false;
    this.elapsedSeconds = 0;
    this.savedDuration = '';
    this.blobSize = '';
    this.meetingTitle = '';
    this.session.audioBlob.set(null);
    this.session.transcript.set('');
    this.session.lastMeetingId.set(null);
    this.status = '';
  }
}
