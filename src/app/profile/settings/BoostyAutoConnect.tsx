'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useToasts, ToastStack } from '@/components/ui/Toast';

const AUTH_API_URL = process.env.NEXT_PUBLIC_AUTH_API_URL || '';

interface Status {
  connected: boolean;
  blog_username?: string | null;
  last_synced_at?: string | null;
  last_sync_error?: string | null;
  subscribers_count?: number;
}

// Секция «🔑 Автосинк через Boosty API».
//
// Показывается в настройках способа оплаты Boosty. Переводчик жмёт
// «Подключить Boosty автоматически» → фронт дёргает RPC
// issue_boosty_connect_token → мы рисуем кнопку-букмарклет с встроенным
// одноразовым токеном. Переводчик перетаскивает её в закладки, открывает
// boosty.to, кликает — букмарклет POST'ит нам токены, и auth-service
// сохраняет их зашифрованными. Воркер дальше сам тянет подписчиков.
export default function BoostyAutoConnect() {
  const supabase = createClient();
  const { items: toasts, push, dismiss } = useToasts();

  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [issuing, setIssuing] = useState(false);
  const [bookmarklet, setBookmarklet] = useState<{
    href: string;
    expires_at: string;
  } | null>(null);

  const reload = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_my_boosty_connection_status');
    setLoading(false);
    if (error) {
      push('error', `Статус не загрузился: ${error.message}`);
      return;
    }
    const res = (data ?? {}) as { ok?: boolean } & Status;
    if (!res.ok) {
      push('error', 'Не авторизован.');
      return;
    }
    setStatus({
      connected:         !!res.connected,
      blog_username:     res.blog_username ?? null,
      last_synced_at:    res.last_synced_at ?? null,
      last_sync_error:   res.last_sync_error ?? null,
      subscribers_count: res.subscribers_count ?? 0,
    });
  };

  useEffect(() => {
    reload();
    // Перечитываем статус, когда пользователь возвращается на вкладку —
    // типичный сценарий: ушёл на boosty.to, кликнул букмарклет, вернулся.
    const onFocus = () => reload();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const issue = async () => {
    if (!AUTH_API_URL) {
      push('error', 'NEXT_PUBLIC_AUTH_API_URL не задан. Скажи админу.');
      return;
    }
    setIssuing(true);
    const { data, error } = await supabase.rpc('issue_boosty_connect_token');
    setIssuing(false);
    if (error) {
      push('error', `Не получилось: ${error.message}`);
      return;
    }
    const res = (data ?? {}) as {
      ok?: boolean;
      token?: string;
      expires_at?: string;
      error?: string;
    };
    if (!res.ok || !res.token) {
      push('error', `Ошибка: ${res.error ?? 'unknown'}`);
      return;
    }
    setBookmarklet({
      href: buildBookmarkletHref(AUTH_API_URL, res.token),
      expires_at: res.expires_at ?? '',
    });
  };

  const disconnect = async () => {
    if (!confirm('Отвязать Boosty? Автосинк отключится, кэш подписчиков удалится.')) return;
    const { error } = await supabase.rpc('disconnect_my_boosty');
    if (error) {
      push('error', error.message);
      return;
    }
    push('success', 'Отвязано.');
    setBookmarklet(null);
    reload();
  };

  if (loading) {
    return (
      <div className="payment-method-autosync" style={{ color: 'var(--ink-mute)', fontSize: 13 }}>
        Загружаем статус Boosty API…
      </div>
    );
  }

  return (
    <div className="payment-method-autosync">
      <div
        style={{
          fontWeight: 600,
          fontSize: 13,
          marginBottom: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        🔑 Автосинк через Boosty API
        {status?.connected && (
          <span
            style={{
              fontSize: 11,
              color: '#2a7d2a',
              background: '#e7f4e7',
              borderRadius: 4,
              padding: '1px 6px',
            }}
          >
            подключено
          </span>
        )}
      </div>

      {status?.connected ? (
        <div style={{ fontSize: 13, lineHeight: 1.5 }}>
          Блог: <code>{status.blog_username ?? '—'}</code>
          {' · '}
          подписчиков в кэше: <strong>{status.subscribers_count ?? 0}</strong>
          <br />
          Последняя синхронизация:{' '}
          {status.last_synced_at
            ? new Date(status.last_synced_at).toLocaleString()
            : 'ещё не было'}
          {status.last_sync_error && (
            <div style={{ color: '#a04040', fontSize: 12, marginTop: 4 }}>
              ⚠ Ошибка: {status.last_sync_error}. Скорее всего refresh-токен
              протух — перетащи букмарклет ещё раз и кликни на boosty.to.
            </div>
          )}
          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={issue}
              disabled={issuing}
              style={{ height: 28, fontSize: 12 }}
            >
              {issuing ? '…' : '↻ Переподключить'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={disconnect}
              style={{ height: 28, fontSize: 12, color: '#a04040' }}
            >
              Отвязать
            </button>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 13, lineHeight: 1.5 }}>
          Один клик — и заявки читателей с твоим Boosty-email подтверждаются
          автоматически (без кнопок «одобрить»).
          <br />
          <button
            type="button"
            className="btn btn-primary"
            onClick={issue}
            disabled={issuing}
            style={{ height: 32, fontSize: 13, marginTop: 8 }}
          >
            {issuing ? 'Генерирую…' : '🔑 Подключить за 1 клик'}
          </button>
        </div>
      )}

      {bookmarklet && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            background: '#fffbea',
            border: '1px solid #e8d7a1',
            borderRadius: 6,
            fontSize: 13,
            lineHeight: 1.55,
          }}
        >
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            <li>
              Перетащи эту кнопку в панель закладок (или ПКМ → «Добавить в
              закладки»). Кликать её на chaptify бесполезно — это работает
              только после перетаскивания и только на boosty.to.
              {/*
                React 19 блокирует href="javascript:..." как XSS-защиту:
                подменяет URL на throw Error, и в закладки попадает битый
                код. Единственный способ обойти — отрендерить <a> через
                dangerouslySetInnerHTML (reactовский sanitizer туда не лезет).
                connect_token — 64 hex-символа, encodeURIComponent экранирует
                всё остальное, так что атрибутной инъекции нет.
              */}
              <div
                style={{ marginTop: 6, marginBottom: 6 }}
                dangerouslySetInnerHTML={{
                  __html: `<a href="${bookmarklet.href}" draggable="true" style="display:inline-block;padding:6px 12px;background:#ffc839;color:#3a2a0f;border-radius:6px;text-decoration:none;font-weight:600;cursor:grab;">💛 Chaptify ← Boosty</a>`,
                }}
              />
            </li>
            <li>Открой <a href="https://boosty.to" target="_blank" rel="noreferrer">boosty.to</a> (залогинься, если ещё нет).</li>
            <li>Кликни на закладку. Увидишь всплывашку «✓ Подключено» — значит, всё.</li>
            <li>Вернись сюда — этот блок обновится автоматически.</li>
          </ol>
          <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 8 }}>
            Одноразовая ссылка действительна{' '}
            {bookmarklet.expires_at
              ? `до ${new Date(bookmarklet.expires_at).toLocaleTimeString()}`
              : '15 минут'}
            . Если не успеешь — сгенерируй новую.
          </div>
        </div>
      )}

      <ToastStack items={toasts} onDismiss={dismiss} />
    </div>
  );
}

