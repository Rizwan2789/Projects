export interface Meeting {
  id: number;
  title: string;
  created_at: string;
  duration_s: number;
  transcript?: string;
  minutes?: string;
}

export interface MeetingListItem {
  id: number;
  title: string;
  created_at: string;
  duration_s: number;
  has_transcript: boolean;
  has_minutes: boolean;
}
