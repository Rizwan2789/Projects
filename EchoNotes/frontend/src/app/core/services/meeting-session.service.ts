import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class MeetingSessionService {
  audioBlob = signal<Blob | null>(null);
  meetingTitle = signal<string>('');
  minutesMarkdown = signal<string>('');
}
