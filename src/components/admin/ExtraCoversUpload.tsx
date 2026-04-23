'use client';

import { useRef, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { getCoverUrl } from '@/lib/format';

interface Props {
  /** Массив дополнительных обложек (path'ы в bucket covers или URL'ы) */
  value: string[];
  onChange: (next: string[]) => void;
  label?: string;
  /** Максимум дополнительных обложек — главную считаем отдельно */
  max?: number;
}

// Загрузчик дополнительных обложек для новеллы (поле novels.covers jsonb
// из мигр. 046). Главная обложка загружается отдельно через <CoverUpload/>
// и живёт в novels.cover_url. Здесь — галерея-альтернативы, которую
// читатель сможет пролистать на странице новеллы и в карточке каталога.
//
// Можно выбрать сразу несколько файлов в диалоге, можно перетащить.
// У каждой загруженной обложки — мини-превью и кнопка «✕» чтобы убрать.
export default function ExtraCoversUpload({
  value,
  onChange,
  label = 'Дополнительные обложки',
  max = 9,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uploadFiles = async (files: FileList | File[]) => {
    setError(null);
    const arr = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (arr.length === 0) {
      setError('Нужны файлы-изображения (jpg/png/webp).');
      return;
    }
    const allowed = Math.max(0, max - value.length);
    if (allowed === 0) {
      setError(`Максимум ${max} дополнительных обложек.`);
      return;
    }
    const slice = arr.slice(0, allowed);
    if (slice.some((f) => f.size > 5 * 1024 * 1024)) {
      setError('Каждый файл до 5 МБ.');
      return;
    }

    setUploading(true);
    const supabase = createClient();
    const uploaded: string[] = [];
    for (const file of slice) {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const filename = `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('covers')
        .upload(filename, file, { cacheControl: '3600', upsert: false });
      if (upErr) {
        setError(upErr.message);
        setUploading(false);
        if (uploaded.length > 0) onChange([...value, ...uploaded]);
        return;
      }
      uploaded.push(filename);
    }
    onChange([...value, ...uploaded]);
    setUploading(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  const removeAt = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  const moveUp = (idx: number) => {
    if (idx === 0) return;
    const next = [...value];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    onChange(next);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
  };

  return (
    <div className="form-field">
      <label>{label}</label>
      <div className="extra-covers-grid">
        {value.map((path, i) => {
          const url = getCoverUrl(path);
          return (
            <div key={`${path}-${i}`} className="extra-cover-tile">
              {url ? (
                <img src={url} alt={`Обложка ${i + 1}`} />
              ) : (
                <div className="placeholder p1">{i + 1}</div>
              )}
              <div className="extra-cover-actions">
                {i > 0 && (
                  <button
                    type="button"
                    className="extra-cover-btn"
                    onClick={() => moveUp(i)}
                    title="Сдвинуть влево"
                  >
                    ←
                  </button>
                )}
                <button
                  type="button"
                  className="extra-cover-btn extra-cover-btn--danger"
                  onClick={() => removeAt(i)}
                  title="Удалить"
                >
                  ✕
                </button>
              </div>
              <span className="extra-cover-index">#{i + 1}</span>
            </div>
          );
        })}

        {value.length < max && (
          <div
            className={`extra-cover-add${dragOver ? ' dragover' : ''}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) uploadFiles(e.target.files);
              }}
            />
            <div className="extra-cover-icon" aria-hidden="true">＋</div>
            <div className="extra-cover-hint">
              {uploading ? 'Загружаем…' : 'Добавить'}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div style={{ color: 'var(--rose)', fontSize: 13, marginTop: 6 }}>
          {error}
        </div>
      )}
      <div className="form-hint" style={{ marginTop: 6 }}>
        Главная обложка — отдельно сверху. Здесь до {max} дополнительных,
        читатели смогут полистать их в карточке и на странице новеллы.
      </div>
    </div>
  );
}
