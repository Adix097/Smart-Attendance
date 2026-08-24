import { request } from './client';
import type { Classroom, ClassroomTimetable } from './types';

export function getClassrooms() {
  return request<{ classrooms: Classroom[] }>('/classrooms');
}

export function getClassroomTimetable(classroomId: string) {
  return request<ClassroomTimetable>(
    `/classrooms/${encodeURIComponent(classroomId)}/timetable`,
  );
}
