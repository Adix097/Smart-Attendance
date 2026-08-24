import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import AttendancePage from './pages/AttendancePage';
import ClassroomTimetablePage from './pages/ClassroomTimetablePage';
import HomePage from './pages/HomePage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/attendance" element={<AttendancePage />} />
        <Route path="/timetable" element={<ClassroomTimetablePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
