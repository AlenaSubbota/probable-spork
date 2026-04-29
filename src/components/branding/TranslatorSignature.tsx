import Link from 'next/link';
import TranslatorSeal from './TranslatorSeal';
import type { BrandSeal } from '@/lib/translator-branding';

// Подпись переводчика — ставится в конце главы как «сургучная
// печать под текстом письма». Если у переводчика нет seal —
// рендерим без печати (но всё равно с подписью), чтобы блок не
// исчезал. Палитра берётся из ближайшего родителя с
// data-tr-palette (обычно — корневой wrapper читалки).

interface Props {
  name: string;
  href: string | null;
  seal: BrandSeal | null;
}

export default function TranslatorSignature({ name, href, seal }: Props) {
  const sealNode = seal ? (
    <div className="tr-signature-seal" aria-hidden="true">
      <TranslatorSeal seal={seal} />
    </div>
  ) : null;

  const nameNode = href ? (
    <Link href={href} className="tr-signature-name">{name}</Link>
  ) : (
    <span className="tr-signature-name">{name}</span>
  );

  return (
    <aside className="tr-signature" aria-label={`Перевод: ${name}`}>
      {sealNode}
      <div className="tr-signature-text">
        <span className="tr-signature-label">Перевод</span>
        {nameNode}
      </div>
    </aside>
  );
}