// Собираем JS-код букмарклета и кодируем под атрибут href.
// Все кавычки двойные, потому что URL-safe encoding всё равно превратит их в %22.
function buildBookmarkletHref(authApiUrl: string, connectToken: string): string {
  // IIFE — чтобы не засорять window. Alert'ы — единственный UX, который
  // работает одинаково на всех сайтах.
  const code = `
(function(){
  try {
    var raw = localStorage.getItem("auth");
    var cid = localStorage.getItem("_clientId");
    if (!raw || !cid) {
      alert("Chaptify: не вижу сессии Boosty. Залогинься на boosty.to и нажми ещё раз.");
      return;
    }
    var auth; try { auth = JSON.parse(raw); } catch(e){ alert("Chaptify: формат auth неожиданный: " + e); return; }
    var at = auth && (auth.accessToken || auth.access_token);
    var rt = auth && (auth.refreshToken || auth.refresh_token);
    if (!at || !rt) { alert("Chaptify: в localStorage нет access/refresh-токенов."); return; }
    fetch(${JSON.stringify(authApiUrl)} + "/auth/boosty-connect", {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        connect_token: ${JSON.stringify(connectToken)},
        access_token: at,
        refresh_token: rt,
        client_id: cid
      })
    }).then(function(r){ return r.json().then(function(d){ return {s:r.status,d:d}; }); })
      .then(function(x){
        if (x.d && x.d.ok) {
          alert("Chaptify ✓ Подключено" + (x.d.blog_username ? ": блог " + x.d.blog_username : "") + ". Вернись на chaptify.");
        } else {
          alert("Chaptify ✗ " + x.s + " · " + (x.d && (x.d.error || x.d.message) || "unknown"));
        }
      })
      .catch(function(e){ alert("Chaptify сеть: " + e.message); });
  } catch(e) { alert("Chaptify: " + e.message); }
})();`;
  // В href подходит обычное percent-encoding. Префикс обязателен.
  return 'javascript:' + encodeURIComponent(code);
}
