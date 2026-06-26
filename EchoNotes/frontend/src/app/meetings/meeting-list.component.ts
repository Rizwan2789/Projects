import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MeetingApiService } from '../core/services/meeting-api.service';
import { MeetingListItem, Meeting } from '../core/models/meeting.model';

@Component({
  selector: 'app-meeting-list',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './meeting-list.component.html',
})
export class MeetingListComponent implements OnInit {
  private api = inject(MeetingApiService);

  meetings: MeetingListItem[] = [];
  expandedId: number | null = null;
  expandedMeeting: Meeting | null = null;
  isLoading = true;
  isLoadingDetail = false;
  error = '';

  ngOnInit() {
    this.api.listMeetings().subscribe({
      next: (list) => { this.meetings = list; this.isLoading = false; },
      error: () => {
        this.error = 'Could not reach backend. Make sure the Python server is running.';
        this.isLoading = false;
      },
    });
  }

  toggle(meeting: MeetingListItem) {
    if (this.expandedId === meeting.id) {
      this.expandedId = null;
      this.expandedMeeting = null;
      return;
    }
    this.expandedId = meeting.id;
    this.expandedMeeting = null;
    this.isLoadingDetail = true;
    this.api.getMeeting(meeting.id).subscribe({
      next: (detail) => { this.expandedMeeting = detail; this.isLoadingDetail = false; },
      error: () => { this.isLoadingDetail = false; },
    });
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleString();
  }

  formatDuration(s: number): string {
    if (!s) return '—';
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  }
}
