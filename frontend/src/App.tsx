import AttendancePage from './pages/AttendancePage';
import HomePage from './pages/HomePage';

function App() {
  return window.location.pathname === '/attendance' ? <AttendancePage /> : <HomePage />;
}

export default App;
