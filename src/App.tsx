import { Link, NavLink, Route, Routes } from 'react-router-dom';
import HomePage from './pages/HomePage';
import ClassDetailPage from './pages/ClassDetailPage';
import SeatHistoryPage from './pages/SeatHistoryPage';
import SeatPage from './pages/SeatPage';
import IdiomBattlePage from './pages/IdiomBattlePage';
import TeamWordSurvivalPage from './pages/TeamWordSurvivalPage';
import RoleAssignmentPage from './pages/RoleAssignmentPage';
import RoleAssignmentHistoryPage from './pages/RoleAssignmentHistoryPage';
import SettingsPage from './pages/SettingsPage';

const navItems = [
  { to: '/', label: '홈', end: true },
  { to: '/seat', label: '자리 배치' },
  { to: '/role-assignment', label: '역할 배치' },
  { to: '/word-survival', label: '단어 서바이벌(개인전)' },
  { to: '/word-survival-team', label: '단어 서바이벌(팀전)' },
  { to: '/settings', label: '설정' },
];

export default function App() {
  return (
    <div className="min-h-full flex flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link to="/" className="shrink-0 text-lg font-bold text-slate-800">
            문해력 서바이벌
          </Link>
          <nav className="min-w-0 overflow-x-auto flex gap-1 text-sm">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-md transition ${
                    isActive
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <a
            href="https://www.xn--vz0ba242ncqcba79xhwx.site/"
            target="_blank"
            rel="noreferrer"
            className="ml-auto shrink-0 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:border-amber-300 hover:bg-amber-100 hover:text-slate-950"
          >
            <span>학급 글쓰기 플랫폼 끄적끄적 아지트</span>
            <span>→</span>
          </a>
        </div>
      </header>
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6 pb-28">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/classes/:classId" element={<ClassDetailPage />} />
          <Route
            path="/classes/:classId/seat-history/:historyId"
            element={<SeatHistoryPage />}
          />
          <Route path="/seat" element={<SeatPage />} />
          <Route path="/role-assignment" element={<RoleAssignmentPage />} />
          <Route
            path="/classes/:classId/role-history/:historyId"
            element={<RoleAssignmentHistoryPage />}
          />
          <Route path="/word-survival" element={<IdiomBattlePage />} />
          <Route path="/word-survival-team" element={<TeamWordSurvivalPage />} />
          <Route path="/idiom-battle" element={<IdiomBattlePage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
      <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 text-xs text-slate-500 shadow-[0_-8px_24px_rgba(15,23,42,0.06)] backdrop-blur no-print">
        <div className="mx-auto max-w-5xl px-4 py-3">
          <div className="space-y-1 text-center">
            <p>
              운영책임자: 유쌤
              <span className="mx-2 text-slate-300">•</span>
              문의:{' '}
              <a className="font-medium text-slate-600 hover:text-slate-900" href="mailto:yshgg@naver.com">
                yshgg@naver.com
              </a>
            </p>
            <p>© 2026 끄적끄적 아지트. All rights reserved.</p>
            <p className="text-[11px] text-slate-400">모든 데이터는 사용자의 브라우저에만 저장됩니다.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
