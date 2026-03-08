export interface SectionKpiItem {
  label: string;
  value: string;
  tone: "primary" | "success" | "warning" | "danger";
  helper?: string;
}

export interface SectionAnnouncementItem {
  id: string;
  title: string;
  description?: string | null;
  eventType: string;
  startsAt: string;
  classroomLabel?: string | null;
}

export interface SectionEventItem {
  id: string;
  title: string;
  eventType: string;
  startsAt: string;
  classroomLabel?: string | null;
}
