import AttendancePage from './pages/AttendancePage';
import ClassroomTimetablePage from './pages/ClassroomTimetablePage';
import HomePage from './pages/HomePage';

function App() {
  const { pathname } = window.location;
  if (pathname === '/attendance') return <AttendancePage />;
  if (pathname === '/timetable') return <ClassroomTimetablePage />;
  return <HomePage />;
}

export default App;
