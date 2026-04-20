'use client';

import { useState, useEffect } from 'react';

export default function ReaderContent({ content }: { content: string }) {
  // Загружаем настройки из localStorage или ставим дефолтные
  const [fontSize, setFontSize] = useState(18);
  const [lineHeight, setLineHeight] = useState(1.6);

  useEffect(() => {
    const saved = localStorage.getItem('chaptify-settings');
    if (saved) {
      const { fz, lh } = JSON.parse(saved);
      setFontSize(fz);
      setLineHeight(lh);
    }
  }, []);

  const saveSettings = (fz: number, lh: number) => {
    setFontSize(fz);
    setLineHeight(lh);
    localStorage.setItem('chaptify-settings', JSON.stringify({ fz, lh }));
  };

  return (
    <div className="reader-wrapper">
      {/* Панель быстрой настройки */}
      <div className="reader-tools" style={{ 
        display: 'flex', 
        gap: '12px', 
        justifyContent: 'center', 
        marginBottom: '32px',
        opacity: 0.6
      }}>
        <button onClick={() => saveSettings(fontSize - 1, lineHeight)} className="chip">A-</button>
        <button onClick={() => saveSettings(fontSize + 1, lineHeight)} className="chip">A+</button>
        <button onClick={() => saveSettings(fontSize, 1.4)} className="chip">Узко</button>
        <button onClick={() => saveSettings(fontSize, 1.8)} className="chip">Широко</button>
      </div>

      {/* Текст главы с поддержкой HTML */}
      <div 
        className="novel-content"
        style={{ 
          fontSize: `${fontSize}px`, 
          lineHeight: lineHeight,
          color: 'var(--ink)',
          fontFamily: 'var(--font-sans)', // Или serif, как в настройках
        }}
        dangerouslySetInnerHTML={{ __html: content }}
      />

      <style jsx global>{`
        .novel-content p {
          margin-bottom: 1.5em; /* Тот самый отступ абзаца */
        }
        .novel-content i {
          font-style: italic;
        }
      `}</style>
    </div>
  );
}