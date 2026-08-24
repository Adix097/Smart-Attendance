import { useEffect, useState } from 'react';
import { getAttendanceClasses } from '../api/attendance';
import type { ClassSessionOption } from '../api/types';

export default function useClassSessions(classroomId?: string) {
  const [classes, setClasses] = useState<ClassSessionOption[]>([]);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    getAttendanceClasses(classroomId)
      .then(({ classes: availableClasses }) => {
        if (!active) return;
        setClasses(availableClasses);
        setSelectedClassId(availableClasses[0]?.id ?? '');
        setError('');
      })
      .catch((cause) => {
        if (!active) return;
        setClasses([]);
        setSelectedClassId('');
        setError(
          cause instanceof Error ? cause.message : 'Unable to load scheduled classes',
        );
      });
    return () => {
      active = false;
    };
  }, [classroomId]);

  return {
    classes,
    selectedClassId,
    selectedClass: classes.find((item) => item.id === selectedClassId) ?? null,
    setSelectedClassId,
    error,
  };
}
