(function () {
  'use strict';

  var CONSENT_KEY = 'luckybase_cookie_consent_v1';
  var CONSENT_VERSION = 1;
  var CSRF_COOKIE = 'csrf_token';
  var OPTIONAL_COOKIE = '_cfuvid';

  function isSecureContext() {
    return window.location.protocol === 'https:';
  }

  function cookieAttributes(maxAgeSeconds) {
    var attrs = ['path=/', 'SameSite=Lax'];
    if (typeof maxAgeSeconds === 'number' && isFinite(maxAgeSeconds) && maxAgeSeconds > 0) {
      attrs.push('Max-Age=' + Math.floor(maxAgeSeconds));
    }
    if (isSecureContext()) {
      attrs.push('Secure');
    }
    return attrs.join('; ');
  }

  function setCookie(name, value, maxAgeSeconds) {
    document.cookie = encodeURIComponent(name) + '=' + encodeURIComponent(String(value || '')) + '; ' + cookieAttributes(maxAgeSeconds);
  }

  function getCookie(name) {
    var encoded = encodeURIComponent(name) + '=';
    var parts = (document.cookie || '').split('; ');
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].indexOf(encoded) === 0) {
        return decodeURIComponent(parts[i].slice(encoded.length));
      }
    }
    return '';
  }

  function deleteCookie(name) {
    document.cookie = encodeURIComponent(name) + '=; path=/; Max-Age=0; SameSite=Lax' + (isSecureContext() ? '; Secure' : '');
  }

  function randomToken(size) {
    var length = Math.max(16, size || 48);
    var chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    var out = '';

    if (window.crypto && window.crypto.getRandomValues) {
      var values = new Uint8Array(length);
      window.crypto.getRandomValues(values);
      for (var i = 0; i < length; i++) {
        out += chars.charAt(values[i] % chars.length);
      }
      return out;
    }

    for (var j = 0; j < length; j++) {
      out += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return out;
  }

  function readConsent() {
    try {
      var raw = window.localStorage.getItem(CONSENT_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== CONSENT_VERSION) return null;
      return {
        version: CONSENT_VERSION,
        essential: true,
        optional: !!parsed.optional,
        updatedAt: parsed.updatedAt || ''
      };
    } catch (e) {
      return null;
    }
  }

  function saveConsent(optionalEnabled) {
    var consent = {
      version: CONSENT_VERSION,
      essential: true,
      optional: !!optionalEnabled,
      updatedAt: new Date().toISOString()
    };
    try {
      window.localStorage.setItem(CONSENT_KEY, JSON.stringify(consent));
    } catch (e) {
      // no-op
    }
    return consent;
  }

  function ensureCsrfCookie() {
    var token = getCookie(CSRF_COOKIE);
    if (!token) {
      token = randomToken(64);
      setCookie(CSRF_COOKIE, token, 60 * 60 * 24 * 29);
    }
    return token;
  }

  function syncCsrfInputs() {
    var token = ensureCsrfCookie();
    var forms = document.querySelectorAll('form');
    for (var i = 0; i < forms.length; i++) {
      var form = forms[i];
      var method = String(form.getAttribute('method') || 'GET').toUpperCase();
      if (method === 'GET') continue;
      var input = form.querySelector('input[name="csrf_token"]');
      if (!input) {
        input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'csrf_token';
        form.appendChild(input);
      }
      input.value = token;
    }
  }

  function applyConsent(consent) {
    ensureCsrfCookie();

    if (consent && consent.optional) {
      if (!getCookie(OPTIONAL_COOKIE)) {
        setCookie(OPTIONAL_COOKIE, randomToken(48));
      }
    } else {
      deleteCookie(OPTIONAL_COOKIE);
    }

    syncCsrfInputs();
  }

  function createBanner() {
    var root = document.createElement('aside');
    root.className = 'cc-banner cc-hidden';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-live', 'polite');
    root.setAttribute('aria-label', 'Aviso de cookies');
    root.innerHTML = [
      '<h3>Gestion de cookies</h3>',
      '<p>Utilizamos cookies obligatorias para seguridad y cookies opcionales para mejorar proteccion y rendimiento. Puedes aceptar, rechazar o personalizar tu consentimiento.</p>',
      '<div class="cc-actions">',
      '<button type="button" class="cc-btn cc-btn-primary" data-cc="accept-all">Aceptar todo</button>',
      '<button type="button" class="cc-btn" data-cc="reject-opt">Rechazar optativas</button>',
      '<button type="button" class="cc-btn cc-btn-outline" data-cc="open-prefs">Personalizar</button>',
      '</div>'
    ].join('');
    return root;
  }

  function createPreferencesModal() {
    var backdrop = document.createElement('div');
    backdrop.className = 'cc-modal-backdrop cc-hidden';
    backdrop.setAttribute('aria-hidden', 'true');
    backdrop.innerHTML = [
      '<div class="cc-modal" role="dialog" aria-modal="true" aria-labelledby="ccModalTitle">',
      '<div class="cc-modal-head">',
      '<h3 id="ccModalTitle">Preferencias de cookies</h3>',
      '<button type="button" class="cc-btn" data-cc="close-modal">Cerrar</button>',
      '</div>',
      '<div class="cc-modal-body">',
      '<p>Configura que cookies permites. Puedes consultar el detalle legal en nuestra <a href="cookie-policy.html" style="color:#1565ff;font-weight:600;">Politica de Cookies</a>.</p>',
      '<div class="cc-cookie-list">',
      '<div class="cc-cookie-item">',
      '<div class="cc-cookie-row">',
      '<div><span class="cc-cookie-name">csrf_token</span><span class="cc-cookie-type">Obligatoria</span></div>',
      '<label class="cc-switch" aria-label="csrf_token obligatoria">',
      '<input type="checkbox" checked disabled>',
      '<span class="cc-slider"></span>',
      '</label>',
      '</div>',
      '<div class="cc-cookie-desc"><a href="cookie-policy.html#csrf-token" style="color:#1565ff;font-weight:700;text-decoration:none;">Privacy policy</a><br>Protects against hacking and malicious actors.<br><strong>Type:</strong> http_cookie · <strong>Duration:</strong> 29 days</div>',
      '</div>',
      '<div class="cc-cookie-item">',
      '<div class="cc-cookie-row">',
      '<div><span class="cc-cookie-name">_cfuvid</span><span class="cc-cookie-type">Optativa</span></div>',
      '<label class="cc-switch" aria-label="_cfuvid optativa">',
      '<input type="checkbox" id="ccOptionalCookie">',
      '<span class="cc-slider"></span>',
      '</label>',
      '</div>',
      '<div class="cc-cookie-desc"><a href="https://developers.cloudflare.com/fundamentals/reference/policies-compliances/cloudflare-cookies/#_cfuvid-for-rate-limiting-rules" target="_blank" rel="noopener noreferrer" style="color:#1565ff;font-weight:700;text-decoration:none;">Privacy policy</a><br>This cookie is set by Cloudflare to enhance security and performance. It helps identify trusted web traffic and ensures a secure browsing experience for users.<br><strong>Type:</strong> server_cookie · <strong>Duration:</strong> Session</div>',
      '</div>',
      '</div>',
      '<div class="cc-note">Puedes cambiar esta decision en cualquier momento desde el boton "Cookies".</div>',
      '</div>',
      '<div class="cc-modal-foot">',
      '<button type="button" class="cc-btn" data-cc="reject-opt-modal">Guardar solo obligatoria</button>',
      '<button type="button" class="cc-btn cc-btn-primary" data-cc="save-prefs">Guardar preferencias</button>',
      '</div>',
      '</div>'
    ].join('');
    return backdrop;
  }

  function bindPreferenceLinks(openModal) {
    var seen = [];
    var links = document.querySelectorAll('.footer-preferences, [data-cookie-preferences], a');

    function wasSeen(el) {
      for (var i = 0; i < seen.length; i++) {
        if (seen[i] === el) return true;
      }
      return false;
    }

    function remember(el) {
      seen.push(el);
      el.addEventListener('click', function (event) {
        event.preventDefault();
        openModal();
      });
    }

    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      if (!link || wasSeen(link)) continue;

      var text = String(link.textContent || '').trim().toLowerCase();
      var hasClass = link.classList && link.classList.contains('footer-preferences');
      var dataAttr = link.hasAttribute('data-cookie-preferences');
      var matchesText = text.indexOf('cambiar mis preferencias') !== -1;

      if (hasClass || dataAttr || matchesText) {
        remember(link);
      }
    }
  }

  function initUI() {
    var banner = createBanner();
    var modal = createPreferencesModal();

    document.body.appendChild(banner);
    document.body.appendChild(modal);

    var optionalToggle = modal.querySelector('#ccOptionalCookie');

    function openModal() {
      var current = readConsent();
      optionalToggle.checked = !!(current && current.optional);
      modal.classList.remove('cc-hidden');
      modal.setAttribute('aria-hidden', 'false');
    }

    function closeModal() {
      modal.classList.add('cc-hidden');
      modal.setAttribute('aria-hidden', 'true');
    }

    function hideBanner() {
      banner.classList.add('cc-hidden');
    }

    function showBanner() {
      banner.classList.remove('cc-hidden');
    }

    function persistAndApply(optionalEnabled) {
      var consent = saveConsent(optionalEnabled);
      applyConsent(consent);
      hideBanner();
      closeModal();
    }

    banner.querySelector('[data-cc="accept-all"]').addEventListener('click', function () {
      persistAndApply(true);
    });

    banner.querySelector('[data-cc="reject-opt"]').addEventListener('click', function () {
      persistAndApply(false);
    });

    banner.querySelector('[data-cc="open-prefs"]').addEventListener('click', openModal);

    modal.addEventListener('click', function (event) {
      if (event.target === modal) {
        closeModal();
      }
    });

    var closeBtn = modal.querySelector('[data-cc="close-modal"]');
    var saveBtn = modal.querySelector('[data-cc="save-prefs"]');
    var rejectBtn = modal.querySelector('[data-cc="reject-opt-modal"]');

    closeBtn.addEventListener('click', closeModal);
    saveBtn.addEventListener('click', function () {
      persistAndApply(optionalToggle.checked);
    });
    rejectBtn.addEventListener('click', function () {
      persistAndApply(false);
    });

    bindPreferenceLinks(openModal);

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !modal.classList.contains('cc-hidden')) {
        closeModal();
      }
    });

    var consent = readConsent();
    if (consent) {
      applyConsent(consent);
      hideBanner();
    } else {
      applyConsent({ essential: true, optional: false });
      showBanner();
    }

    window.LuckyCookies = {
      openPreferences: openModal,
      getConsent: readConsent,
      resetConsent: function () {
        try {
          window.localStorage.removeItem(CONSENT_KEY);
        } catch (e) {
          // no-op
        }
        deleteCookie(OPTIONAL_COOKIE);
        showBanner();
      }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI);
  } else {
    initUI();
  }
})();
