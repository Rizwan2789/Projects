import { Routes } from '@angular/router';
import { RecordComponent } from './record/record.component';
import { MeetingListComponent } from './meetings/meeting-list.component';

export const routes: Routes = [
  { path: '',         component: RecordComponent },
  { path: 'meetings', component: MeetingListComponent },
];
