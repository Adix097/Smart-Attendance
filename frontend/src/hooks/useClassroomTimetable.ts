import { useEffect, useState } from 'react';

import { getClassroomTimetable, getClassrooms } from '../api/timetable';
import type { Classroom, ClassroomTimetable } from '../api/types';

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

export default function useClassroomTimetable() {
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [selectedClassroomId, setSelectedClassroomId] = useState('');
  const [timetable, setTimetable] = useState<ClassroomTimetable | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    getClassrooms()
      .then(({ classrooms: rooms }) => {
        setClassrooms(rooms);
        setSelectedClassroomId(rooms[0]?.id ?? '');
        if (rooms.length === 0) setLoading(false);
      })
      .catch((cause) => {
        setError(message(cause, 'Unable to load classrooms'));
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!selectedClassroomId) return;
    let active = true;
    setLoading(true);
    getClassroomTimetable(selectedClassroomId)
      .then((result) => {
        if (!active) return;
        setTimetable(result);
        setError('');
      })
      .catch((cause) => {
        if (!active) return;
        setTimetable(null);
        setError(message(cause, 'Unable to load the room timetable'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedClassroomId]);

  return {
    classrooms,
    selectedClassroomId,
    setSelectedClassroomId,
    selectedClassroom:
      classrooms.find((room) => room.id === selectedClassroomId) ?? null,
    timetable,
    loading,
    error,
  };
}
