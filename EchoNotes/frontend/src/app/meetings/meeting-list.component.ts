import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
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
  private sanitizer = inject(DomSanitizer);

  meetings: MeetingListItem[] = [];
  expandedId: number | null = null;
  expandedMeeting: Meeting | null = null;
  isLoading = true;
  isLoadingDetail = false;
  error = '';
  confirmDeleteId: number | null = null;
  generatingMinutesId: number | null = null;
  minutesHtmlMap: Record<number, SafeHtml> = {};
  minutesErrorMap: Record<number, string> = {};

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
      next: (detail) => {
        this.expandedMeeting = detail;
        this.isLoadingDetail = false;
        if (detail.minutes && !this.minutesHtmlMap[detail.id]) {
          this.minutesHtmlMap[detail.id] = this.sanitizer.bypassSecurityTrustHtml(
            DOMPurify.sanitize(marked(detail.minutes) as string)
          );
        }
      },
      error: () => { this.isLoadingDetail = false; },
    });
  }

  requestDelete(event: MouseEvent, id: number) {
    event.stopPropagation();
    this.confirmDeleteId = id;
  }

  cancelDelete(event: MouseEvent) {
    event.stopPropagation();
    this.confirmDeleteId = null;
  }

  executeDelete(event: MouseEvent, id: number) {
    event.stopPropagation();
    this.api.deleteMeeting(id).subscribe({
      next: () => {
        this.meetings = this.meetings.filter(m => m.id !== id);
        if (this.expandedId === id) {
          this.expandedId = null;
          this.expandedMeeting = null;
        }
        this.confirmDeleteId = null;
      },
      error: () => { this.confirmDeleteId = null; },
    });
  }

  generateMinutes(event: MouseEvent, id: number) {
    event.stopPropagation();
    this.generatingMinutesId = id;
    this.minutesErrorMap[id] = '';

    this.api.generateMinutes(id).subscribe({
      next: (meeting) => {
        this.minutesHtmlMap[id] = this.sanitizer.bypassSecurityTrustHtml(
          DOMPurify.sanitize(marked(meeting.minutes ?? '') as string)
        );
        const listItem = this.meetings.find(m => m.id === id);
        if (listItem) listItem.has_minutes = true;
        if (this.expandedMeeting?.id === id) {
          this.expandedMeeting = { ...this.expandedMeeting, minutes: meeting.minutes };
        }
        this.generatingMinutesId = null;
      },
      error: (err) => {
        const detail: string = err?.error?.detail ?? err?.message ?? 'Unknown error';
        this.minutesErrorMap[id] = 'Minutes failed: ' + detail;
        this.generatingMinutesId = null;
      },
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
