'use client';

import {
  FONT_OPTIONS,
  LIMITS,
  READER_THEMES,
  READ_MODES,
  type ReadMode,
  SLEEP_TIMER_PRESETS,
  type FontFamilyKey,
  type ReaderSettings,
  type ReaderTheme,
  type TextAlign,
} from '@/lib/reader';

interface Props {
  open: boolean;
  settings: ReaderSettings;
  onChange: (next: ReaderSettings) => void;
  onClose: () => void;
  selectedPreset: number | null;     // какой пресет выбран (для подсветки)
  sleepMinLeft: number | null;       // осталось минут (для подписи), null = выключен
  onSleepTimerSet: (min: number | null) => void;
}

export default function ReaderSettings({
  open,
  settings,
  onChange,
  onClose,
  selectedPreset,
  sleepMinLeft,
  onSleepTimerSet,
}: Props) {
  if (!open) return null;

  const set = <K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) => {
    onChange({ ...settings, [key]: value });
  };

  const bumpNumber = (
    key: 'fontSize' | 'lineHeight' | 'textIndent' | 'paragraphSpacing',
    delta: number
  ) => {
    const { min, max } = LIMITS[key];
    const current = settings[key] as number;
    const next = Math.max(min, Math.min(max, parseFloat((current + delta).toFixed(2))));
    set(key, next as ReaderSettings[typeof key]);
  };

  return (
    <>
      <div className="reader-settings-backdrop" onClick={onClose} />
      <aside className="reader-settings-panel" role="dialog" aria-label="Настройки чтения">
        <div className="reader-settings-head">
          <h3>Настройки чтения</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>

        <div className="reader-settings-body">
          {/* Тема */}
          <div className="rs-group">
            <label className="rs-label">Тема</label>
            <div className="reader-theme-row">
              {READER_THEMES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={`reader-theme-btn${
                    (settings.theme ?? 'light') === t.key ? ' is-active' : ''
                  }`}
                  onClick={() => set('theme', t.key as ReaderTheme)}
                >
                  <span className={`reader-theme-swatch reader-theme-swatch--${t.key}`}>
                    Aa
                  </span>
                  <span className="reader-theme-label">{t.label}</span>
                  <span className="reader-theme-desc">{t.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Режим чтения (свиток / страницы) */}
          <div className="rs-group">
            <label className="rs-label">Режим чтения</label>
            <div className="rs-pair">
              {READ_MODES.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  className={`chip${
                    (settings.readMode ?? 'scroll') === m.key ? ' active' : ''
                  }`}
                  onClick={() => set('readMode', m.key as ReadMode)}
                  title={m.desc}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Шрифт */}
          <div className="rs-group">
            <label className="rs-label">Шрифт</label>
            <div className="rs-font-grid">
              {FONT_OPTIONS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={`rs-font-btn${settings.fontFamily === f.key ? ' active' : ''}`}
                  style={{ fontFamily: f.css }}
                  onClick={() => set('fontFamily', f.key as FontFamilyKey)}
                  title={f.description}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Размер */}
          <div className="rs-group">
            <label className="rs-label">
              Размер <span className="rs-val">{settings.fontSize}px</span>
            </label>
            <div className="rs-stepper">
              <button type="button" className="chip" onClick={() => bumpNumber('fontSize', -1)}>
                A−
              </button>
              <button type="button" className="chip" onClick={() => bumpNumber('fontSize', +1)}>
                A+
              </button>
            </div>
          </div>

          {/* Межстрочный интервал */}
          <div className="rs-group">
            <label className="rs-label">
              Межстрочный интервал <span className="rs-val">{settings.lineHeight.toFixed(1)}</span>
            </label>
            <div className="rs-stepper">
              <button type="button" className="chip" onClick={() => bumpNumber('lineHeight', -0.1)}>
                −
              </button>
              <button type="button" className="chip" onClick={() => bumpNumber('lineHeight', +0.1)}>
                +
              </button>
            </div>
          </div>

          {/* Выравнивание */}
          <div className="rs-group">
            <label className="rs-label">Выравнивание</label>
            <div className="rs-pair">
              {(['left', 'justify'] as TextAlign[]).map((a) => (
                <button
                  key={a}
                  type="button"
                  className={`chip${settings.textAlign === a ? ' active' : ''}`}
                  onClick={() => set('textAlign', a)}
                >
                  {a === 'left' ? 'По левому' : 'По ширине'}
                </button>
              ))}
            </div>
          </div>

          {/* Красная строка */}
          <div className="rs-group">
            <label className="rs-label">
              Красная строка <span className="rs-val">{settings.textIndent.toFixed(1)} em</span>
            </label>
            <div className="rs-stepper">
              <button type="button" className="chip" onClick={() => bumpNumber('textIndent', -0.5)}>
                −
              </button>
              <button type="button" className="chip" onClick={() => bumpNumber('textIndent', +0.5)}>
                +
              </button>
            </div>
          </div>

          {/* Отступ между абзацами */}
          <div className="rs-group">
            <label className="rs-label">
              Отступ абзацев <span className="rs-val">{settings.paragraphSpacing.toFixed(1)} em</span>
            </label>
            <div className="rs-stepper">
              <button
                type="button"
                className="chip"
                onClick={() => bumpNumber('paragraphSpacing', -0.1)}
              >
                −
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => bumpNumber('paragraphSpacing', +0.1)}
              >
                +
              </button>
            </div>
          </div>

          <div className="rs-divider" />

          {/* Киллер #1: Фокус-режим */}
          <div className="rs-group">
            <label className="rs-switch">
              <input
                type="checkbox"
                checked={settings.focusMode}
                onChange={(e) => set('focusMode', e.target.checked)}
              />
              <div>
                <div className="rs-switch-title">Фокус-режим</div>
                <div className="rs-switch-sub">Затемняет всё, кроме абзаца, который ты читаешь</div>
              </div>
            </label>
          </div>

          {/* Киллер #3: Таймер сна */}
          <div className="rs-group">
            <label className="rs-label">Таймер сна</label>
            <div className="rs-pair">
              <button
                type="button"
                className={`chip${selectedPreset === null ? ' active' : ''}`}
                onClick={() => onSleepTimerSet(null)}
              >
                Выкл
              </button>
              {SLEEP_TIMER_PRESETS.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`chip${selectedPreset === m ? ' active' : ''}`}
                  onClick={() => onSleepTimerSet(m)}
                >
                  {m} мин
                </button>
              ))}
            </div>
            {selectedPreset !== null && sleepMinLeft !== null && sleepMinLeft > 0 && (
              <div className="rs-timer-sub">
                Остановимся через {sleepMinLeft} мин.
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
