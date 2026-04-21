'use client';

import { useRef, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { getCoverUrl } from '@/lib/format';

interface Props {
  value: string | null;             // текущий путь в bucket covers
  onChange: (path: string | null) => void;
  label?: string;
}

export default function CoverUpload({ value, onChange, label = 'Обложка' }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setError(null);
    if (!file.type.startsWith('image/')) {
      setError('Нужен файл изображения (jpg, png, webp).');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Файл больше 5 МБ.');
      return;
    }
    setUploading(true);

    const supabase = createClient();
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from('covers')
      .upload(filename, file, { cacheControl: '3600', upsert: false });

    if (upErr) {
      setError(upErr.message);
      setUploading(false);
      return;
    }
    onChange(filename);
    setUploading(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) upload(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) upload(file);
  };

  const currentUrl = value ? getCoverUrl(value) : null;

  return (
    <div className="form-field">
      <label>{label}</label>
      <div
        className={`cover-dropzone${dragOver ? ' dragover' : ''}${currentUrl ? ' has-image' : ''}`}
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
          onChange={handleFileChange}
          hidden
        />
        {currentUrl ? (
          <>
            <img src={currentUrl} alt="Обложка" />
            <div className="cover-dropzone-overlay">
              {uploading ? 'Загружаем…' : 'Заменить'}
            </div>
          </>
        ) : (
          <div className="cover-dropzone-empty">
            <div className="cover-dropzone-icon" aria-hidden="true">☁</div>
            <div>{uploading ? 'Загружаем…' : 'Перетащи или кликни'}</div>
            <div className="form-hint">jpg, png, webp · до 5 МБ</div>
          </div>
        )}
      </div>
      {error && <div style={{ color: 'var(--rose)', fontSize: 13, marginTop: 6 }}>{error}</div>}
      {value && (
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => onChange(null)}
          style={{ height: 28, padding: '0 10px', fontSize: 12, marginTop: 8 }}
        >
          Удалить обложку
        </button>
      )}
    </div>
  );
}
