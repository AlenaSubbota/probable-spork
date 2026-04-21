'use client';

import { useMemo, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

interface Package {
  coins: number;
  bonus: number;        // бонусные монеты сверху
  priceRub: number;     // стоимость в рублях
  popular?: boolean;
}

const PACKAGES: Package[] = [
  { coins: 100,  bonus: 0,   priceRub: 99 },
  { coins: 500,  bonus: 50,  priceRub: 449, popular: true },
  { coins: 1000, bonus: 150, priceRub: 849 },
  { coins: 2500, bonus: 500, priceRub: 1990 },
];

// Средняя цена главы. Используется для подсказки «≈ N глав».
const AVG_CHAPTER_PRICE = 10;

interface Props {
  tributeChannel?: string;     // @tributeBotName или URL
  boostyUrl?: string;
  paymentCode: string;
}

type Provider = 'tribute' | 'boosty';

export default function TopupPackages({
  tributeChannel,
  boostyUrl,
  paymentCode,
}: Props) {
  const [selected, setSelected] = useState<number>(1); // second = popular default
  const [provider, setProvider] = useState<Provider>('tribute');
  const [copied, setCopied] = useState(false);

  const pkg = PACKAGES[selected];
  const totalCoins = pkg.coins + pkg.bonus;
  const chaptersEstimate = Math.floor(totalCoins / AVG_CHAPTER_PRICE);

  // --- Киллер-фича #2: сравнение с подпиской ---
  // Подписка на одного переводчика — условно 299 ₽/мес.
  const monthlySubPrice = 299;
  const subTip = useMemo(() => {
    if (pkg.priceRub >= monthlySubPrice && chaptersEstimate >= 30) {
      return `Если планируешь читать больше 30 глав одного переводчика в месяц — подписка за ${monthlySubPrice} ₽ откроет ВСЁ его платное, а не только часть.`;
    }
    if (pkg.priceRub < monthlySubPrice) {
      return `Пакет меньше цены подписки — имеет смысл, если читаешь нечасто или у разных переводчиков.`;
    }
    return null;
  }, [pkg.priceRub, chaptersEstimate]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(paymentCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const buildTributeUrl = () => {
    if (!tributeChannel) return null;
    const base = tributeChannel.startsWith('http')
      ? tributeChannel
      : `https://t.me/${tributeChannel.replace(/^@/, '')}`;
    return base;
  };

  return (
    <>
      <h2 className="topup-section-title">Выбери пакет</h2>

      {/* Сетка пакетов */}
      <div className="topup-packages">
        {PACKAGES.map((p, i) => {
          const isActive = i === selected;
          const total = p.coins + p.bonus;
          const chaps = Math.floor(total / AVG_CHAPTER_PRICE);
          return (
            <button
              key={i}
              type="button"
              className={`topup-package${isActive ? ' active' : ''}${p.popular ? ' popular' : ''}`}
              onClick={() => setSelected(i)}
            >
              {p.popular && <span className="topup-popular">★ популярный</span>}
              <div className="topup-coins">
                {p.coins.toLocaleString('ru-RU')}
                <span className="topup-coins-unit">монет</span>
              </div>
              {/* Киллер-фича #1: визуальный бонус */}
              {p.bonus > 0 && (
                <div className="topup-bonus">
                  +{p.bonus} бонус
                  <span className="topup-bonus-pct">
                    (+{Math.round((p.bonus / p.coins) * 100)}%)
                  </span>
                </div>
              )}
              <div className="topup-price">{p.priceRub} ₽</div>
              {/* Киллер-фича #1: сколько глав */}
              <div className="topup-chapters-hint">
                ≈ {chaps} {plural(chaps, 'глава', 'главы', 'глав')}
              </div>
            </button>
          );
        })}
      </div>

      {/* Киллер-фича #2: подсказка про подписку */}
      {subTip && (
        <div className="topup-sub-tip">
          <span className="topup-sub-tip-icon" aria-hidden="true">💡</span>
          {subTip}
        </div>
      )}

      {/* Выбор способа оплаты */}
      <h2 className="topup-section-title" style={{ marginTop: 32 }}>
        Способ оплаты
      </h2>

      <div className="topup-providers">
        <label
          className={`topup-provider${provider === 'tribute' ? ' active' : ''}${!tributeChannel ? ' disabled' : ''}`}
        >
          <input
            type="radio"
            name="provider"
            checked={provider === 'tribute'}
            disabled={!tributeChannel}
            onChange={() => setProvider('tribute')}
          />
          <div>
            <div className="topup-provider-title">Tribute</div>
            <div className="topup-provider-sub">
              Telegram-бот для донатов. Быстро, без регистрации, по карте РФ или криптой.
            </div>
          </div>
        </label>

        <label
          className={`topup-provider${provider === 'boosty' ? ' active' : ''}${!boostyUrl ? ' disabled' : ''}`}
        >
          <input
            type="radio"
            name="provider"
            checked={provider === 'boosty'}
            disabled={!boostyUrl}
            onChange={() => setProvider('boosty')}
          />
          <div>
            <div className="topup-provider-title">Boosty</div>
            <div className="topup-provider-sub">
              Удобно если уже есть аккаунт Boosty или хочешь подписку, а не разовую оплату.
            </div>
          </div>
        </label>
      </div>

      {/* Киллер-фича #3: персональный код для сопоставления платежа */}
      <div className="topup-code-block">
        <div className="topup-code-head">Твой код для комментария к платежу</div>
        <div className="topup-code-row">
          <code className="topup-code">{paymentCode}</code>
          <button type="button" className="btn btn-ghost" onClick={handleCopy}>
            {copied ? '✓ Скопировано' : 'Скопировать'}
          </button>
        </div>
        <p className="topup-code-hint">
          Вставь этот код в комментарий к платежу — монеты зачислятся на
          твой аккаунт автоматически, обычно в течение минуты.
        </p>
      </div>

      {/* Итоговая кнопка */}
      <div className="topup-summary">
        <div className="topup-summary-left">
          <div className="topup-summary-label">К оплате</div>
          <div className="topup-summary-value">
            {pkg.priceRub} ₽
            <span className="topup-summary-sub">
              → {totalCoins.toLocaleString('ru-RU')} монет
            </span>
          </div>
        </div>
        {provider === 'tribute' && tributeChannel ? (
          <a
            href={buildTributeUrl() ?? '#'}
            target="_blank"
            rel="noreferrer"
            className="btn btn-primary"
          >
            Оплатить через Tribute →
          </a>
        ) : provider === 'boosty' && boostyUrl ? (
          <a
            href={boostyUrl}
            target="_blank"
            rel="noreferrer"
            className="btn btn-primary"
          >
            Оплатить через Boosty →
          </a>
        ) : (
          <button type="button" className="btn btn-primary" disabled>
            Оплатить
          </button>
        )}
      </div>
    </>
  );
}

function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
