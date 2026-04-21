'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

interface Row {
  translator_id: string;
  translator_name: string;
  translator_slug: string | null;
  coins_gross: number;
  chapter_count: number;
  unique_buyers: number;
  payout_method: string | null;
  payout_ref: string | null;
}

interface Props {
  periodLabel: string;
  periodFrom: string;
  periodTo: string;
  rows: Row[];
  paidMap: Record<string, { rub: number; paid: boolean } | undefined>;
  totalCoins: number;
}

// 1 монета = 1 ₽ по дефолту. Комиссия платформы — 0% на бета-этапе.
const DEFAULT_RUB_RATE = 1.0;
const DEFAULT_FEE_PCT = 0;

export default function AllPayoutsClient({
  periodLabel,
  periodFrom,
  periodTo,
  rows,
  paidMap,
  totalCoins,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [rate, setRate] = useState(DEFAULT_RUB_RATE);
  const [feePct, setFeePct] = useState(DEFAULT_FEE_PCT);

  const calcAmount = (coins: number) => {
    const net = coins * (1 - feePct / 100);
    return Math.round(net * rate * 100) / 100;
  };

  const totalRub = calcAmount(totalCoins);

  // Киллер-фича #1: CSV-экспорт
  const exportCsv = () => {
    const header = [
      'Переводчик',
      'Slug',
      'Заработал монет',
      'Глав куплено',
      'Уникальных читателей',
      'Сумма к выплате (₽)',
      'Способ',
      'Реквизиты',
      'Статус',
    ];
    const lines = [header.join(';')];
    for (const r of rows) {
      if (Number(r.coins_gross) === 0) continue;
      const amount = calcAmount(Number(r.coins_gross));
      const paid = paidMap[r.translator_id];
      const status = paid?.paid
        ? 'Выплачено'
        : paid
        ? 'Частично'
        : 'К выплате';
      lines.push(
        [
          r.translator_name,
          r.translator_slug ?? '',
          r.coins_gross,
          r.chapter_count,
          r.unique_buyers,
          amount.toFixed(2),
          r.payout_method ?? '',
          r.payout_ref ?? '',
          status,
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(';')
      );
    }
    const csv = '﻿' + lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chaptify-payouts-${periodLabel.replace(/\s/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Киллер-фича #2: пометить «выплачено» → закрывает цикл
  const markPaid = async (row: Row) => {
    const coins = Number(row.coins_gross);
    if (coins === 0) return;
    const amount = calcAmount(coins);
    const payoutRef = window.prompt(
      `Перевести ${row.translator_name}: ${coins} монет = ${amount} ₽\n\n` +
      `Укажи номер платежа / ссылку-подтверждение (необязательно):`
    );
    if (payoutRef === null) return;

    setBusy(row.translator_id);
    const supabase = createClient();
    const { error } = await supabase.from('payout_cycles').insert({
      translator_id: row.translator_id,
      period_from: periodFrom,
      period_to: periodTo,
      coins_gross: coins,
      platform_fee_pct: feePct,
      coins_net: Math.round(coins * (1 - feePct / 100)),
      rub_rate: rate,
      amount_rub: amount,
      payout_method: row.payout_method,
      payout_ref: payoutRef || null,
      paid_at: new Date().toISOString(),
    });
    setBusy(null);

    if (error) {
      alert('Не удалось закрыть цикл: ' + error.message);
      return;
    }
    router.refresh();
  };

  return (
    <>
      {/* Итого + настройки курса */}
      <div className="payouts-summary">
        <div className="payouts-summary-metric">
          <div className="payouts-summary-label">Всего монет заработано</div>
          <div className="payouts-summary-value">
            {totalCoins.toLocaleString('ru-RU')}
          </div>
        </div>
        <div className="payouts-summary-metric">
          <div className="payouts-summary-label">К выплате</div>
          <div className="payouts-summary-value payouts-summary-value--accent">
            {totalRub.toLocaleString('ru-RU')} ₽
          </div>
        </div>
        <div className="payouts-summary-controls">
          <label className="form-field" style={{ margin: 0 }}>
            <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>Курс (₽ за 1 монету)</span>
            <input
              type="number"
              step={0.01}
              className="form-input"
              value={rate}
              onChange={(e) => setRate(parseFloat(e.target.value) || 1)}
              style={{ width: 100 }}
            />
          </label>
          <label className="form-field" style={{ margin: 0 }}>
            <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>Комиссия платформы %</span>
            <input
              type="number"
              step={1}
              min={0}
              max={50}
              className="form-input"
              value={feePct}
              onChange={(e) => setFeePct(parseInt(e.target.value, 10) || 0)}
              style={{ width: 80 }}
            />
          </label>
          <button type="button" className="btn btn-ghost" onClick={exportCsv}>
            📄 Скачать CSV
          </button>
        </div>
      </div>

      {/* Таблица */}
      {rows.length === 0 ? (
        <div className="empty-state">
          <p>Нет данных за этот период.</p>
        </div>
      ) : (
        <div className="novels-heat-scroll">
          <table className="novels-heat-table payouts-table">
            <thead>
              <tr>
                <th>Переводчик</th>
                <th className="num">Монеты</th>
                <th className="num">К выплате</th>
                <th className="num">Глав</th>
                <th className="num">Читателей</th>
                <th>Способ</th>
                <th>Статус</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const coins = Number(r.coins_gross);
                const paid = paidMap[r.translator_id];
                const isPaid = paid?.paid;
                return (
                  <tr key={r.translator_id} className={isPaid ? 'payouts-row-paid' : ''}>
                    <td>
                      {r.translator_slug ? (
                        <Link href={`/t/${r.translator_slug}`} className="novels-heat-title">
                          {r.translator_name}
                        </Link>
                      ) : (
                        <span className="novels-heat-title">{r.translator_name}</span>
                      )}
                    </td>
                    <td className="num">{coins.toLocaleString('ru-RU')}</td>
                    <td className="num">
                      <strong>{calcAmount(coins).toLocaleString('ru-RU')} ₽</strong>
                    </td>
                    <td className="num">{r.chapter_count}</td>
                    <td className="num">{r.unique_buyers}</td>
                    <td>
                      {r.payout_method ? (
                        <span className="note">{r.payout_method}</span>
                      ) : (
                        <span style={{ color: 'var(--ink-mute)', fontSize: 12 }}>
                          не настроен
                        </span>
                      )}
                    </td>
                    <td>
                      {isPaid ? (
                        <span className="status-pill status-active">Выплачено</span>
                      ) : coins === 0 ? (
                        <span style={{ color: 'var(--ink-mute)', fontSize: 12 }}>—</span>
                      ) : (
                        <span className="status-pill">К выплате</span>
                      )}
                    </td>
                    <td>
                      {!isPaid && coins > 0 && (
                        <button
                          type="button"
                          className="btn btn-primary"
                          style={{ height: 30, padding: '0 10px', fontSize: 12 }}
                          onClick={() => markPaid(r)}
                          disabled={busy === r.translator_id}
                        >
                          {busy === r.translator_id ? '…' : 'Выплачено ✓'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ marginTop: 16, color: 'var(--ink-mute)', fontSize: 12, lineHeight: 1.5 }}>
        Когда переведёшь деньги переводчику — жми «Выплачено ✓». Создастся
        запись в <code>payout_cycles</code> с суммой и референсом. Следующий
        раз этот период уже не попадёт в «К выплате».
      </p>
    </>
  );
}
