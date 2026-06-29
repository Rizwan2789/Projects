import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Meeting, MeetingListItem } from '../models/meeting.model';

const BASE = 'http://localhost:8000';

export interface TranscribeJobStatus {
  status: 'pending' | 'processing' | 'done' | 'error';
  result: Meeting | null;
  error: string | null;
}

@Injectable({ providedIn: 'root' })
export class MeetingApiService {
  private http = inject(HttpClient);

  transcribe(blob: Blob, title: string, durationS: number, language: string = ''): Observable<{ job_id: string }> {
    const form = new FormData();
    form.append('file', blob, 'recording.webm');
    form.append('title', title);
    form.append('duration_s', String(durationS));
    form.append('language', language);
    return this.http.post<{ job_id: string }>(`${BASE}/transcribe`, form);
  }

  pollJob(jobId: string): Observable<TranscribeJobStatus> {
    return this.http.get<TranscribeJobStatus>(`${BASE}/transcribe/${jobId}`);
  }

  listMeetings(q = ''): Observable<MeetingListItem[]> {
    const url = q ? `${BASE}/meetings?q=${encodeURIComponent(q)}` : `${BASE}/meetings`;
    return this.http.get<MeetingListItem[]>(url);
  }

  updateMeeting(id: number, patch: { title?: string; transcript?: string }): Observable<Meeting> {
    return this.http.patch<Meeting>(`${BASE}/meetings/${id}`, patch);
  }

  getMeeting(id: number): Observable<Meeting> {
    return this.http.get<Meeting>(`${BASE}/meetings/${id}`);
  }

  deleteMeeting(id: number): Observable<void> {
    return this.http.delete<void>(`${BASE}/meetings/${id}`);
  }

  generateMinutes(id: number): Observable<Meeting> {
    return this.http.post<Meeting>(`${BASE}/meetings/${id}/minutes`, {});
  }
}
