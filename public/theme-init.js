(function () {
  try {
    var t = localStorage.getItem('chaptify-theme') || 'auto';
    var r =
      t === 'auto'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : t;
    document.documentElement.setAttribute('data-theme', r);
  } catch (e) {}
})();
