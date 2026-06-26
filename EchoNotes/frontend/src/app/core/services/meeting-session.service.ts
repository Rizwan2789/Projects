import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class MeetingSessionService {
  audioBlob = signal<Blob | null>(null);
  transcript = signal<string>('');
  lastMeetingId = signal<number | null>(null);
}
