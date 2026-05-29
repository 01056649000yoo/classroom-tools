import { useEffect, useState } from 'react';
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
import ClassMissionPage from './pages/ClassMissionPage';

declare const __APP_COMMIT__: string;

const navItems = [
  { to: '/', label: '홈', end: true },
  { to: '/seat', label: '자리 배치' },
  { to: '/role-assignment', label: '역할 배치' },
  { to: '/word-survival', label: '단어 서바이벌(개인전)' },
  { to: '/word-survival-team', label: '단어 서바이벌(팀전)' },
  { to: '/cooperative-speed-quiz', label: '협동 스피드 퀴즈' },
  { to: '/class-mission', label: '학급 공동 미션' },
  { to: '/settings', label: '설정' },
];

export default function App() {
  const [helpOpen, setHelpOpen] = useState(false);
  const [commitHash, setCommitHash] = useState(__APP_COMMIT__);

  useEffect(() => {
    const isLocalDevServer =
      typeof window !== 'undefined' &&
      ['localhost', '127.0.0.1'].includes(window.location.hostname) &&
      window.location.port === '5173';

    if (!isLocalDevServer) {
      return;
    }

    let cancelled = false;

    const syncCommitHash = async () => {
      try {
        const response = await fetch('/__app_commit', { cache: 'no-store' });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as { commit?: string };

        if (!cancelled && payload.commit) {
          setCommitHash(payload.commit);
        }
      } catch {
        // Keep the build-time hash when the dev endpoint is unavailable.
      }
    };

    void syncCommitHash();

    const interval = window.setInterval(() => {
      void syncCommitHash();
    }, 10000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

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
                초등 문해력
                <br className="hidden lg:block" />
                수업 도구 모음
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

          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="rounded-[1.2rem] border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-white hover:text-slate-900"
          >
            이 앱 사용법 보기
          </button>

          <a
            href="https://www.xn--vz0ba242ncqcba79xhwx.site/"
            target="_blank"
            rel="noreferrer"
            className="mt-2 hidden overflow-hidden rounded-[1.5rem] border border-amber-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-[0_16px_32px_rgba(245,158,11,0.18)] md:block lg:mt-5"
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
            <Route path="/class-mission" element={<ClassMissionPage />} />
            <Route path="/idiom-battle" element={<IdiomBattlePage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
      <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 text-xs text-slate-500 shadow-[0_-8px_24px_rgba(15,23,42,0.06)] backdrop-blur no-print">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-2.5 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center md:justify-start md:text-left">
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
          <div className="flex justify-center md:justify-end">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-[11px] text-slate-500">
              commit {commitHash}
            </span>
          </div>
        </div>
      </footer>

      {helpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="사용법 닫기"
            onClick={() => setHelpOpen(false)}
            className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
          />
          <div className="relative flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-5 py-4 md:px-7">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-black tracking-[0.28em] text-amber-600">GUIDE</div>
                  <h2 className="mt-2 text-2xl font-black text-slate-900">문해력 서바이벌 사용법</h2>
                  <p className="mt-2 text-sm text-slate-500">
                    자리배치 결과를 바탕으로 역할 배치와 게임을 이어서 운영하는 흐름입니다.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setHelpOpen(false)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  닫기
                </button>
              </div>
            </div>

            <div className="overflow-y-auto px-5 py-5 md:px-7 md:py-6">
              <div className="grid gap-4 md:grid-cols-2">
                <section className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                  <h3 className="text-lg font-black text-slate-900">1. 자리배치</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    학급을 만든 뒤 학생 명단을 불러오고 자리배치를 실행합니다. 최근 자리배치 결과는 이후
                    역할 배치, 팀전, 협동 스피드 퀴즈에서 공통 기준으로 사용됩니다.
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    특히 좌우로 붙어 있는 짝 정보가 저장되므로 팀 활동을 할 때 바로 활용할 수 있습니다.
                  </p>
                </section>

                <section className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                  <h3 className="text-lg font-black text-slate-900">2. 역할 배치</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    자리배치에 등록된 학급 학생을 바탕으로 발표, 기록, 준비물, 정리 같은 역할을 무작위로
                    배정합니다.
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    역할 수와 인원을 맞춰 두면 자동으로 배정되고, 결과는 기록으로 남겨 다시 확인할 수 있습니다.
                  </p>
                </section>

                <section className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm md:col-span-2">
                  <h3 className="text-lg font-black text-slate-900">3. 자리배치 결과를 활용하는 게임들</h3>
                  <div className="mt-3 grid gap-3 lg:grid-cols-3">
                    <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4">
                      <div className="text-base font-black text-slate-900">단어 서바이벌 개인전</div>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        선택한 학급의 학생 전체를 대상으로 개인 토너먼트를 진행합니다. 자리배치 짝을 직접
                        쓰지는 않지만, 같은 학급 명단과 기록 흐름을 이어서 활용합니다.
                      </p>
                    </div>
                    <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4">
                      <div className="text-base font-black text-slate-900">단어 서바이벌 팀전</div>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        최근 자리배치의 좌우 짝을 한 팀으로 묶어 대결합니다. 그래서 팀전을 하기 전에는 먼저
                        자리배치를 실행해 두는 것이 좋습니다.
                      </p>
                      <p className="mt-2 text-sm leading-6 font-semibold text-slate-700">
                        팀 활동은 최근 자리배치 결과가 있어야 시작할 수 있습니다.
                      </p>
                    </div>
                    <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4">
                      <div className="text-base font-black text-slate-900">협동 스피드 퀴즈</div>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        최근 자리배치의 짝을 그대로 팀으로 사용합니다. 한 명은 설명하고 한 명은 화면을 보지
                        않은 채 답을 맞히며, 제한시간 안에 맞힌 문제 수로 순위를 정합니다.
                      </p>
                      <p className="mt-2 text-sm leading-6 font-semibold text-slate-700">
                        협동 스피드 퀴즈도 자리배치를 먼저 저장해야 팀이 만들어집니다.
                      </p>
                    </div>
                  </div>
                </section>

                <section className="rounded-[1.5rem] border border-amber-200 bg-amber-50 p-4 md:col-span-2">
                  <h3 className="text-lg font-black text-slate-900">추천 운영 순서</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-700">
                    학급 만들기 → 자리배치 실행 → 필요하면 역할 배치 실행 → 개인전 또는 팀전 진행 →
                    협동 스피드 퀴즈로 짝 활동 마무리.
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-700">
                    팀전과 협동 스피드 퀴즈는 최근 자리배치 결과를 바로 사용하므로, 자리를 새로 바꿨다면
                    게임 시작 전에 자리배치를 한 번 더 저장해 두면 가장 자연스럽게 연결됩니다.
                  </p>
                </section>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
