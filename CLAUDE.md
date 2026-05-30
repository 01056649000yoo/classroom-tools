# classroom-tools

## 활동 페이지 헤더 양식

활동 페이지(`/src/pages/` 의 게임·활동 페이지)는 아래 양식을 반드시 따른다.

### 기준 구조

```tsx
<div className="space-y-6">
  <div>
    <Link to="/" className="text-sm text-slate-500 hover:text-slate-800">
      ← 홈으로
    </Link>
    <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-[240px] flex-1">
        <h1 className="text-2xl font-black text-slate-900">{페이지 제목}</h1>
        <p className="mt-1 text-sm text-slate-500">{한 줄 설명}</p>
      </div>
      {/* 우측 컨트롤 패널 */}
    </div>
  </div>
  {/* 본문 */}
</div>
```

### 규칙 요약

| 요소 | 규칙 |
|------|------|
| 홈 링크 텍스트 | `← 홈으로` |
| 홈 링크 className | `text-sm text-slate-500 hover:text-slate-800` |
| 페이지 제목 | `<h1 className="text-2xl font-black text-slate-900">` |
| 설명 문구 | `<p className="mt-1 text-sm text-slate-500">` |

### 적용 대상 페이지

- `ClassMissionPage.tsx`
- `CooperativeSpeedQuizPage.tsx`
- `IdiomBattlePage.tsx`
- `TeamWordSurvivalPage.tsx`
- `RoleAssignmentPage.tsx`
- 앞으로 추가되는 모든 게임·활동 페이지
