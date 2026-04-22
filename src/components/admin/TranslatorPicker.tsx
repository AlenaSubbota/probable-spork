'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

interface Candidate {
  id: string;
  user_name: string | null;
  translator_slug: string | null;
  translator_display_name: string | null;
  avatar_url: string | null;
  translator_avatar_url: string | null;
}

export interface TranslatorPickerValue {
  /** Зарегистрированный переводчик */
  translator_id: string | null;
  /** Имя внешнего переводчика (если не зарегистрирован) */
  external_name: string | null;
  /** Опциональная ссылка на профиль внешнего переводчика */
  external_url: string | null;
  /** Галка «имею разрешение» для внешнего */
  external_consent: boolean;
}

interface Props {
  value: TranslatorPickerValue;
  onChange: (next: TranslatorPickerValue) => void;
  /** id текущего user — чтобы быстрый выбор «это я» */
  currentUserId: string | null;
  currentUserName: string | null;
}

// Пикер переводчика для NovelForm.
// Режимы:
//   - registered — выбран существующий юзер из profiles (translator_id)
//   - external   — внешний переводчик текстом (external_name/url)
// Если в поиске никого нет → плашка «Добавить нового».
// Для внешнего — обязательная галка «имею разрешение переводчика».
export default function TranslatorPicker({
  value,
  onChange,
  currentUserId,
  currentUserName,
}: Props) {
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<Candidate | null>(null);
  const [mode, setMode] = useState<'registered' | 'external'>(
    value.external_name ? 'external' : 'registered'
  );
  const debounceRef = useRef<number | null>(null);

  // Если уже выбран зарегистрированный переводчик — подгружаем инфу о нём
  useEffect(() => {
    if (!value.translator_id || picked) return;
    const supabase = createClient();
    supabase
      .from('profiles')
      .select('id, user_name, translator_slug, translator_display_name, avatar_url, translator_avatar_url')
      .eq('id', value.translator_id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setPicked(data as Candidate);
      });
  }, [value.translator_id, picked]);

  // Поиск переводчиков (debounced) когда в режиме registered
  useEffect(() => {
    if (mode !== 'registered' || picked) {
      setCandidates([]);
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      if (query.trim().length < 2) {
        setCandidates([]);
        return;
      }
      setLoading(true);
      const supabase = createClient();
      const pattern = `%${query.replace(/[%_]/g, '\\$&')}%`;
      // Ищем только среди тех, кто уже получил role translator/admin
      const { data } = await supabase
        .from('profiles')
        .select('id, user_name, translator_slug, translator_display_name, avatar_url, translator_avatar_url, role, is_admin')
        .or(`user_name.ilike.${pattern},translator_display_name.ilike.${pattern},translator_slug.ilike.${pattern}`)
        .limit(10);
      const rows = (data ?? []).filter(
        (r: { role?: string; is_admin?: boolean }) =>
          r.is_admin === true || r.role === 'translator' || r.role === 'admin'
      );
      setCandidates(rows as Candidate[]);
      setLoading(false);
    }, 220);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query, mode, picked]);

  const displayName = (c: Candidate) =>
    c.translator_display_name || c.user_name || 'Переводчик';

  const pick = (c: Candidate) => {
    setPicked(c);
    setQuery('');
    setCandidates([]);
    onChange({
      translator_id: c.id,
      external_name: null,
      external_url: null,
      external_consent: false,
    });
  };

  const clear = () => {
    setPicked(null);
    onChange({
      translator_id: null,
      external_name: null,
      external_url: null,
      external_consent: false,
    });
  };

  const switchToExternal = (startWith?: string) => {
    setMode('external');
    setPicked(null);
    onChange({
      translator_id: null,
      external_name: startWith ?? query,
      external_url: null,
      external_consent: false,
    });
    setQuery('');
  };

  const switchToRegistered = () => {
    setMode('registered');
    onChange({
      translator_id: null,
      external_name: null,
      external_url: null,
      external_consent: false,
    });
  };

  const pickMe = () => {
    if (!currentUserId) return;
    const me: Candidate = {
      id: currentUserId,
      user_name: currentUserName,
      translator_slug: null,
      translator_display_name: null,
      avatar_url: null,
      translator_avatar_url: null,
    };
    pick(me);
  };

  // --- UI --- //
  return (
    <div className="translator-picker">
      {mode === 'registered' && picked && (
        <div className="translator-picked">
          <div className="translator-picked-avatar">
            {picked.translator_avatar_url || picked.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={picked.translator_avatar_url || picked.avatar_url || ''}
                alt=""
              />
            ) : (
              <span>{displayName(picked).charAt(0).toUpperCase()}</span>
            )}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>{displayName(picked)}</div>
            {picked.translator_slug && (
              <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
                /t/{picked.translator_slug}
              </div>
            )}
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={clear}
            style={{ height: 32 }}
          >
            Сменить
          </button>
        </div>
      )}

      {mode === 'registered' && !picked && (
        <>
          <input
            className="form-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Начни печатать ник или имя переводчика…"
          />
          <div className="translator-quick">
            {currentUserId && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={pickMe}
                style={{ height: 30, fontSize: 12 }}
              >
                Это я ({currentUserName ?? 'без ника'})
              </button>
            )}
          </div>

          {loading && (
            <div className="translator-search-info">Ищем…</div>
          )}

          {!loading && candidates.length > 0 && (
            <div className="translator-search-results">
              {candidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="translator-search-item"
                  onClick={() => pick(c)}
                >
                  <div className="translator-search-avatar">
                    {c.translator_avatar_url || c.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.translator_avatar_url || c.avatar_url || ''}
                        alt=""
                      />
                    ) : (
                      <span>{displayName(c).charAt(0).toUpperCase()}</span>
                    )}
                  </div>
                  <div>
                    <div className="translator-search-name">
                      {displayName(c)}
                    </div>
                    {c.translator_slug && (
                      <div className="translator-search-slug">
                        @{c.translator_slug}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          {!loading && query.trim().length >= 2 && candidates.length === 0 && (
            <div className="translator-empty">
              <p style={{ margin: 0, fontSize: 13 }}>
                Нет такого переводчика в системе.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => switchToExternal(query)}
                style={{ marginTop: 8, height: 34 }}
              >
                + Добавить «{query}» как внешнего переводчика
              </button>
            </div>
          )}
        </>
      )}

      {mode === 'external' && (
        <div className="translator-external">
          <div className="form-field">
            <label>Имя / ник переводчика</label>
            <input
              className="form-input"
              value={value.external_name ?? ''}
              onChange={(e) =>
                onChange({ ...value, external_name: e.target.value || null })
              }
              placeholder="Например, «Wick HDL» или «Алина К.»"
              maxLength={120}
            />
          </div>
          <div className="form-field">
            <label title="Куда вести читателя, если он захочет узнать больше. Telegram-канал, Boosty, сайт — любая ссылка.">
              Ссылка на переводчика (необязательно)
            </label>
            <input
              type="url"
              className="form-input"
              value={value.external_url ?? ''}
              onChange={(e) =>
                onChange({ ...value, external_url: e.target.value || null })
              }
              placeholder="https://t.me/… или Boosty / сайт"
            />
          </div>

          <div className="translator-consent">
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <input
                type="checkbox"
                checked={value.external_consent}
                onChange={(e) =>
                  onChange({ ...value, external_consent: e.target.checked })
                }
              />
              <span style={{ fontSize: 13, lineHeight: 1.45 }}>
                Я подтверждаю, что <strong>у меня есть разрешение переводчика</strong>{' '}
                публиковать его работу. Если переводчик зарегистрируется сам —
                он сможет забрать новеллу себе через заявку «Это моя работа»,
                и она отображается в его профиле.
              </span>
            </label>
          </div>

          <button
            type="button"
            className="btn btn-ghost"
            onClick={switchToRegistered}
            style={{ height: 30, fontSize: 12, marginTop: 8 }}
          >
            ← Выбрать из зарегистрированных
          </button>
        </div>
      )}
    </div>
  );
}
