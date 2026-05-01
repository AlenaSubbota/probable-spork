import Link from 'next/link';

// Подпись переводчика в конце главы. Раньше тут жила «сургучная
// печать» брендинга; функцию убрали, и пустая карточка с одной
// надписью смотрелась сиротливо. Теперь это типографский орнамент
// «конец письма»: тонкая рулетка с фронтоном-флёроном и двустрочной
// подписью под ней. Без фона/рамок — встраивается в поток главы,
// не оспаривая её настроения.

interface Props {
  name: string;
  href: string | null;
}

export default function TranslatorSignature({ name, href }: Props) {
  const nameNode = href ? (
    <Link href={href} className="tr-signature-name">{name}</Link>
  ) : (
    <span className="tr-signature-name">{name}</span>
  );

  return (
    <aside className="tr-signature" aria-label={`Перевод: ${name}`}>
      <div className="tr-signature-rule" aria-hidden="true">
        <span className="tr-signature-rule-line" />
        <span className="tr-signature-rule-mark">❦</span>
        <span className="tr-signature-rule-line" />
      </div>
      <div className="tr-signature-text">
        <span className="tr-signature-label">Перевод</span>
        {nameNode}
      </div>
    </aside>
  );
}
