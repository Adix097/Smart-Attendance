import { useEffect, useState } from 'react';
import { getAttendanceClasses } from '../api/attendance';
import type { ClassSessionOption } from '../api/types';

export default function useClassSessions() {
  const [classes, setClasses] = useState<ClassSessionOption[]>([]);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    getAttendanceClasses()
      .then(({ classes: availableClasses }) => {
        setClasses(availableClasses);
        setSelectedClassId(availableClasses[0]?.id ?? '');
      })
      .catch((cause) => {
        setError(
          cause instanceof Error ? cause.message : 'Unable to load scheduled classes',
        );
      });
  }, []);

  return {
    classes,
    selectedClassId,
    selectedClass: classes.find((item) => item.id === selectedClassId) ?? null,
    setSelectedClassId,
    error,
  };
}
