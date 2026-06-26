import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Meeting, MeetingListItem } from '../models/meeting.model';

const BASE = 'http://localhost:8000';

@Injectable({ providedIn: 'root' })
export class MeetingApiService {
  private http = inject(HttpClient);

  transcribe(blob: Blob, title: string, durationS: number): Observable<Meeting> {
    const form = new FormData();
    form.append('file', blob, 'recording.webm');
    form.append('title', title);
    form.append('duration_s', String(durationS));
    return this.http.post<Meeting>(`${BASE}/transcribe`, form);
  }

  listMeetings(): Observable<MeetingListItem[]> {
    return this.http.get<MeetingListItem[]>(`${BASE}/meetings`);
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
