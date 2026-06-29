import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { AudioRecorderService } from '../core/services/audio-recorder.service';
import { MeetingApiService } from '../core/services/meeting-api.service';
import { MeetingSessionService } from '../core/services/meeting-session.service';

const LANGUAGES = [
  { code: '',   label: 'Auto-detect' },
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'es', label: 'Spanish' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ar', label: 'Arabic' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ur', label: 'Urdu' },
];

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
  private sanitizer = inject(DomSanitizer);

  readonly languages = LANGUAGES;

  isRecording = false;
  hasStopped = false;
  isTranscribing = false;
  isGeneratingMinutes = false;
  minutesHtml: SafeHtml | null = null;
  status = '';
  elapsedSeconds = 0;
  savedDuration = '';
  blobSize = '';
  meetingTitle = '';
  selectedLanguage = '';
  copiedTranscript = false;
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

    this.api.transcribe(this.blob, this.meetingTitle, this.elapsedSeconds, this.selectedLanguage).subscribe({
      next: ({ job_id }) => {
        this._pollForResult(job_id);
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

  private _pollForResult(jobId: string) {
    this.api.pollJob(jobId).subscribe({
      next: (job) => {
        if (job.status === 'done' && job.result) {
          this.session.transcript.set(job.result.transcript ?? '');
          this.session.lastMeetingId.set(job.result.id);
          this.isTranscribing = false;
        } else if (job.status === 'error') {
          this.status = 'Transcription failed: ' + (job.error ?? 'Unknown error');
          this.hasStopped = true;
          this.isTranscribing = false;
        } else {
          setTimeout(() => this._pollForResult(jobId), 2000);
        }
      },
      error: (err) => {
        const msg: string = err?.error?.detail ?? err?.message ?? 'Unknown error';
        this.status = 'Transcription failed: ' + msg;
        this.hasStopped = true;
        this.isTranscribing = false;
      },
    });
  }

  generateMinutes() {
    const id = this.session.lastMeetingId();
    if (!id) return;
    this.isGeneratingMinutes = true;
    this.minutesHtml = null;
    this.status = '';

    this.api.generateMinutes(id).subscribe({
      next: (meeting) => {
        this.minutesHtml = this.sanitizer.bypassSecurityTrustHtml(
          DOMPurify.sanitize(marked(meeting.minutes ?? '') as string)
        );
        this.isGeneratingMinutes = false;
      },
      error: (err) => {
        const detail: string = err?.error?.detail ?? err?.message ?? 'Unknown error';
        this.status = 'Minutes failed: ' + detail;
        this.isGeneratingMinutes = false;
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

  copyTranscript() {
    if (!this.transcript) return;
    navigator.clipboard.writeText(this.transcript).then(() => {
      this.copiedTranscript = true;
      setTimeout(() => { this.copiedTranscript = false; }, 2000);
    });
  }

  startNew() {
    this.blob = null;
    this.hasStopped = false;
    this.isTranscribing = false;
    this.isGeneratingMinutes = false;
    this.minutesHtml = null;
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
