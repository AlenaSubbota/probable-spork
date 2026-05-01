// Loading-skeleton для /novel/[id]. Показывается пока SSR-страница ещё
// делает запросы в Supabase (тянет novel + chapters + similar + pace +
// firstChapter и т.д. — на медленной сети до 1-2с до первого байта).
// Без этого пользователь видит белый экран с дефолтным фавиконом.
//
// Скелет повторяет структуру финальной разметки: cover-карточка слева,
// title-блок справа, action-row, chapter-list. CSS-классы взяты из
// globals.css, уже стилизованы как «бумажные» плашки.

export default function NovelLoading() {
  return (
    <main>
      <section className="container">
        <div className="novel-top">
          <div className="cover-large">
            <div
              className="novel-cover skeleton"
              style={{
                aspectRatio: '3/4',
                borderRadius: 'var(--radius)',
                background: 'var(--bg-soft)',
                animation: 'pulse 1.5s ease-in-out infinite',
              }}
            />
          </div>

          <div className="novel-info">
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <span
                className="note skeleton"
                style={{ width: 80, height: 24, background: 'var(--bg-soft)' }}
              />
              <span
                className="note skeleton"
                style={{ width: 100, height: 24, background: 'var(--bg-soft)' }}
              />
            </div>

            <div
              style={{
                width: '70%',
                height: 32,
                background: 'var(--bg-soft)',
                borderRadius: 6,
                marginBottom: 12,
                animation: 'pulse 1.5s ease-in-out infinite',
              }}
            />
            <div
              style={{
                width: '40%',
                height: 18,
                background: 'var(--bg-soft)',
                borderRadius: 6,
                marginBottom: 16,
                opacity: 0.7,
                animation: 'pulse 1.5s ease-in-out infinite',
              }}
            />

            <div className="info-row" style={{ opacity: 0.5 }}>
              <div className="metric">
                <div className="val" style={{ background: 'var(--bg-soft)', borderRadius: 4, height: 24, width: 56 }} />
                <div className="label">оценок</div>
              </div>
              <div className="metric">
                <div className="val" style={{ background: 'var(--bg-soft)', borderRadius: 4, height: 24, width: 32 }} />
                <div className="label">глав</div>
              </div>
              <div className="metric">
                <div className="val" style={{ background: 'var(--bg-soft)', borderRadius: 4, height: 24, width: 48 }} />
                <div className="label">прочтений</div>
              </div>
            </div>

            <div className="actions-row" style={{ marginTop: 24 }}>
              <span
                className="btn btn-primary"
                style={{
                  background: 'var(--bg-soft)',
                  color: 'transparent',
                  pointerEvents: 'none',
                }}
              >
                Загружается…
              </span>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 32, color: 'var(--ink-mute)', fontSize: 13 }}>
          Подгружаем главы…
        </div>
      </section>

      {/* Локально объявляем @keyframes pulse — этот файл может быть
          server component, и inline-style без CSS ничего не оживит.
          Поэтому добавляем минимальный <style> со скоупом-агностиком. */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.7; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </main>
  );
}
