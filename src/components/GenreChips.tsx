export default function GenreChips() {
  const genres = [
    "Все", "Ромфэнтези", "Сянься", "Исекай", 
    "Современное", "Драма", "Комедия", "Детектив", "Хоррор", "ЛитРПГ"
  ];

  return (
    <section className="container section">
      <div className="section-head">
        <h2>Жанры</h2>
      </div>
      <div className="chips">
        {genres.map((genre, index) => (
          <button 
            key={genre} 
            className={`chip ${index === 0 ? 'active' : ''}`}
          >
            {genre}
          </button>
        ))}
      </div>
    </section>
  );
}