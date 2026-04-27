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
import CooperativeSpeedQuizPage from './pages/CooperativeSpeedQuizPage';

const navItems = [
  { to: '/', label: '홈', end: true },
  { to: '/seat', label: '자리 배치' },
  { to: '/role-assignment', label: '역할 배치' },
  { to: '/word-survival', label: '단어 서바이벌(개인전)' },
  { to: '/word-survival-team', label: '단어 서바이벌(팀전)' },
  { to: '/cooperative-speed-quiz', label: '협동 스피드 퀴즈' },
  { to: '/settings', label: '설정' },
];

export default function App() {
  return (
    <div className="min-h-full lg:flex">
      <aside className="border-b border-slate-200 bg-white lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r lg:bg-[linear-gradient(180deg,#fffdf8_0%,#f8fafc_32%,#f8fafc_100%)]">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-4 lg:h-full lg:max-w-none lg:px-4 lg:py-5">
          <div className="rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 text-center shadow-sm">
            <div className="min-w-0">
              <div className="text-[11px] font-black tracking-[0.28em] text-amber-600">CLASSROOM TOOLS</div>
              <Link to="/" className="mt-2 inline-block text-[1.28rem] font-black tracking-[-0.02em] text-slate-900">
                문해력 서바이벌
              </Link>
              <p className="mt-2 text-[13px] leading-5 text-slate-500">
                수업 중 바로 꺼내 쓰기 좋은
                <br className="hidden lg:block" />
                학급 운영 도구 모음
              </p>
            </div>
          </div>

          <nav className="grid grid-cols-2 gap-2 text-sm lg:grid-cols-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `group flex min-h-[48px] items-center justify-center rounded-[1.15rem] px-3 py-2.5 text-center font-semibold leading-tight transition lg:justify-center lg:px-3 ${
                    isActive
                      ? 'bg-slate-900 text-white shadow-[0_14px_30px_rgba(15,23,42,0.16)]'
                      : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900'
                  }`
                }
              >
                <span className="max-w-[9rem]">{item.label}</span>
              </NavLink>
            ))}
          </nav>

          <a
            href="https://www.xn--vz0ba242ncqcba79xhwx.site/"
            target="_blank"
            rel="noreferrer"
            className="hidden overflow-hidden rounded-[1.5rem] border border-amber-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-[0_16px_32px_rgba(245,158,11,0.18)] md:block lg:mt-auto"
            aria-label="끄적끄적 아지트 바로가기"
          >
            <img
              src="/kkeujeok-banner.svg"
              alt="끄적끄적 아지트 - 초등교사가 만든 글쓰기 활동 플랫폼"
              className="block h-auto w-full"
            />
          </a>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <main className="mx-auto w-full max-w-6xl px-4 py-6 pb-28 lg:px-8 lg:py-8 lg:pb-32">
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
            <Route path="/cooperative-speed-quiz" element={<CooperativeSpeedQuizPage />} />
            <Route path="/idiom-battle" element={<IdiomBattlePage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
      <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 text-xs text-slate-500 shadow-[0_-8px_24px_rgba(15,23,42,0.06)] backdrop-blur no-print">
        <div className="mx-auto max-w-7xl px-4 py-2.5">
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center">
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
