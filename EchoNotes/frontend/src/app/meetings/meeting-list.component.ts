import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { MeetingApiService } from '../core/services/meeting-api.service';
import { MeetingListItem, Meeting } from '../core/models/meeting.model';

@Component({
  selector: 'app-meeting-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './meeting-list.component.html',
})
export class MeetingListComponent implements OnInit, OnDestroy {
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

  // Search
  searchQuery = '';
  private searchSubject = new Subject<string>();
  private searchSub?: Subscription;

  // Inline title edit
  editingTitleId: number | null = null;
  editingTitleValue = '';

  // Inline transcript edit
  editingTranscriptId: number | null = null;
  editingTranscriptValue = '';
  isSavingTranscript = false;

  // Copy feedback
  copiedMap: Record<string, boolean> = {};

  ngOnInit() {
    this.loadMeetings('');
    this.searchSub = this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(q => this.api.listMeetings(q)),
    ).subscribe({
      next: (list) => { this.meetings = list; this.isLoading = false; },
      error: () => { this.error = 'Search failed.'; this.isLoading = false; },
    });
  }

  ngOnDestroy() {
    this.searchSub?.unsubscribe();
  }

  onSearch() {
    this.isLoading = true;
    this.searchSubject.next(this.searchQuery);
  }

  private loadMeetings(q: string) {
    this.isLoading = true;
    this.api.listMeetings(q).subscribe({
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
      this.editingTranscriptId = null;
      return;
    }
    this.expandedId = meeting.id;
    this.expandedMeeting = null;
    this.editingTranscriptId = null;
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

  // ── Title edit ────────────────────────────────────────────────────────────

  startTitleEdit(event: MouseEvent, m: MeetingListItem) {
    event.stopPropagation();
    this.editingTitleId = m.id;
    this.editingTitleValue = m.title || '';
  }

  saveTitleEdit(m: MeetingListItem) {
    const newTitle = this.editingTitleValue.trim();
    this.editingTitleId = null;
    if (!newTitle || newTitle === m.title) return;
    this.api.updateMeeting(m.id, { title: newTitle }).subscribe({
      next: () => { m.title = newTitle; },
    });
  }

  cancelTitleEdit() {
    this.editingTitleId = null;
  }

  // ── Transcript edit ───────────────────────────────────────────────────────

  startTranscriptEdit(event: MouseEvent) {
    event.stopPropagation();
    if (!this.expandedMeeting) return;
    this.editingTranscriptId = this.expandedMeeting.id;
    this.editingTranscriptValue = this.expandedMeeting.transcript ?? '';
  }

  saveTranscriptEdit(event: MouseEvent) {
    event.stopPropagation();
    if (!this.expandedMeeting) return;
    const id = this.expandedMeeting.id;
    this.isSavingTranscript = true;
    this.api.updateMeeting(id, { transcript: this.editingTranscriptValue }).subscribe({
      next: (updated) => {
        if (this.expandedMeeting) {
          this.expandedMeeting = { ...this.expandedMeeting, transcript: updated.transcript ?? '', minutes: updated.minutes ?? undefined };
        }
        // Invalidate minutes HTML since transcript changed
        delete this.minutesHtmlMap[id];
        const listItem = this.meetings.find(m => m.id === id);
        if (listItem) listItem.has_minutes = false;
        this.editingTranscriptId = null;
        this.isSavingTranscript = false;
      },
      error: () => { this.isSavingTranscript = false; },
    });
  }

  cancelTranscriptEdit(event: MouseEvent) {
    event.stopPropagation();
    this.editingTranscriptId = null;
  }

  // ── Copy & Export ─────────────────────────────────────────────────────────

  copyTranscript(event: MouseEvent) {
    event.stopPropagation();
    if (!this.expandedMeeting?.transcript) return;
    navigator.clipboard.writeText(this.expandedMeeting.transcript).then(() => {
      this.copiedMap['transcript'] = true;
      setTimeout(() => { this.copiedMap['transcript'] = false; }, 2000);
    });
  }

  copyMinutes(event: MouseEvent) {
    event.stopPropagation();
    if (!this.expandedMeeting?.minutes) return;
    navigator.clipboard.writeText(this.expandedMeeting.minutes).then(() => {
      this.copiedMap['minutes'] = true;
      setTimeout(() => { this.copiedMap['minutes'] = false; }, 2000);
    });
  }

  downloadTxt(event: MouseEvent, type: 'transcript' | 'minutes') {
    event.stopPropagation();
    if (!this.expandedMeeting) return;
    const content = type === 'transcript' ? this.expandedMeeting.transcript : this.expandedMeeting.minutes;
    if (!content) return;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = (this.expandedMeeting.title || 'meeting').replace(/[^a-z0-9]/gi, '_');
    a.href = url;
    a.download = `${safeName}_${type}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Delete ────────────────────────────────────────────────────────────────

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

  // ── Minutes ───────────────────────────────────────────────────────────────

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

  // ── Helpers ───────────────────────────────────────────────────────────────

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
