import HeroBanner from '@/components/HeroBanner';
import GenreChips from '@/components/GenreChips';
import NovelCard from '@/components/NovelCard';
import Link from 'next/link';

export default function HomePage() {
  return (
    <main>
      <HeroBanner />
      <GenreChips />

      {/* Секция: Популярное */}
      <section className="container section">
        <div className="section-head">
          <h2>Популярное</h2>
          <Link href="/catalog" className="more">Смотреть все →</Link>
        </div>

        <div className="novel-grid">
          <NovelCard 
            id="lunnye-pesni" title="Лунные песни осеннего двора" 
            translator="Алёна" metaInfo="124 гл." rating="4.9"
            placeholderClass="p1" placeholderText={<>Лунные<br/>песни</>}
            flagText="HOT"
          />
          <NovelCard 
            id="sem-snov" title="Семь снов об императоре" 
            translator="Алёна" metaInfo="62 гл." rating="4.7"
            placeholderClass="p2" placeholderText={<>Семь<br/>снов</>}
            flagText="FREE" flagClass="free"
          />
          <NovelCard 
            id="put-drakona" title="Путь дракона, бегущего на запад" 
            translator="Иван" metaInfo="203 гл." rating="4.8"
            placeholderClass="p3" placeholderText={<>Путь<br/>дракона</>}
          />
          <NovelCard 
            id="temnaya-glina" title="Тёмная глина и звёздный фарфор" 
            translator="Алёна" metaInfo="180 гл." rating="4.6"
            placeholderClass="p4" placeholderText={<>Тёмная<br/>глина</>}
            flagText="FULL" flagClass="done"
          />
          <NovelCard 
            id="cvetok-v-teni" title="Цветок, растущий в тени храма" 
            translator="Алёна" metaInfo="88 гл." rating="4.9"
            placeholderClass="p5" placeholderText={<>Цветок<br/>в тени</>}
          />
          <NovelCard 
            id="ruka-mastera" title="Рука мастера-кузнеца" 
            translator="Иван" metaInfo="54 гл." rating="4.5"
            placeholderClass="p6" placeholderText={<>Рука<br/>мастера</>}
          />
        </div>
      </section>

      {/* Секция: Новые главы */}
      <section className="container section">
        <div className="section-head">
          <h2>Новые главы</h2>
          <Link href="/feed" className="more">Вся лента →</Link>
        </div>

        <div className="novel-grid">
          <NovelCard 
            id="chai-s-lotosom" title="Чай с лотосом на рассвете" 
            translator="Алёна" metaInfo="вчера" rating="4.4"
            placeholderClass="p7" placeholderText={<>Чай с<br/>лотосом</>}
            flagText="+3"
          />
          <NovelCard 
            id="sever-les" title="Север-лес, где спят старые боги" 
            translator="Иван" metaInfo="2 дня назад" rating="4.6"
            placeholderClass="p8" placeholderText={<>Север<br/>леса</>}
            flagText="+1"
          />
          <NovelCard 
            id="alye-perya" title="Алые перья в нефритовой клетке" 
            translator="Алёна" metaInfo="3 дня назад" rating="4.7"
            placeholderClass="p2" placeholderText={<>Алые<br/>перья</>}
            flagText="+2"
          />
          <NovelCard 
            id="groza-nad-hu" title="Гроза над королевством Ху" 
            translator="Иван" metaInfo="4 дня назад" rating="4.5"
            placeholderClass="p1" placeholderText={<>Гроза<br/>над Ху</>}
            flagText="+1"
          />
          <NovelCard 
            id="medovaya-shkatulka" title="Медовая шкатулка придворного лекаря" 
            translator="Алёна" metaInfo="неделю назад" rating="4.8"
            placeholderClass="p5" placeholderText={<>Медовая<br/>шкатулка</>}
          />
          <NovelCard 
            id="kolco-uzhnyh-voln" title="Кольцо южных волн" 
            translator="Иван" metaInfo="неделю назад" rating="4.4"
            placeholderClass="p3" placeholderText={<>Кольцо<br/>южных волн</>}
          />
        </div>
      </section>
    </main>
  );
}