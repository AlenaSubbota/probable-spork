// Loading-skeleton для /novel/[id]/[chapterNum] — страница чтения главы.
// SSR делает download главы из storage (может занять секунду на медленном
// мобильном интернете), плюс auth/access checks. До этого читатель видел
// белый экран. Теперь — короткий «открываем главу…» индикатор.

export default function ChapterLoading() {
  return (
    <div className="reader-page">
      <header className="reader-header">
        <div className="container reader-header-row">
          <span
            className="reader-back"
            style={{
              opacity: 0.5,
              background: 'var(--bg-soft)',
              borderRadius: 4,
              width: 140,
              height: 18,
              display: 'inline-block',
            }}
          />
          <div className="reader-chapter-num" style={{ opacity: 0.5 }}>
            …
          </div>
          <div className="reader-header-spacer" />
        </div>
      </header>

      <main
        className="reader-main"
        style={{
          minHeight: '60vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          color: 'var(--ink-mute)',
        }}
      >
        <div style={{ fontSize: 32, lineHeight: 1, animation: 'spin 1.4s linear infinite' }}>
          📖
        </div>
        <div style={{ fontSize: 14 }}>Открываем главу…</div>
      </main>

      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
