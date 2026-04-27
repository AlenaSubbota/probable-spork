'use client';

import { useState } from 'react';

// Расширенная справка для bulk-страницы. Свернута по умолчанию;
// разворачивается одним кликом. Цель — дать переводчику-новичку
// полную картину «что это, как этим пользоваться, что будет
// подписчикам», без необходимости проб и ошибок.
//
// Компонент специально визуально живёт ВЫШЕ формы и не дублирует
// мелкую `bulk-instruct` подсказку внутри формы — там оставлен
// краткий чеклист «как подготовить текст», тут — «как работает».

const STYLES = `
.bulk-help {
  border-radius: 12px;
  border: 1px solid var(--border, #e3dccd);
  background: var(--surface, #fffaf0);
  margin-bottom: 18px;
  overflow: hidden;
}
.bulk-help-toggle {
  width: 100%;
  padding: 14px 18px;
  background: transparent;
  border: none;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  font-size: 15px;
  font-weight: 600;
  color: var(--ink, #2b2722);
  display: flex;
  align-items: center;
  gap: 10px;
  transition: background 0.15s;
}
.bulk-help-toggle:hover {
  background: rgba(0, 0, 0, 0.03);
}
.bulk-help-chev {
  display: inline-block;
  transition: transform 0.18s ease;
  font-size: 12px;
  color: var(--ink-mute, #888);
}
.bulk-help.is-open .bulk-help-chev { transform: rotate(90deg); }
.bulk-help-body {
  padding: 0 22px 18px;
  font-size: 14px;
  line-height: 1.55;
  color: var(--ink, #2b2722);
}
.bulk-help-body h4 {
  margin: 18px 0 6px;
  font-size: 14px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--ink-mute, #6e6657);
  font-weight: 700;
}
.bulk-help-body h4:first-child { margin-top: 4px; }
.bulk-help-body p { margin: 6px 0; }
.bulk-help-body ol, .bulk-help-body ul {
  margin: 6px 0 6px 22px;
  padding: 0;
}
.bulk-help-body li { margin: 4px 0; }
.bulk-help-body code {
  background: rgba(0, 0, 0, 0.06);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 13px;
  font-family: var(--font-mono, ui-monospace, "SF Mono", Menlo, monospace);
}
.bulk-help-body strong { color: var(--ink, #1f1c18); }
.bulk-help-callout {
  background: rgba(184, 134, 11, 0.08);
  border-left: 3px solid var(--accent, #b8860b);
  padding: 10px 14px;
  border-radius: 4px;
  margin: 10px 0;
  font-size: 13.5px;
}
.bulk-help-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-top: 8px;
}
@media (max-width: 720px) {
  .bulk-help-grid { grid-template-columns: 1fr; }
}
.bulk-help-card {
  background: rgba(0, 0, 0, 0.02);
  border-radius: 8px;
  padding: 12px 14px;
  border: 1px solid var(--border, #e3dccd);
}
.bulk-help-card h5 {
  margin: 0 0 4px;
  font-size: 13.5px;
  font-weight: 700;
}
.bulk-help-card p { margin: 0; font-size: 13px; color: var(--ink-mute, #6e6657); }
`;

