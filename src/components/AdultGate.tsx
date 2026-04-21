'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';

interface Props {
  novelTitle: string;
  // id для localStorage-ключа; обычно novel.firebase_id или общий 'adult'
  scope: string;
}

const STORAGE_KEY = 'chaptify-adult-confirmed';

// Показывает модальное окно подтверждения 18+ при первом входе на страницу
// с 18+ контентом. Запоминает в localStorage + в profile.settings через RPC,
// чтобы не спрашивать повторно.
export default function AdultGate({ novelTitle, scope }: Props) {
  const [show, setShow] = useState(false);
  const [forever, setForever] = useState(true);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          allScopes?: boolean;
          scopes?: Record<string, number>;
        };
        if (parsed.allScopes) return;
        if (parsed.scopes?.[scope]) return;
      }
    } catch {}
    // Если локально не подтверждал — блокируем
    setShow(true);
    // Блокируем скролл на фоне
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [scope]);

  const confirm = async () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw
        ? (JSON.parse(raw) as { allScopes?: boolean; scopes?: Record<string, number> })
        : {};
      if (forever) {
        parsed.allScopes = true;
      } else {
        parsed.scopes = { ...(parsed.scopes ?? {}), [scope]: Date.now() };
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    } catch {}

    // Плюс синхронизируем с профилем, если юзер залогинен
    if (forever) {
      try {
        const supabase = createClient();
        await supabase.rpc('update_my_settings', {
          data_to_update: { settings: { adult_confirmed_at: new Date().toISOString() } },
        });
      } catch {
        // не критично
      }
    }

    document.body.style.overflow = '';
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="adult-gate">
      <div className="adult-gate-card">
        <div className="adult-gate-badge">18+</div>
        <h2>Контент для взрослых</h2>
        <p className="adult-gate-title">«{novelTitle}»</p>
        <p className="adult-gate-body">
          Эта новелла содержит сцены сексуального характера, ненормативную лексику или
          жестокие темы, предназначенные только для взрослой аудитории.
        </p>
        <p className="adult-gate-body">
          Подтверждая, ты заявляешь, что <b>тебе есть 18 лет</b>, и берёшь
          ответственность за просмотр этого контента. Если ты несовершеннолетний_яя —
          пожалуйста, закрой эту страницу.
        </p>

        <label className="adult-gate-check">
          <input
            type="checkbox"
            checked={forever}
            onChange={(e) => setForever(e.target.checked)}
          />
          <span>
            Больше не спрашивать на этом сайте.{' '}
            <span className="adult-gate-hint">
              (иначе спросим только на новых новеллах)
            </span>
          </span>
        </label>

        <div className="adult-gate-actions">
          <Link href="/" className="btn btn-ghost">
            Я младше 18 — закрыть
          </Link>
          <button
            type="button"
            className="btn btn-primary"
            onClick={confirm}
          >
            Мне есть 18 — продолжить
          </button>
        </div>
      </div>
    </div>
  );
}
