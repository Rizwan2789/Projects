import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CommonModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit {
  private http = inject(HttpClient);

  overlayVisible = true;
  backendReady = false;
  startupMessage = 'Starting EchoNotes…';
  startupError = '';
  private pollAttempts = 0;
  private modelWaitAttempts = 0;

  ngOnInit() {
    this.poll();
  }

  private poll() {
    this.http.get<{ status: string; whisper_ready: boolean; whisper_failed: boolean }>(
      'http://localhost:8000/health'
    ).subscribe({
      next: (res) => {
        if (res.whisper_failed) {
          this.startupError = 'Speech model failed to load. Check the terminal for details.';
          return;
        }
        if (res.whisper_ready) {
          this.backendReady = true;
          setTimeout(() => { this.overlayVisible = false; }, 600);
        } else {
          this.modelWaitAttempts++;
          if (this.modelWaitAttempts > 200) {
            this.startupError = 'Speech model is taking too long. Check the terminal for errors.';
            return;
          }
          this.startupMessage = 'Loading speech recognition model…';
          setTimeout(() => this.poll(), 1500);
        }
      },
      error: () => {
        this.pollAttempts++;
        if (this.pollAttempts <= 3) {
          this.startupMessage = 'Starting backend services…';
        } else if (this.pollAttempts <= 10) {
          this.startupMessage = 'Connecting to backend…';
        } else {
          this.startupMessage = 'Taking a bit longer than usual…';
        }
        setTimeout(() => this.poll(), 1500);
      },
    });
  }
}
