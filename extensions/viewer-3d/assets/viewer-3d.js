(function () {
  var initialized = new WeakSet();

  var TONE_MAPPINGS = {
    None: 0,
    Linear: 1,
    Reinhard: 2,
    Cineon: 3,
    ACESFilmic: 4
  };

  function getCtor() {
    if (!window.View3D) return null;
    return window.View3D.default || window.View3D;
  }

  function showError(el, message) {
    var note = document.createElement('div');
    note.style.cssText =
      'position:absolute;inset:0;display:flex;align-items:center;' +
      'justify-content:center;padding:1rem;text-align:center;' +
      'background:rgba(255,255,255,0.9);color:#b00;font-size:0.85rem;';
    note.textContent = '[3D viewer] ' + message;
    el.appendChild(note);
    console.error('[viewer-3d] ' + message);
  }

  function parseConfig(raw) {
    if (!raw) return {};
    try {
      var c = JSON.parse(raw);
      return c && typeof c === 'object' ? c : {};
    } catch (err) {
      console.warn('[viewer-3d] invalid config JSON:', err);
      return {};
    }
  }

  function buildOptions(modelUrl, posterUrl, cfg) {
    var options = {
      src: modelUrl,
      autoInit: true
    };

    if (posterUrl) options.poster = posterUrl;

    if (typeof cfg.exposure === 'number') options.exposure = cfg.exposure;
    if (typeof cfg.toneMapping === 'string' && cfg.toneMapping in TONE_MAPPINGS) {
      options.toneMapping = TONE_MAPPINGS[cfg.toneMapping];
    }
    if (typeof cfg.useDefaultEnv === 'boolean') options.useDefaultEnv = cfg.useDefaultEnv;
    if (typeof cfg.skyboxBlur === 'boolean') options.skyboxBlur = cfg.skyboxBlur;
    if (cfg.skybox) options.skybox = cfg.skybox;
    if (cfg.envmap) options.envmap = cfg.envmap;

    if (cfg.background && typeof cfg.background === 'string') {
      var bg = cfg.background;
      if (bg.charAt(0) === '#' || bg.indexOf('://') > -1) {
        options.background = bg;
      }
    }

    if (cfg.fovMode === 'auto') {
      options.fov = 'auto';
    } else if (typeof cfg.fov === 'number') {
      options.fov = cfg.fov;
    }
    if (typeof cfg.yaw === 'number') options.yaw = cfg.yaw;
    if (typeof cfg.pitch === 'number') options.pitch = cfg.pitch;
    if (typeof cfg.initialZoom === 'number') options.initialZoom = cfg.initialZoom;
    if (typeof cfg.maintainSize === 'boolean') options.maintainSize = cfg.maintainSize;

    if (typeof cfg.rotate === 'boolean') options.rotate = cfg.rotate;
    if (typeof cfg.translate === 'boolean') options.translate = cfg.translate;
    if (typeof cfg.zoom === 'boolean') options.zoom = cfg.zoom;
    if (typeof cfg.scrollable === 'boolean') options.scrollable = cfg.scrollable;
    if (typeof cfg.wheelScrollable === 'boolean') options.wheelScrollable = cfg.wheelScrollable;
    if (typeof cfg.useGrabCursor === 'boolean') options.useGrabCursor = cfg.useGrabCursor;

    if (cfg.autoRotate) {
      options.autoplay = { delay: 0, speed: 0.5 };
    } else if (cfg.autoRotate === false) {
      options.autoplay = false;
    }

    if (typeof cfg.defaultAnimationIndex === 'number') {
      options.defaultAnimationIndex = cfg.defaultAnimationIndex;
    }
    if (typeof cfg.animationRepeatMode === 'string') {
      options.animationRepeatMode = cfg.animationRepeatMode;
    }

    if (typeof cfg.webAR === 'boolean') options.webAR = cfg.webAR;
    if (typeof cfg.sceneViewer === 'boolean') options.sceneViewer = cfg.sceneViewer;
    if (typeof cfg.quickLook === 'boolean') options.quickLook = cfg.quickLook;
    if (cfg.iosSrc) options.iosSrc = cfg.iosSrc;

    if (cfg.variant) options.variant = cfg.variant;
    if (typeof cfg.fixSkinnedBbox === 'boolean') options.fixSkinnedBbox = cfg.fixSkinnedBbox;
    if (typeof cfg.shadow === 'boolean') options.shadow = cfg.shadow;

    return options;
  }

  function parseHashPreview() {
    if (!window.location.hash) return null;
    var m = window.location.hash.match(/preview_config=([^&]+)/);
    if (!m) return null;
    try {
      return JSON.parse(decodeURIComponent(m[1]));
    } catch (err) {
      console.warn('[viewer-3d] invalid preview_config hash:', err);
      return null;
    }
  }

  function applyOverridesToWrapper(el, cfg) {
    if (typeof cfg.height === 'number') {
      el.style.setProperty('--viewer-height', cfg.height + 'px');
    }
    if (typeof cfg.background === 'string' && cfg.background.charAt(0) === '#') {
      el.style.setProperty('--viewer-bg', cfg.background);
      el.style.background = cfg.background;
    }
  }

  function initOne(el) {
    if (initialized.has(el)) return;
    initialized.add(el);

    var Ctor = getCtor();
    if (!Ctor) {
      showError(el, 'egjs-view3d library not loaded');
      return;
    }

    var modelUrl = el.dataset.modelUrl;
    if (!modelUrl) {
      showError(el, 'no model URL set');
      return;
    }

    var posterUrl = el.dataset.posterUrl || '';
    var cfg = parseConfig(el.dataset.config);

    var preview = parseHashPreview();
    if (preview && typeof preview === 'object') {
      cfg = Object.assign({}, cfg, preview);
      applyOverridesToWrapper(el, cfg);
      console.log('[viewer-3d] preview config applied from URL hash', preview);
    }

    var options = buildOptions(modelUrl, posterUrl, cfg);

    try {
      var view3d = new Ctor(el, options);
      console.log('[viewer-3d] initialized', modelUrl, options);

      var showControls = cfg.showControls !== false;
      if (showControls && window.View3D && window.View3D.ControlBar) {
        try {
          view3d.loadPlugins(new window.View3D.ControlBar());
        } catch (pluginErr) {
          console.warn('[viewer-3d] ControlBar plugin failed:', pluginErr);
        }
      }
    } catch (err) {
      showError(el, 'init failed: ' + (err && err.message ? err.message : err));
    }
  }

  function initAll() {
    document.querySelectorAll('[data-view3d]').forEach(initOne);
  }

  function whenReady(cb) {
    if (window.View3D) return cb();
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      if (window.View3D) {
        clearInterval(t);
        cb();
      } else if (tries > 100) {
        clearInterval(t);
        document.querySelectorAll('[data-view3d]').forEach(function (el) {
          showError(el, 'egjs-view3d failed to load');
        });
      }
    }, 50);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      whenReady(initAll);
    });
  } else {
    whenReady(initAll);
  }

  document.addEventListener('shopify:section:load', function () {
    whenReady(initAll);
  });
})();
