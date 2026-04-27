'use client';

import { useEffect } from 'react';

// Ставит body.reader-keyboard-up пока в фокусе textarea/input.
// Зачем отдельно от visualViewport-детекта в ReaderContent.tsx:
// в Telegram WebApp на iOS visualViewport.resize либо не стреляет,
// либо стреляет с другими параметрами, и детект
// `vv.height < window.innerHeight - 100` не срабатывает —
// body.reader-keyboard-up не ставится, CSS-правила (прятать
// .comment-toolbar и .reader-pages-end padding-bottom) не работают.
// Юзер видит коричневую полосу над клавиатурой и тулбар, который
// по плану должен прятаться.
//
// Детект через focusin/focusout универсальный: если на странице
// в фокусе textarea или input — клавиатура поднята (на тач-девайсах).
// На десктопе фокус на input тоже поднимет body-класс, но visualViewport
// не ужимается → CSS-правила в reader-keyboard-fix.css обёрнуты в
// @media (pointer: coarse), они применяются только на тач-устройствах.
// Так что на десктопе фокус ничего не меняет.
//
// Компонент монтируется один раз в layout.tsx, рендерит null.
export default function ReaderKeyboardDetector() {
  useEffect(() => {
    const update = () => {
      const el = document.activeElement;
      const isEditable =
        !!el &&
        (el.tagName === 'TEXTAREA' ||
          el.tagName === 'INPUT' ||
          (el as HTMLElement).isContentEditable);
      document.body.classList.toggle('reader-keyboard-up', isEditable);
    };
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    // Стартовое состояние: на случай SSR-восстановления с уже
    // сфокусированным input'ом (теоретически редко, но проверяем).
    update();
    return () => {
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
      document.body.classList.remove('reader-keyboard-up');
    };
  }, []);
  return null;
}
