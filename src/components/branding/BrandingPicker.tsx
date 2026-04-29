'use client';

import { useState } from 'react';
import TranslatorSeal from './TranslatorSeal';
import {
  PALETTE_PRESETS,
  SEAL_PRESETS,
  type BrandPalette,
  type BrandSeal,
} from '@/lib/translator-branding';

interface Props {
  palette: BrandPalette | null;
  seal: BrandSeal | null;
  onChangePalette: (v: BrandPalette | null) => void;
  onChangeSeal: (v: BrandSeal | null) => void;
}

// UI: две группы радио-кнопок в виде «чипсов». Превью кружочком
// для палитры, мини-SVG для печатей. Под пикером — динамическая
// подсказка с описанием выбранной палитры (preset.hint).

export default function BrandingPicker({
  palette,
  seal,
  onChangePalette,
  onChangeSeal,
}: Props) {
  // Подсказка: палитра «как ты звучишь» — приоритетнее. Если её
  // нет, показываем подсказку для печати. Если ничего не выбрано —
  // generic hint о том, зачем это.
  const [hovered, setHovered] = useState<string | null>(null);
  const activeHint = (() => {
    if (hovered) return hovered;
    const p = PALETTE_PRESETS.find((x) => x.id === palette);
    if (p) return p.hint;
    return 'Выбери палитру и печать — они будут «знаком» твоих переводов: акцентом в читалке, тонкой полоской на обложках, подписью под главой.';
  })();

  // Превью «герба». Маленький кружок в стиле палитры с печатью
  // внутри — даёт читателю сразу почувствовать, как это выглядит
  // в готовом виде.
  const livePreview = (
    <div
      data-tr-palette={palette ?? undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 14px',
        borderRadius: 999,
        background: palette ? 'var(--tr-wash)' : 'var(--accent-wash)',
        border: '1px solid var(--border)',
      }}
    >
      <span
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: palette ? 'var(--tr-accent)' : 'var(--ink-mute)',
          color: 'var(--surface)',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        {seal ? (
          <span style={{ width: 16, height: 16, display: 'grid', placeItems: 'center' }}>
            <TranslatorSeal seal={seal} />
          </span>
        ) : null}
      </span>
      <span style={{ fontSize: 13, color: 'var(--ink)' }}>
        {palette || seal ? 'Твой герб' : 'Без брендинга'}
      </span>
    </div>
  );

  return (
    <>
      <div style={{ marginBottom: 14 }}>{livePreview}</div>

      <div className="form-field">
        <label>Палитра</label>
        <div className="brand-picker" role="radiogroup" aria-label="Палитра переводчика">
          <PaletteChip
            checked={palette === null}
            onCheck={() => onChangePalette(null)}
            label="Без палитры"
            preview={null}
            onHover={setHovered}
            hoverHint="Сайт остаётся в общей палитре, без твоих цветов."
          />
          {PALETTE_PRESETS.map((p) => (
            <PaletteChip
              key={p.id}
              checked={palette === p.id}
              onCheck={() => onChangePalette(p.id)}
              label={p.label}
              preview={p.preview}
              onHover={setHovered}
              hoverHint={p.hint}
            />
          ))}
        </div>
      </div>

      <div className="form-field">
        <label>Печать</label>
        <div className="brand-picker" role="radiogroup" aria-label="Печать переводчика">
          <SealChip
            checked={seal === null}
            onCheck={() => onChangeSeal(null)}
            label="Без печати"
            seal={null}
          />
          {SEAL_PRESETS.map((s) => (
            <SealChip
              key={s.id}
              checked={seal === s.id}
              onCheck={() => onChangeSeal(s.id)}
              label={s.label}
              seal={s.id}
            />
          ))}
        </div>
        <div className="brand-picker-hint">{activeHint}</div>
      </div>
    </>
  );
}

function PaletteChip({
  checked,
  onCheck,
  label,
  preview,
  onHover,
  hoverHint,
}: {
  checked: boolean;
  onCheck: () => void;
  label: string;
  preview: string | null;
  onHover: (v: string | null) => void;
  hoverHint: string;
}) {
  return (
    <label
      className="brand-chip"
      data-checked={checked}
      onMouseEnter={() => onHover(hoverHint)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(hoverHint)}
      onBlur={() => onHover(null)}
    >
      <input
        type="radio"
        name="brand-palette"
        checked={checked}
        onChange={onCheck}
      />
      {preview ? (
        <span
          className="brand-chip-swatch"
          style={{ background: preview }}
          aria-hidden="true"
        />
      ) : (
        <span className="brand-chip-clear">∅</span>
      )}
      <span>{label}</span>
    </label>
  );
}

function SealChip({
  checked,
  onCheck,
  label,
  seal,
}: {
  checked: boolean;
  onCheck: () => void;
  label: string;
  seal: BrandSeal | null;
}) {
  return (
    <label className="brand-chip" data-checked={checked}>
      <input
        type="radio"
        name="brand-seal"
        checked={checked}
        onChange={onCheck}
      />
      {seal ? (
        <span className="brand-chip-seal" aria-hidden="true">
          <TranslatorSeal seal={seal} />
        </span>
      ) : (
        <span className="brand-chip-clear">∅</span>
      )}
      <span>{label}</span>
    </label>
  );
}
