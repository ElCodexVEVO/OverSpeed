/* ============================================================
   OverSpeed · shell.js
   Comportamientos del chasis que no dependen de los datos:
   menú lateral en móvil, atajos de la topbar y el eslogan que
   cambia con la vista. El enrutado y los datos son de app.js.
   ============================================================ */
(function () {
  'use strict';
  var app = document.getElementById('application');
  if (!app) return;

  /* --- Barra lateral ------------------------------------------
     En pantallas estrechas el menú se abre como cajón encima del
     contenido. En escritorio no tendría sentido esconderlo entero,
     así que el mismo botón lo pliega a una franja de iconos.      */
  var narrow = window.matchMedia('(max-width: 980px)');
  var toggle = document.getElementById('menuToggle');
  var COLLAPSED_KEY = 'overspeed-nav-collapsed';

  function labelToggle() {
    if (!toggle) return;
    var text = narrow.matches
      ? (app.classList.contains('nav-open') ? 'Cerrar navegación' : 'Abrir navegación')
      : (app.classList.contains('nav-collapsed') ? 'Desplegar barra lateral' : 'Plegar barra lateral');
    toggle.setAttribute('aria-label', text);
    toggle.setAttribute('title', text);
  }

  try {
    if (localStorage.getItem(COLLAPSED_KEY) === '1') app.classList.add('nav-collapsed');
  } catch (e) { /* almacenamiento no disponible */ }

  if (toggle) toggle.addEventListener('click', function () {
    if (narrow.matches) {
      app.classList.toggle('nav-open');
    } else {
      var collapsed = app.classList.toggle('nav-collapsed');
      try { localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0'); } catch (e) { /* ignorar */ }
    }
    labelToggle();
  });

  // Al elegir una vista en móvil, el cajón se cierra solo.
  app.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('nav [data-view]')) app.classList.remove('nav-open');
  });

  // Al cambiar de tamaño, se descarta el estado que ya no aplica.
  narrow.addEventListener('change', function () {
    app.classList.remove('nav-open');
    labelToggle();
  });

  labelToggle();

  /* --- Eslogan de la topbar según la vista visible ------------ */
  var slogan = document.getElementById('viewSlogan');

  function escapeHtml(value) {
    return String(value).replace(/[&<>"\']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "\'": '&#39;' }[c];
    });
  }

  function syncSlogan() {
    if (!slogan) return;
    var sections = app.querySelectorAll('main .view');
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].hidden) continue;
      var text = sections[i].getAttribute('data-slogan');
      if (text) slogan.innerHTML = text.split('|').map(escapeHtml).join('<br>');
      return;
    }
  }

  // app.js cambia el atributo hidden de las secciones al navegar.
  new MutationObserver(syncSlogan).observe(app, {
    subtree: true, attributes: true, attributeFilter: ['hidden']
  });

  syncSlogan();
})();