export default function BulkUploadHelp() {
  const [open, setOpen] = useState(false);

  return (
    <div className={`bulk-help${open ? ' is-open' : ''}`}>
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <button
        type="button"
        className="bulk-help-toggle"
        onClick={() => setOpen((s) => !s)}
        aria-expanded={open}
      >
        <span className="bulk-help-chev">▶</span>
        <span>📖 Подробная справка — как работает массовая загрузка</span>
      </button>

      {open && (
        <div className="bulk-help-body">
          <h4>Что эта страница делает</h4>
          <p>
            Загружает <strong>много глав за раз</strong> и/или открывает уже
            опубликованные платные главы бесплатно. Подписчики получат
            <strong> ОДНО уведомление в Telegram-боте</strong> со списком всего,
            что вышло — без спама.
          </p>

          <h4>Шаги</h4>
          <ol>
            <li>
              <strong>Подготовь текст.</strong> В Google Docs, Word или .docx.
              Каждую главу пометь строкой <code>Глава 1</code>, <code>Глава 2</code>,
              … на отдельной строке. Заголовок может быть жирным, по центру,
              стилем Heading — это не помешает.
            </li>
            <li>
              <strong>Вставь или загрузи.</strong> Скопируй текст и вставь в большое
              поле ниже (Ctrl+V), либо нажми кнопку <code>📄 .docx</code> в тулбаре
              редактора и выбери файл.
            </li>
            <li>
              <strong>Проверь разбиение справа.</strong> Появится список
              «Глава 5 · 1240 слов · 10 монет/бесплатно». Если разбило не так
              как ты ожидала — заголовки должны быть на отдельной строке.
            </li>
            <li>
              <strong>Настрой цены.</strong> «По умолчанию платные» — все будут
              платные. «С какой главы платные» = N — главы 1 до N-1 бесплатные,
              с N платные.
            </li>
            <li>
              <strong>(Опционально) открой бесплатно диапазон.</strong> Это
              для уже загруженных платных глав. Например, ты выложила 1-100,
              и хочешь открыть 96-100 бесплатно — введи <code>96-100</code>.
            </li>
            <li>
              <strong>Нажми «Опубликовать».</strong> Главы загрузятся, дата
              у freed-глав обновится, подписчикам уйдёт одно сообщение.
            </li>
          </ol>

          <h4>Как работают заголовки «Глава N»</h4>
          <ul>
            <li>На отдельной строке: <code>Глава 1</code> или <code>Глава 12. Имя</code></li>
            <li>На английском тоже работает: <code>Chapter 5</code></li>
            <li>Можно с жирным/курсивом/центром — парсер их игнорирует</li>
            <li>
              Если заголовков нет — весь текст уйдёт <strong>одной главой</strong>
              с номером из поля «Начальный номер».
            </li>
          </ul>

          <h4>Платные и бесплатные</h4>
          <div className="bulk-help-grid">
            <div className="bulk-help-card">
              <h5>«По умолчанию платные» <em>(чекбокс)</em></h5>
              <p>
                Все новые главы будут платными по 10 монет, если поле «С какой
                главы платные» пустое. Если выключено — все бесплатные.
              </p>
            </div>
            <div className="bulk-help-card">
              <h5>«С какой главы платные» <em>(число)</em></h5>
              <p>
                Например <code>10</code>: главы 1-9 бесплатные, с 10 платные.
                Перекрывает чекбокс. Применяется только к новым главам, не к
                диапазону «открыть бесплатно».
              </p>
            </div>
            <div className="bulk-help-card">
              <h5>🎁 «Открыть бесплатно (диапазон)»</h5>
              <p>
                Для уже опубликованных платных глав. Формат:{' '}
                <code>100-104</code>, <code>105</code>, <code>100—110</code>.
                У этих глав обновится дата публикации — они всплывут в каталоге
                как свежие.
              </p>
            </div>
            <div className="bulk-help-card">
              <h5>Подписчики переводчика</h5>
              <p>
                Платные главы у них всегда читаются бесплатно — независимо от
                цены и статуса. Цена в монетах — это для разовой покупки
                читателями без подписки.
              </p>
            </div>
          </div>

          <h4>Уведомления — самое важное</h4>
          <div className="bulk-help-callout">
            🔔 <strong>Одна загрузка через эту форму = одно сообщение в боте</strong>.
            Не важно, сколько глав в пачке (5 или 50) и есть ли там «открыть
            бесплатно» — подписчик получит ровно одно уведомление со списком
            всех глав.
          </div>
          <p>
            Текст уведомления выглядит так:<br />
            «<em>«Название новеллы»: новые главы 47, 48, 49 · открыты бесплатно
            42, 43</em>». Клик по нему ведёт на первую новую главу.
          </p>

          <h4>Если удобнее грузить по одной</h4>
          <p>
            На странице «<em>Одна глава</em>» каждое нажатие «Опубликовать
            сейчас» = одно уведомление. Чтобы не спамить подписчиков, есть два
            подхода:
          </p>
          <ul>
            <li>
              <strong>Галка «🔕 Опубликовать тихо»</strong> на одиночной форме —
              глава уходит в эфир без уведомления. Хорошо для опечаток в уже
              вышедшей главе.
            </li>
            <li>
              <strong>Загрузил по одной несколько глав тихо → пришёл сюда → открыл их бесплатно</strong> — подписчики
              получат одно уведомление с полным списком.
            </li>
          </ul>

          <h4>Сохранение черновика</h4>
          <p>
            Текст автосохраняется каждые 2 секунды (видишь «✓ Черновик сохранён»
            справа). Если закроешь вкладку или браузер — при следующем визите
            на эту страницу появится баннер «Восстановить / Отбросить».
            Черновик у каждого переводчика свой, по одной новелле — один.
          </p>

          <h4>Решение проблем</h4>
          <ul>
            <li>
              <strong>Разбило не на те главы:</strong> убедись что «Глава N»
              на отдельной строке, между предыдущей и следующей пустая строка.
            </li>
            <li>
              <strong>Весь текст жирный после вставки из Google Docs:</strong>{' '}
              удали всё в редакторе (Ctrl+A → Backspace) и вставь снова.
              Документ Google оборачивает фрагмент в один <code>&lt;b&gt;</code>;
              мы его раздеваем при вставке, но иногда нужен повтор.
            </li>
            <li>
              <strong>Курсив/центр пропадают при копи-пасте:</strong> проверь
              что в Google Docs форматирование действительно применено
              (выделить → проверить «I» в тулбаре). Word сохраняет его лучше
              через .docx-файл, чем через clipboard.
            </li>
            <li>
              <strong>Кнопка «Опубликовать» серая:</strong> ни текста, ни
              диапазона бесплатных не указано — нужно одно из двух (или оба).
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
