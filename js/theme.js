// Theme switcher: Light / Dark / High Contrast (low vision).
// Loaded as a plain (non-module) script directly in <head> on every page so
// the theme is applied to <html data-theme="..."> before first paint —
// avoids a flash of the wrong theme on load. The widget itself is built
// once the DOM is ready.

(function applyStoredThemeBeforePaint() {
  var stored = null;
  try { stored = localStorage.getItem('audsim_theme'); } catch (e) { /* localStorage unavailable */ }
  var theme = stored || 'light';
  if (theme !== 'light') {
    document.documentElement.setAttribute('data-theme', theme);
  }
})();

(function () {
  var THEMES = [
    { id: 'light', label: 'Light', swatch: '#ffffff' },
    { id: 'dark', label: 'Dark', swatch: '#1e293b' },
    { id: 'high-contrast', label: 'High Contrast (Low Vision)', swatch: '#000000' }
  ];

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') || 'light';
  }

  function setTheme(id) {
    if (id === 'light') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', id);
    }
    try { localStorage.setItem('audsim_theme', id); } catch (e) { /* ignore */ }
    updateMenuState();
  }

  var menuEl, btnEl;

  function updateMenuState() {
    if (!menuEl) return;
    var active = currentTheme();
    Array.prototype.forEach.call(menuEl.querySelectorAll('.theme-menu-item'), function (item) {
      var isActive = item.dataset.themeId === active;
      item.classList.toggle('active', isActive);
      item.setAttribute('aria-current', isActive ? 'true' : 'false');
    });
  }

  function closeMenu() {
    if (!menuEl) return;
    menuEl.classList.remove('open');
    btnEl.setAttribute('aria-expanded', 'false');
  }

  function openMenu() {
    if (!menuEl) return;
    menuEl.classList.add('open');
    btnEl.setAttribute('aria-expanded', 'true');
    var firstItem = menuEl.querySelector('.theme-menu-item');
    if (firstItem) firstItem.focus();
  }

  function toggleMenu() {
    if (menuEl.classList.contains('open')) closeMenu();
    else openMenu();
  }

  // Half-black/half-white disc icon (matches the "contrast" style toggle).
  var ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="9.5" fill="#fff" stroke="currentColor" stroke-width="1.5"/>' +
    '<path d="M12 2.5a9.5 9.5 0 0 1 0 19V2.5z" fill="currentColor"/>' +
    '</svg>';

  function buildWidget() {
    var wrap = document.createElement('div');
    wrap.className = 'theme-toggle-wrap';

    btnEl = document.createElement('button');
    btnEl.type = 'button';
    btnEl.className = 'theme-toggle-btn';
    btnEl.setAttribute('aria-label', 'Change colour theme');
    btnEl.setAttribute('aria-haspopup', 'menu');
    btnEl.setAttribute('aria-expanded', 'false');
    btnEl.innerHTML = ICON_SVG;
    btnEl.style.color = '#1e293b';

    menuEl = document.createElement('div');
    menuEl.className = 'theme-menu';
    menuEl.setAttribute('role', 'menu');
    menuEl.setAttribute('aria-label', 'Colour theme options');

    THEMES.forEach(function (t) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'theme-menu-item';
      item.setAttribute('role', 'menuitemradio');
      item.dataset.themeId = t.id;
      item.innerHTML =
        '<span class="theme-swatch" style="background:' + t.swatch + '"></span><span>' + t.label + '</span>';
      item.addEventListener('click', function () {
        setTheme(t.id);
        closeMenu();
        btnEl.focus();
      });
      menuEl.appendChild(item);
    });

    btnEl.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleMenu();
    });

    document.addEventListener('click', function (e) {
      if (menuEl.classList.contains('open') && !wrap.contains(e.target)) closeMenu();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menuEl.classList.contains('open')) {
        closeMenu();
        btnEl.focus();
      }
    });

    wrap.appendChild(menuEl);
    wrap.appendChild(btnEl);

    // Dock inside the sidebar if this page has one (student view — the
    // CSS then switches this element to position:static on small screens
    // so it sits at the bottom of the sidebar rather than floating over
    // the chat). Otherwise just float bottom-right on every screen size.
    var slot = document.getElementById('themeToggleSlot');
    if (slot) {
      slot.replaceWith(wrap);
    } else {
      document.body.appendChild(wrap);
    }

    updateMenuState();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildWidget);
  } else {
    buildWidget();
  }
})();
