(function () {
  // Every rendered block emits its own <script src="viewer-3d.js">, and a
  // browser re-executes a repeated src rather than deduping it — so with two
  // viewer blocks on one page (a product block plus a page block, or the same
  // block added twice) this file runs twice. Each run used to get its own
  // closure-scoped `initialized` WeakSet, so nothing stopped the second run from
  // setting every viewer up all over again: two view3d instances sharing one
  // element, duplicate toolbars, two animation selectors, and the 'ready'
  // handler that builds the clip list registered twice.
  //
  // One copy already handles every [data-view3d] on the page (initAll queries
  // them all, and re-runs on shopify:section:load), so a later copy has nothing
  // to add — bail out. This also keeps the document-level listeners below
  // (mousedown/keydown/scroll/resize) from being registered twice.
  /*
   * Captured before the guard below, because the guard's early return happens
   * with `document.currentScript` still pointing at us and nothing else can get
   * it back afterwards. Harmless to read twice; impossible to read late.
   */
  var SELF_SCRIPT =
    document.currentScript || document.querySelector('script[data-vendor-js]');

  if (window.__viewer3dBooted) return;
  window.__viewer3dBooted = true;

  // Recorded on the element itself, not in a closure, so the flag is visible to
  // every copy of this script rather than only the one that set it. Belt and
  // braces alongside the guard above: a cache-busted or otherwise differing
  // script URL could still get a second copy past it.
  var INIT_ATTR = 'data-view3d-initialized';

  /*
   * Every live viewer, so detached ones can be torn down.
   *
   * Nothing used to be destroyed here at all. That is survivable on a normal
   * page load, where the element lives as long as the document — but the theme
   * editor re-renders a section on every settings change, and Shopify replaces
   * the section's DOM wholesale. The old element was dropped while its View3D
   * instance kept its WebGL context and kept running a full three.js draw loop
   * (autoRotate is on by default, so view3d renders every frame rather than on
   * demand), and its ResizeObserver stayed connected. Each edit added another
   * one. A handful in, the tab is running several render loops against dead
   * elements and the browser offers to kill the page — and past ~16 contexts
   * Chrome starts discarding the oldest, so live viewers go black too.
   *
   * A plain array rather than a WeakMap: the whole point is to enumerate these
   * and find the detached ones, which a WeakMap cannot do.
   */
  var instances = [];

  function findRecord(el) {
    for (var i = 0; i < instances.length; i++) {
      if (instances[i].el === el) return instances[i];
    }
    return null;
  }

  // Hands back everything one viewer holds. Shared by the detached sweep and by
  // eviction, which differ only in whether the element is still on the page.
  function releaseInstance(rec) {
    try {
      if (rec.observer) rec.observer.disconnect();
    } catch (e) {}
    try {
      // dispose() frees three.js's own caches but leaves the GL context
      // alive; only forceContextLoss actually hands it back to the browser,
      // and the context limit is the part that takes other viewers down.
      var r = rec.view3d && rec.view3d.renderer;
      if (r && r.threeRenderer && r.threeRenderer.forceContextLoss) {
        r.threeRenderer.forceContextLoss();
      }
    } catch (e) {}
    try {
      if (rec.view3d && rec.view3d.destroy) rec.view3d.destroy();
    } catch (e) {}
  }

  function teardownDetached() {
    for (var i = instances.length - 1; i >= 0; i--) {
      var rec = instances[i];
      if (document.contains(rec.el)) continue;
      instances.splice(i, 1);
      releaseInstance(rec);
    }

    // An IntersectionObserver holds a strong reference to every target, so
    // elements registered but never mounted (below the fold when the theme
    // editor replaced their section) would be pinned here even though the rest
    // of the sweep above never sees them — they have no instance record.
    for (var j = observedEls.length - 1; j >= 0; j--) {
      if (document.contains(observedEls[j])) continue;
      try {
        if (lazyObserver) lazyObserver.unobserve(observedEls[j]);
      } catch (e) {}
      observedEls.splice(j, 1);
    }
  }

  /*
   * ---------------------------------------------------------------------------
   * Lazy mounting, and pausing the draw loop while offscreen.
   *
   * Every [data-view3d] on the page used to be constructed the moment the DOM
   * was ready, which is what made a page with more than one or two viewers hang
   * the tab:
   *
   *  - Construction is what starts the model download (autoInit is true), and
   *    parsing a GLB happens on the main thread. Several at once is a
   *    multi-second block with no yield in it, which is exactly the state the
   *    browser reports as "page unresponsive".
   *  - Each viewer takes a WebGL context immediately. Past ~16 live contexts
   *    Chrome starts discarding the oldest, so viewers go black.
   *  - autoRotate defaults on, and the vendor's render loop only skips a frame
   *    when nothing is animating (its _defaultRenderLoop checks
   *    animator/control/autoPlayer). With autoplay enabled something is *always*
   *    animating, so every viewer drew ~60fps forever, whether or not it was
   *    anywhere near the viewport. Ten viewers on a collection page meant ten
   *    full three.js draw loops competing for the same GPU and main thread.
   *
   * So: register elements with one IntersectionObserver and only build a viewer
   * when it comes near the viewport, cap how many may be loading at once, and
   * stop the draw loop again whenever a mounted viewer scrolls back out.
   * ---------------------------------------------------------------------------
   */

  // Starts the load slightly before the viewer scrolls into view, so in the
  // common case the model is ready by the time it is actually looked at. It also
  // means the pause/resume boundary sits outside the visible area — a viewer
  // never restarts its loop while a corner of it is already on screen.
  var LAZY_ROOT_MARGIN = '200px 0px';

  // One at a time. The bottleneck is main-thread GLB parsing, which does not
  // parallelise — running several concurrently does not finish sooner, it just
  // merges the individual blocks into one long unresponsive stretch.
  var MAX_CONCURRENT_LOADS = 1;

  // A model that never resolves — a stalled CDN response, a file that decodes
  // forever — must not hold the queue shut behind it. The slot is a scheduling
  // hint, not a correctness guarantee, so releasing it early is safe: worst case
  // two loads briefly overlap.
  var LOAD_SLOT_TIMEOUT = 15000;

  /*
   * How many viewers may hold a WebGL context and its GPU memory at once.
   *
   * Deferring construction and stopping the draw loop fixed the *CPU* side, but
   * a paused viewer is not a free viewer: its context, textures, geometry and
   * three.js scene all stay resident for as long as the instance exists. Scroll
   * past five or six models and the tab is holding every one of them, which is
   * what takes the renderer process down — the browser kills the whole tab
   * rather than any single viewer, so the page dies with it.
   *
   * Three is deliberately conservative. It is a *soft* cap: a viewer that is
   * currently on screen is never evicted, so a layout that genuinely shows four
   * at once simply holds four rather than thrashing. Raise it only against a
   * real measurement — the ceiling is memory on the weakest device you support,
   * not a fixed number of contexts.
   */
  var MAX_LIVE_VIEWERS = 3;

  var observedEls = [];
  var lazyObserver = null;
  var mountQueue = [];
  var activeLoads = 0;
  var pumping = false;

  // element -> the markup Liquid emitted, captured at first mount. A WeakMap so
  // an element removed from the page takes its entry with it.
  var pristineHTML = new WeakMap();

  // Every observed element currently on screen, built or not. Kept alongside
  // each record's own `visible` flag because eviction has to reason about
  // dormant elements too, and those have no record to hold the flag.
  var visibleEls = new Set();

  // The authoritative answer, and the only safe one to build a record from: a
  // mount is not always driven by a fresh "is intersecting" callback. Eviction
  // re-mounts and mountVisibleWaiting can both build a viewer that is no longer
  // on screen, and a record wrongly marked visible never pauses and comes back
  // to life on every visibilitychange.
  //
  // With no observer at all nothing is ever tracked, so everything counts as
  // visible — otherwise the fallback path would pause every viewer it built.
  function isElVisible(el) {
    return !lazyObserver || visibleEls.has(el);
  }

  function getLazyObserver() {
    if (lazyObserver || !window.IntersectionObserver) return lazyObserver;
    lazyObserver = new window.IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          // Tracked for every observed element, not just built ones: eviction
          // needs to know which dormant elements are on screen and waiting.
          if (entry.isIntersecting) visibleEls.add(entry.target);
          else visibleEls.delete(entry.target);

          var rec = findRecord(entry.target);
          // No record yet means this one has never been built, or was evicted:
          // coming into view is what triggers the load.
          if (!rec) {
            if (entry.isIntersecting) enqueueMount(entry.target);
            return;
          }
          rec.visible = entry.isIntersecting;
          if (entry.isIntersecting) {
            resumeRender(rec);
          } else {
            // Stamped on the way *out*, so it orders viewers by how long they
            // have been off screen — which is exactly the eviction order.
            rec.lastVisible = Date.now();
            pauseRender(rec);
            // This viewer just became evictable, which may be the headroom an
            // on-screen viewer has been waiting for.
            mountVisibleWaiting();
          }
        });
      },
      { rootMargin: LAZY_ROOT_MARGIN }
    );
    return lazyObserver;
  }

  function pauseRender(rec) {
    // Only once the model is up. Pausing mid-load would fight the vendor, which
    // re-establishes its own loop on 'ready' anyway; the ready handler pauses
    // instead if the viewer went offscreen while it was loading.
    //
    // Never during AR. In a WebXR session the camera picture comes from the
    // browser but the model is drawn by this very animation loop, and entering
    // AR re-lays the page out (and can mark it hidden), so the observer reports
    // the viewer as gone. Stopping the loop then left the camera running with
    // no model in it.
    if (rec.paused || !rec.ready || rec.inAR) return;
    try {
      var r = rec.view3d && rec.view3d.renderer;
      if (!r || !r.stopAnimationLoop) return;
      // Hands back the rAF entirely (setAnimationLoop(null) internally). The
      // canvas keeps its last frame, so a paused viewer looks identical to a
      // running one that happens not to be rotating.
      r.stopAnimationLoop();
      rec.paused = true;
    } catch (e) {}
  }

  function resumeRender(rec) {
    // During AR the session owns the loop; restoring the default one here
    // would replace the XR loop and the model would stop being drawn.
    if (!rec.paused || rec.inAR) return;
    try {
      var r = rec.view3d && rec.view3d.renderer;
      if (!r || !r.setAnimationLoop) return;
      r.setAnimationLoop(r.defaultRenderLoop);
      rec.paused = false;
    } catch (e) {}
  }

  /*
   * Put a viewer back to sleep: hand its context and GPU memory back, and reset
   * the element to exactly the markup Liquid emitted so a later re-mount builds
   * onto a clean slate rather than stacking a second toolbar and clip list onto
   * the first.
   *
   * Restoring innerHTML also replaces the <canvas>, which is what we want — the
   * old one's context has just been force-lost and cannot be drawn to again.
   *
   * The element stays registered and observed. Dropping its record is the whole
   * mechanism: findRecord() returns null again, so the observer treats the next
   * intersection as a first mount.
   */
  function evict(rec) {
    var i = instances.indexOf(rec);
    if (i !== -1) instances.splice(i, 1);
    releaseInstance(rec);
    try {
      rec.el.classList.remove('is-loaded');
      var pristine = pristineHTML.get(rec.el);
      if (pristine != null) rec.el.innerHTML = pristine;
      showPlaceholder(rec.el);
    } catch (e) {}
  }

  // How far a viewer's centre sits from the centre of the viewport. Only used to
  // rank viewers that are all on screen at once, to pick the least central one.
  function distanceFromViewportCentre(el) {
    try {
      var rect = el.getBoundingClientRect();
      var viewportCentre = (window.innerHeight || 0) / 2;
      return Math.abs(rect.top + rect.height / 2 - viewportCentre);
    } catch (e) {
      return 0;
    }
  }

  /*
   * Make room before building another viewer. This is a HARD cap — the budget
   * exists because exceeding it kills the tab, and a blanked viewer is strictly
   * better than a dead page.
   *
   * Offscreen viewers go first, least-recently-visible among them, which is the
   * case that matters on a normal scroll. When every live viewer is on screen —
   * short viewers on a tall display, which is how five end up loaded at once —
   * the least central one is evicted instead. It falls back to its poster rather
   * than disappearing, and it does not immediately rebuild: it is already
   * intersecting, so no new observer callback fires for it. mountVisibleWaiting
   * is what brings it back, once something actually leaves the viewport.
   */
  function enforceLiveBudget(exceptEl) {
    var guard = instances.length + 1;
    while (instances.length >= MAX_LIVE_VIEWERS && guard-- > 0) {
      var victim = null;
      var victimRank = -1;
      for (var i = 0; i < instances.length; i++) {
        var rec = instances[i];
        // A viewer in AR is the one being used, wherever the page layout says
        // it is; evicting it would end the session.
        if (rec.el === exceptEl || rec.inAR) continue;
        // Offscreen always outranks on-screen; among equals, oldest/least
        // central wins. Ranking on one scale keeps this a single pass.
        var rank = rec.visible
          ? distanceFromViewportCentre(rec.el)
          : 1e9 + (Date.now() - rec.lastVisible);
        if (rank > victimRank) {
          victimRank = rank;
          victim = rec;
        }
      }
      if (!victim) return;
      evict(victim);
    }
  }

  /*
   * Bring back a viewer that was evicted, or never built, while it was on screen.
   *
   * Only runs when there is real headroom — free budget, or a live viewer that
   * has since gone offscreen and can be evicted for it. Without that condition
   * two on-screen viewers competing for the last slot would evict and rebuild
   * each other indefinitely.
   */
  function mountVisibleWaiting() {
    var canMakeRoom = instances.length < MAX_LIVE_VIEWERS;
    for (var i = 0; i < instances.length && !canMakeRoom; i++) {
      if (!instances[i].visible) canMakeRoom = true;
    }
    if (!canMakeRoom) return;

    for (var j = 0; j < observedEls.length; j++) {
      var el = observedEls[j];
      if (!visibleEls.has(el) || findRecord(el)) continue;
      enqueueMount(el);
      return; // one at a time; the next offscreen event brings the next one
    }
  }

  /*
   * What a dormant viewer shows: the product image the block already passes for
   * view3d's own poster. Without it a viewer that has not been built yet — or
   * one that has been evicted — is an empty coloured box, which on scroll-back
   * looks like the model was lost.
   *
   * loading="lazy" so registering a page full of these costs no requests until
   * they are near the viewport, which is the same bargain the viewers make.
   */
  function showPlaceholder(el) {
    var posterUrl = el.dataset.posterUrl;
    if (!posterUrl || el.querySelector('.viewer-3d-placeholder')) return;
    var img = document.createElement('img');
    img.className = 'viewer-3d-placeholder';
    img.src = posterUrl;
    img.alt = '';
    img.setAttribute('loading', 'lazy');
    img.setAttribute('decoding', 'async');
    el.appendChild(img);
  }

  function removePlaceholder(el) {
    var img = el.querySelector('.viewer-3d-placeholder');
    if (img) img.remove();
  }

  /* ---------------------------------------------------------------------------
   * Loading the vendor bundle
   *
   * egjs-view3d packages three.js, so view3d.pkgd.min.js is ~725KB — an order of
   * magnitude more than everything else this block ships put together. It used
   * to be a plain `<script defer>` in the Liquid, which means every product page
   * carrying the block downloaded, parsed and compiled all of it during load,
   * whether or not a viewer was ever scrolled to.
   *
   * That is the single largest thing this extension does to a storefront's
   * Lighthouse score, and Shopify holds a listed app to not moving that score by
   * more than 10 points. The viewers themselves were already deferred to an
   * IntersectionObserver; the library they need was not, so the deferral bought
   * nothing on the metric that gets measured.
   *
   * So the bundle is fetched on the same trigger as the viewers: the first mount
   * that actually needs it. A page whose viewer stays below the fold never pays
   * for it at all, and one whose viewer is visible starts the fetch at the same
   * moment it would have finished parsing an eager copy.
   *
   * The vendor CSS rides along — it styles the canvas and AR overlay, neither of
   * which exists before a mount.
   * ------------------------------------------------------------------------- */

  // 'idle' -> 'loading' -> 'ready' | 'failed'. 'failed' is terminal: the queue
  // drains into error messages rather than retrying a 404 once per viewer.
  var vendorState = 'idle';
  var vendorWaiting = [];

  function assetUrl(name) {
    return SELF_SCRIPT ? SELF_SCRIPT.getAttribute(name) : null;
  }

  function settleVendor(ok) {
    vendorState = ok ? 'ready' : 'failed';
    var waiting = vendorWaiting;
    vendorWaiting = [];
    for (var i = 0; i < waiting.length; i++) waiting[i](ok);
  }

  function ensureVendor(cb) {
    // Already present: another block's copy of this file may have loaded it, or
    // a theme may have the bundle in a layout of its own.
    if (window.View3D) {
      vendorState = 'ready';
      return cb(true);
    }
    if (vendorState === 'failed') return cb(false);

    vendorWaiting.push(cb);
    if (vendorState === 'loading') return;
    vendorState = 'loading';

    var cssHref = assetUrl('data-vendor-css');
    if (cssHref && !document.querySelector('link[data-view3d-vendor-css]')) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = cssHref;
      link.setAttribute('data-view3d-vendor-css', '');
      document.head.appendChild(link);
    }

    var src = assetUrl('data-vendor-js');
    if (!src) {
      // The block didn't pass the URL — an older block version against a newer
      // asset, mid-deploy. Nothing to load, and no point waiting for it.
      settleVendor(false);
      return;
    }

    var existing = document.querySelector('script[data-view3d-vendor-js]');
    if (existing) {
      // A second copy of this file got here first. Ride its load rather than
      // requesting the bundle twice.
      existing.addEventListener('load', function () {
        settleVendor(!!window.View3D);
      });
      existing.addEventListener('error', function () {
        settleVendor(false);
      });
      return;
    }

    var script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.setAttribute('data-view3d-vendor-js', '');
    script.onload = function () {
      // Loaded but no global means the wrong file is at that URL — treat it as a
      // failure so the viewer says so instead of hanging on a placeholder.
      settleVendor(!!window.View3D);
    };
    script.onerror = function () {
      settleVendor(false);
    };
    document.head.appendChild(script);
  }

  function enqueueMount(el) {
    if (mountQueue.indexOf(el) !== -1) return;
    mountQueue.push(el);
    pumpQueue();
  }

  function pumpQueue() {
    // done() calls back into here synchronously on the error paths, and the loop
    // below is already positioned to pick up the next item in that case.
    if (pumping) return;

    /*
     * The first queued mount is what triggers the vendor download. Gating here
     * rather than inside mountOne keeps it to one fetch for the whole page no
     * matter how many viewers queue up, and keeps mountOne synchronous in its
     * "library missing" branch.
     */
    if (mountQueue.length && !window.View3D) {
      if (vendorState === 'failed') {
        while (mountQueue.length) {
          showError(mountQueue.shift(), 'egjs-view3d failed to load');
        }
        return;
      }
      ensureVendor(function () {
        pumpQueue();
      });
      return;
    }

    pumping = true;
    try {
      while (activeLoads < MAX_CONCURRENT_LOADS && mountQueue.length) {
        var el = mountQueue.shift();
        // Removed while it sat in the queue — a theme editor re-render, or a
        // section deleted between scroll and load.
        if (!document.contains(el)) continue;
        activeLoads++;
        mountOne(el, makeSlotRelease());
      }
    } finally {
      pumping = false;
    }
  }

  // Each mount attempt gets its own release, guarded so the several exit paths
  // in mountOne (plus the timeout) can all call it without double-crediting the
  // slot and letting the queue run wide.
  function makeSlotRelease() {
    var released = false;
    var timer = setTimeout(function () {
      release();
    }, LOAD_SLOT_TIMEOUT);
    function release() {
      if (released) return;
      released = true;
      clearTimeout(timer);
      activeLoads--;
      pumpQueue();
    }
    return release;
  }

  var TONE_MAPPINGS = {
    None: 0,
    Linear: 1,
    Reinhard: 2,
    Cineon: 3,
    ACESFilmic: 4
  };

  // MUST stay in sync with DEFAULT_CONFIG in app/routes/app.products.$id.tsx
  // (and app/routes/app.models.$id.tsx). Previously every option here was
  // applied only `if (typeof cfg.x === 'boolean'/'number')`, which meant any
  // key missing from the metafield silently fell through to *view3d's* own
  // default instead of the app's — so a viewer the merchant never explicitly
  // configured rendered differently on the storefront than in the admin
  // preview (view3d defaults autoplay off and fixSkinnedBbox false, where the
  // app defaults both the other way). Merging onto these first means the two
  // sides start from identical values and the option builder below can assign
  // unconditionally, exactly like the admin's buildOptions does.
  var DEFAULTS = {
    height: 500,
    background: '#ffffff',
    exposure: 1,
    toneMapping: 'Linear',
    useDefaultEnv: true,
    skyboxBlur: false,
    skybox: '',
    envmap: '',
    fovMode: 'auto',
    fov: 45,
    yaw: 0,
    pitch: 0,
    initialZoom: 0,
    rotate: true,
    translate: true,
    zoom: true,
    autoRotate: true,
    scrollable: true,
    wheelScrollable: false,
    useGrabCursor: true,
    // Control bar ships with fullscreen + zoom only; the rest is opt-in.
    // MUST match DEFAULT_CONFIG in app/lib/viewer-config.ts — including the
    // knock-on that a hidden clip switcher means no animation at all.
    showAnimationSelector: false,
    showAxes: false,
    showFullscreenButton: true,
    showScreenshotButton: false,
    showCameraResetButton: false,
    showZoomButtons: true,
    // 1-based, 0 meaning "no animation" — see resolveDefaultClipIndex.
    defaultAnimationIndex: 1,
    animationRepeatMode: 'one',
    webAR: true,
    sceneViewer: true,
    quickLook: true,
    arPlacement: 'floor',
    controlsLayout: {
      'top-left': ['animation'],
      'top-center': [],
      'top-right': [],
      'bottom-left': ['screenshot', 'ar'],
      'bottom-center': [],
      'bottom-right': ['zoomIn', 'zoomOut', 'reset', 'fullscreen']
    },
    iosSrc: '',
    variant: '',
    fixSkinnedBbox: true,
    shadow: true,
    maintainSize: false,
    // Hotspots — see app/lib/hotspots.ts, which this mirrors.
    hotspots: [],
    showHotspots: true,
    hotspotColor: '#2a78d6',
    hotspotLabel: 'number', // 'number' | 'title'
    hotspotTrigger: 'click' // 'click' | 'hover'
  };

  // view3d's value for one AR session type: `true` turns it on with defaults,
  // an object turns it on with options. `vertical` is what both Android paths
  // (WebXR and Scene Viewer) read to place the model on a wall; Quick Look has
  // no equivalent — iOS anchors the model as its .usdz says.
  // MUST match arSessionOption in app/components/ViewerPreview.tsx.
  function arSessionOption(enabled, placement) {
    if (!enabled) return false;
    return placement === 'wall' ? { vertical: true } : true;
  }

  /*
   * In-browser AR (WebXR) on Android: the same options, plus where Chrome's
   * on-screen layer ("dom-overlay") lives during the session.
   *
   * view3d's default puts that layer inside the viewer, deep in the theme's
   * markup; Chrome then drew a frozen snapshot of the website over the
   * camera, so the AR running underneath could not be seen. This is one
   * empty, transparent element directly under <body>: over the camera it
   * shows nothing. Shared by every viewer — one AR session runs at a time.
   */
  var arOverlayRoot = null;

  function getArOverlayRoot() {
    if (!arOverlayRoot || !document.body.contains(arOverlayRoot)) {
      arOverlayRoot = document.createElement('div');
      arOverlayRoot.className = 'e3d-ar-root';
      document.body.appendChild(arOverlayRoot);
    }
    return arOverlayRoot;
  }

  /*
   * In-browser AR without Chrome's DOM overlay.
   *
   * view3d always asks WebXR for "dom-overlay" (a page layer drawn over the
   * camera) as a *required* feature, with no option to turn it off. On the
   * Android Chrome the merchant tested, granting it put the page itself
   * fullscreen and frozen over the camera — the AR ran underneath but could
   * not be seen — wherever the overlay element lived. Nothing in this app
   * uses that layer: the model, its shadow and the placement ring are drawn
   * by WebGL into the camera view, and move/rotate/pinch come from WebXR's
   * own input events (view3d's AR controls), not from the DOM. So the request
   * is made without it. Leaving the browser's AR is the phone's Back gesture,
   * as before.
   *
   * Patched once, on view3d's WebARSession class, when the library is first
   * used; a missing class (another view3d build) leaves view3d's behaviour
   * as it was.
   */
  var webXrPatched = false;

  function patchWebXrNoOverlay() {
    if (webXrPatched) return;
    var V = window.View3D;
    var Session = V && (V.WebARSession || (V.default && V.default.WebARSession));
    var proto = Session && Session.prototype;
    if (!proto || typeof proto._getAllXRFeatures !== 'function') return;
    webXrPatched = true;
    var original = proto._getAllXRFeatures;
    proto._getAllXRFeatures = function () {
      var features = original.apply(this, arguments) || {};
      ['requiredFeatures', 'optionalFeatures'].forEach(function (key) {
        if (Array.isArray(features[key])) {
          features[key] = features[key].filter(function (f) {
            return f !== 'dom-overlay';
          });
        }
      });
      delete features.domOverlay;
      return features;
    };
  }

  function webArOption(enabled, placement) {
    if (!enabled) return false;
    var opt = { overlayRoot: getArOverlayRoot() };
    if (placement === 'wall') opt.vertical = true;
    return opt;
  }

  /*
   * Which controls sit in each spot, in order, as arranged by dragging them in
   * the admin preview. MUST match CONTROL_SLOTS / CONTROL_ITEMS /
   * normalizeControlsLayout / fullscreenCloseSlot in app/lib/viewer-config.ts,
   * which this file can't import.
   */
  var CONTROL_SLOTS = [
    'top-left', 'top-center', 'top-right',
    'bottom-left', 'bottom-center', 'bottom-right'
  ];
  var CONTROL_ITEMS = ['zoomIn', 'zoomOut', 'reset', 'fullscreen', 'screenshot', 'ar', 'animation'];

  // Unknown spots and controls dropped, a control listed twice kept the first
  // time, and any control missing put back in its default spot — so one added
  // in a later release still shows on models saved before it existed.
  function normalizeControlsLayout(raw) {
    var out = {};
    var seen = {};
    CONTROL_SLOTS.forEach(function (slot) {
      out[slot] = [];
      var list = raw && typeof raw === 'object' ? raw[slot] : null;
      if (!Array.isArray(list)) return;
      list.forEach(function (id) {
        if (CONTROL_ITEMS.indexOf(id) !== -1 && !seen[id]) {
          seen[id] = true;
          out[slot].push(id);
        }
      });
    });
    CONTROL_SLOTS.forEach(function (slot) {
      DEFAULTS.controlsLayout[slot].forEach(function (id) {
        if (!seen[id]) out[slot].push(id);
      });
    });
    return out;
  }

  // The fullscreen close button's spot: top-right unless a control was moved
  // there, then the first spot no control is using.
  function fullscreenCloseSlot(layout) {
    var order = ['top-right', 'top-left', 'top-center', 'bottom-right', 'bottom-left', 'bottom-center'];
    for (var i = 0; i < order.length; i++) {
      if (!layout[order[i]].length) return order[i];
    }
    return 'top-right';
  }

  function getCtor() {
    if (!window.View3D) return null;
    return window.View3D.default || window.View3D;
  }

  // Byte-for-byte the same lucide glyphs the admin preview's mini toolbar
  // renders (ViewerPreview.tsx imports Camera/ZoomIn/ZoomOut/RotateCcw/
  // Maximize/Minimize/ChevronUp/ChevronDown from lucide-react), inlined here
  // rather than approximated — the storefront toolbar previously mixed in
  // Material-style *filled* glyphs for reset/fullscreen, which is why the two
  // toolbars didn't look alike. lucide's default attributes (24x24 box,
  // fill:none, stroke:currentColor, round caps/joins) are reproduced, except for
  // the stroke width: 2.5 instead of lucide's 2, deliberately heavier so the
  // controls hold up against a 3D scene behind them. The admin matches via CSS
  // (see .preview-toolbar-btn svg in app/app.css).
  function icon(body) {
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"' +
      ' stroke="currentColor" stroke-width="2.5" stroke-linecap="round"' +
      ' stroke-linejoin="round">' + body + '</svg>'
    );
  }

  var FULLSCREEN_ICON = icon(
    '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/>' +
    '<path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>'
  );
  var EXIT_FULLSCREEN_ICON = icon(
    '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/>' +
    '<path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>'
  );
  var RESET_ICON = icon(
    '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>' +
    '<path d="M3 3v5h5"/>'
  );
  var ZOOM_IN_ICON = icon(
    '<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/>' +
    '<line x1="11" x2="11" y1="8" y2="14"/><line x1="8" x2="14" y1="11" y2="11"/>'
  );
  var ZOOM_OUT_ICON = icon(
    '<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/>' +
    '<line x1="8" x2="14" y1="11" y2="11"/>'
  );
  var CAMERA_ICON = icon(
    '<path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"/>' +
    '<circle cx="12" cy="13" r="3"/>'
  );
  // A cube in perspective — the convention every AR viewer uses (Google's
  // Scene Viewer, model-viewer's own button), so it reads as "view in your
  // room" without a label.
  var AR_ICON = icon(
    '<path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="m3 7 9 5 9-5"/>' +
    '<path d="M12 12v10"/>'
  );
  var CLOSE_ICON = icon('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>');
  var CHEVRON_UP_ICON = icon('<path d="m18 15-6-6-6 6"/>');
  var CHEVRON_DOWN_ICON = icon('<path d="m6 9 6 6 6-6"/>');
  var SPINNER_ICON = icon('<path d="M21 12a9 9 0 1 1-6.219-8.56"/>');
  var ALERT_ICON = icon(
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/>' +
    '<path d="M12 9v4"/><path d="M12 17h.01"/>'
  );

  /* ---------------------------------------------------------------------------
   * QR code, for the "view in your room" hand-off on desktop.
   *
   * Byte mode at error-correction level M, smallest version that fits. Written
   * out here rather than pulled in as a library: a storefront script can't
   * import, a CDN copy would be a third-party request on every product page for
   * the sake of a button most shoppers never press, and an image API would send
   * the store's URLs to someone else. Follows the reference algorithm in ISO/IEC
   * 18004 (and Project Nayuki's MIT implementation of it), minus the parts a URL
   * never needs: other segment modes and other ECC levels.
   *
   * Mask choice scores penalty rules 1, 2 and 4 and skips rule 3 (finder-like
   * runs). Every mask decodes; the score only picks the one that scans easiest.
   * ------------------------------------------------------------------------- */

  // Level M, indexed by version (0 unused).
  var QR_ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
  var QR_NUM_BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];

  function qrRawModules(ver) {
    var n = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var align = Math.floor(ver / 7) + 2;
      n -= (25 * align - 10) * align - 55;
      if (ver >= 7) n -= 36;
    }
    return n;
  }

  function qrDataCodewords(ver) {
    return Math.floor(qrRawModules(ver) / 8) - QR_ECC_PER_BLOCK[ver] * QR_NUM_BLOCKS[ver];
  }

  function gfMul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xff;
  }

  function rsDivisor(degree) {
    var result = [];
    for (var i = 0; i < degree - 1; i++) result.push(0);
    result.push(1);
    var root = 1;
    for (i = 0; i < degree; i++) {
      for (var j = 0; j < degree; j++) {
        result[j] = gfMul(result[j], root);
        if (j + 1 < degree) result[j] ^= result[j + 1];
      }
      root = gfMul(root, 0x02);
    }
    return result;
  }

  function rsRemainder(data, divisor) {
    var result = divisor.map(function () {
      return 0;
    });
    data.forEach(function (b) {
      var factor = b ^ result.shift();
      result.push(0);
      for (var i = 0; i < divisor.length; i++) result[i] ^= gfMul(divisor[i], factor);
    });
    return result;
  }

  function qrAlignmentPositions(ver) {
    if (ver === 1) return [];
    var count = Math.floor(ver / 7) + 2;
    var step = Math.floor((ver * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
    var result = [6];
    for (var pos = ver * 4 + 10; result.length < count; pos -= step) result.splice(1, 0, pos);
    return result;
  }

  var QR_MASKS = [
    function (x, y) { return (x + y) % 2 === 0; },
    function (x, y) { return y % 2 === 0; },
    function (x, y) { return x % 3 === 0; },
    function (x, y) { return (x + y) % 3 === 0; },
    function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; },
    function (x, y) { return ((x * y) % 2) + ((x * y) % 3) === 0; },
    function (x, y) { return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; },
    function (x, y) { return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; }
  ];

  // Returns the module grid (rows of booleans, true = dark), or null when the
  // text is too long for any version.
  function qrEncode(text) {
    var bytes = [];
    var utf8 = unescape(encodeURIComponent(text));
    for (var i = 0; i < utf8.length; i++) bytes.push(utf8.charCodeAt(i));

    var ver;
    for (ver = 1; ver <= 40; ver++) {
      var countBits = ver <= 9 ? 8 : 16;
      if (4 + countBits + bytes.length * 8 <= qrDataCodewords(ver) * 8) break;
    }
    if (ver > 40) return null;

    // Data bits: byte-mode indicator, length, payload, then terminator, byte
    // alignment and the alternating pad bytes.
    var bits = [];
    function put(val, len) {
      for (var b = len - 1; b >= 0; b--) bits.push((val >>> b) & 1);
    }
    put(4, 4);
    put(bytes.length, ver <= 9 ? 8 : 16);
    bytes.forEach(function (b) {
      put(b, 8);
    });
    var capacity = qrDataCodewords(ver) * 8;
    put(0, Math.min(4, capacity - bits.length));
    put(0, (8 - (bits.length % 8)) % 8);
    for (var pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
    var data = [];
    for (i = 0; i < bits.length; i += 8) {
      var byte = 0;
      for (var k = 0; k < 8; k++) byte = (byte << 1) | bits[i + k];
      data.push(byte);
    }

    // Split into blocks, append each block's ECC, interleave.
    var numBlocks = QR_NUM_BLOCKS[ver];
    var eccLen = QR_ECC_PER_BLOCK[ver];
    var rawCodewords = Math.floor(qrRawModules(ver) / 8);
    var numShort = numBlocks - (rawCodewords % numBlocks);
    var shortLen = Math.floor(rawCodewords / numBlocks);
    var divisor = rsDivisor(eccLen);
    var blocks = [];
    for (var b = 0, off = 0; b < numBlocks; b++) {
      var len = shortLen - eccLen + (b < numShort ? 0 : 1);
      var dat = data.slice(off, off + len);
      off += len;
      var ecc = rsRemainder(dat, divisor);
      if (b < numShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    var codewords = [];
    for (i = 0; i < blocks[0].length; i++) {
      for (var j = 0; j < blocks.length; j++) {
        if (i !== shortLen - eccLen || j >= numShort) codewords.push(blocks[j][i]);
      }
    }

    var size = ver * 4 + 17;
    var grid = [];
    var reserved = [];
    for (i = 0; i < size; i++) {
      grid.push(new Array(size).fill(false));
      reserved.push(new Array(size).fill(false));
    }
    function setFn(x, y, dark) {
      grid[y][x] = dark;
      reserved[y][x] = true;
    }

    // Function patterns: timing, finders (with separators), alignment.
    for (i = 0; i < size; i++) {
      setFn(6, i, i % 2 === 0);
      setFn(i, 6, i % 2 === 0);
    }
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (c) {
      for (var dy = -4; dy <= 4; dy++) {
        for (var dx = -4; dx <= 4; dx++) {
          var d = Math.max(Math.abs(dx), Math.abs(dy));
          var x = c[0] + dx;
          var y = c[1] + dy;
          if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, d !== 2 && d !== 4);
        }
      }
    });
    var align = qrAlignmentPositions(ver);
    var last = align.length - 1;
    for (i = 0; i < align.length; i++) {
      for (j = 0; j < align.length; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
        for (var dy = -2; dy <= 2; dy++) {
          for (var dx = -2; dx <= 2; dx++) {
            setFn(align[i] + dx, align[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
          }
        }
      }
    }

    function drawFormat(mask) {
      // Level M's format indicator is 00.
      var val = mask;
      var rem = val;
      for (var n = 0; n < 10; n++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var f = ((val << 10) | rem) ^ 0x5412;
      function bit(n) {
        return ((f >>> n) & 1) !== 0;
      }
      for (n = 0; n <= 5; n++) setFn(8, n, bit(n));
      setFn(8, 7, bit(6));
      setFn(8, 8, bit(7));
      setFn(7, 8, bit(8));
      for (n = 9; n < 15; n++) setFn(14 - n, 8, bit(n));
      for (n = 0; n < 8; n++) setFn(size - 1 - n, 8, bit(n));
      for (n = 8; n < 15; n++) setFn(8, size - 15 + n, bit(n));
      setFn(8, size - 8, true);
    }
    drawFormat(0); // reserves the format areas before data is placed

    if (ver >= 7) {
      var rem = ver;
      for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      var vbits = (ver << 12) | rem;
      for (i = 0; i < 18; i++) {
        var on = ((vbits >>> i) & 1) !== 0;
        var a = size - 11 + (i % 3);
        var c = Math.floor(i / 3);
        setFn(a, c, on);
        setFn(c, a, on);
      }
    }

    // Data, in the two-column zigzag from the bottom-right corner.
    var bitIndex = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (j = 0; j < 2; j++) {
          var x = right - j;
          var upward = ((right + 1) & 2) === 0;
          var y = upward ? size - 1 - vert : vert;
          if (!reserved[y][x] && bitIndex < codewords.length * 8) {
            grid[y][x] = ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) !== 0;
            bitIndex++;
          }
        }
      }
    }

    function applyMask(m) {
      var fn = QR_MASKS[m];
      for (var y = 0; y < size; y++) {
        for (var x = 0; x < size; x++) {
          if (!reserved[y][x] && fn(x, y)) grid[y][x] = !grid[y][x];
        }
      }
    }

    function penalty() {
      var score = 0;
      var dark = 0;
      for (var y = 0; y < size; y++) {
        var runX = 1;
        var runY = 1;
        for (var x = 0; x < size; x++) {
          if (grid[y][x]) dark++;
          if (x > 0) {
            // Rule 1, along rows (grid[y][x]) and columns (grid[x][y]).
            if (grid[y][x] === grid[y][x - 1]) runX++;
            else runX = 1;
            if (runX === 5) score += 3;
            else if (runX > 5) score++;
            if (grid[x][y] === grid[x - 1][y]) runY++;
            else runY = 1;
            if (runY === 5) score += 3;
            else if (runY > 5) score++;
          }
          // Rule 2: 2x2 blocks of one colour.
          if (
            x > 0 && y > 0 &&
            grid[y][x] === grid[y][x - 1] &&
            grid[y][x] === grid[y - 1][x] &&
            grid[y][x] === grid[y - 1][x - 1]
          ) {
            score += 3;
          }
        }
      }
      // Rule 4: dark/light balance.
      var total = size * size;
      score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
      return score;
    }

    var best = 0;
    var bestScore = Infinity;
    for (var m = 0; m < 8; m++) {
      applyMask(m);
      drawFormat(m);
      var s = penalty();
      if (s < bestScore) {
        best = m;
        bestScore = s;
      }
      applyMask(m); // XOR again to undo
    }
    applyMask(best);
    drawFormat(best);
    return grid;
  }

  // The grid as an SVG with the four-module quiet zone the spec requires. One
  // path rather than a rect per module keeps a version-10 code to a single node.
  function qrSvg(text) {
    var grid = qrEncode(text);
    if (!grid) return null;
    var size = grid.length;
    var d = '';
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        if (grid[y][x]) d += 'M' + (x + 4) + ' ' + (y + 4) + 'h1v1h-1z';
      }
    }
    var dim = size + 8;
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dim + ' ' + dim +
      '" shape-rendering="crispEdges" role="img" aria-label="QR code">' +
      '<rect width="' + dim + '" height="' + dim + '" fill="#ffffff"/>' +
      '<path d="' + d + '" fill="#000000"/></svg>'
    );
  }

  // The admin preview's buttons carry real tooltips (a Radix tooltip styled
  // solid near-black, 200ms delay, above the button, portalled to
  // <body>); the storefront only had `title`, so the same buttons showed the
  // browser's plain yellow OS tooltip after a much longer delay. This is that
  // same tooltip, and it has to live on <body> rather than inside the viewer
  // for the same reason Radix portals: .viewer-3d is `overflow: hidden`, which
  // would clip a tooltip anchored to an edge button.
  var TOOLTIP_DELAY = 200;
  var tooltipEl = null;
  var tooltipTimer = 0;
  var tooltipTarget = null;
  var tooltipBelow = false;

  function hideTooltip() {
    clearTimeout(tooltipTimer);
    tooltipTarget = null;
    if (tooltipEl) tooltipEl.classList.remove('is-visible');
  }

  // `below` asks for the tooltip under the button instead of over it — what a
  // top-corner button wants, since above it there's usually nothing but the edge
  // of the viewport. Either side flips to the other when it doesn't fit, so this
  // is a preference rather than a hard placement, matching how the admin's
  // `side` prop behaves.
  function placeTooltip(target, below) {
    // Measured after the text is set but while still transparent, so the box
    // is laid out at its final size before being positioned.
    var rect = target.getBoundingClientRect();
    var tip = tooltipEl.getBoundingClientRect();
    var left = rect.left + rect.width / 2 - tip.width / 2;
    var above = rect.top - tip.height - 8;
    var under = rect.bottom + 8;
    var top;
    if (below) {
      top = under + tip.height + 4 > window.innerHeight && above >= 4 ? above : under;
    } else {
      top = above < 4 ? under : above;
    }
    left = Math.max(4, Math.min(left, window.innerWidth - tip.width - 4));
    tooltipEl.style.left = left + 'px';
    tooltipEl.style.top = top + 'px';
  }

  function showTooltip(target, text, below) {
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.className = 'viewer-3d-tooltip';
      tooltipEl.setAttribute('role', 'tooltip');
    }
    // In native fullscreen the browser paints only the fullscreen element's own
    // subtree, so a tooltip parented to <body> is simply invisible — it has to be
    // moved inside the fullscreen element while that lasts, and back to <body>
    // afterwards.
    var host = nativeFullscreenElement() || document.body;
    if (tooltipEl.parentNode !== host) host.appendChild(tooltipEl);
    tooltipTarget = target;
    tooltipBelow = !!below;
    tooltipEl.textContent = text;
    placeTooltip(target, tooltipBelow);
    tooltipEl.classList.add('is-visible');
  }

  // `getLabel` is a function rather than a string because two of these labels
  // change with state (Fullscreen/Exit fullscreen) and one suppresses itself
  // entirely while its popup is open, matching the admin.
  function attachTooltip(btn, getLabel, below) {
    btn.addEventListener('mouseenter', function () {
      clearTimeout(tooltipTimer);
      tooltipTimer = setTimeout(function () {
        var label = getLabel();
        if (label) showTooltip(btn, label, below);
      }, TOOLTIP_DELAY);
    });
    // Keyboard focus shows it immediately — no hover delay to wait out.
    btn.addEventListener('focus', function () {
      var label = getLabel();
      if (label) showTooltip(btn, label, below);
    });
    btn.addEventListener('mouseleave', hideTooltip);
    btn.addEventListener('blur', hideTooltip);
    btn.addEventListener('click', hideTooltip);
  }

  // Fixed positioning is relative to the viewport, so anything that moves the
  // button under it invalidates the placement. This re-places rather than
  // hides: focusing a button can itself scroll it into view, and hiding on
  // scroll meant a keyboard user's tooltip was dismissed by the very act of
  // tabbing to the button. rAF-throttled, since scroll fires per frame.
  var tooltipRaf = 0;
  function repositionTooltip() {
    if (!tooltipTarget) return;
    cancelAnimationFrame(tooltipRaf);
    tooltipRaf = requestAnimationFrame(function () {
      if (!tooltipTarget) return;
      if (!tooltipTarget.isConnected) return hideTooltip();
      placeTooltip(tooltipTarget, tooltipBelow);
    });
  }
  window.addEventListener('scroll', repositionTooltip, true);
  window.addEventListener('resize', repositionTooltip);

  // Fullscreen API, with the WebKit-prefixed spellings Safari still needs.
  // `document.fullscreenElement` is the source of truth for whether we're in
  // fullscreen — a local boolean would go stale the moment the user leaves via
  // Escape, F11 or the browser's own control, none of which run our code.
  var FS_CHANGE_EVENTS = ['fullscreenchange', 'webkitfullscreenchange'];

  function nativeFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  // Returns a promise when the request was made, or null when it couldn't be —
  // no API at all, or a synchronous throw (which is how some engines refuse it).
  // A null return and a rejected promise mean the same thing to the caller.
  function requestNativeFullscreen(el) {
    var request = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!request) return null;
    try {
      var result = request.call(el);
      return result && typeof result.then === 'function'
        ? result
        : Promise.resolve();
    } catch (err) {
      return null;
    }
  }

  function exitNativeFullscreen() {
    var exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (!exit) return;
    try {
      var result = exit.call(document);
      if (result && typeof result.catch === 'function') result.catch(function () {});
    } catch (err) {}
  }

  // view3d's crossFade() blends via three's crossFadeTo with the `warp` flag on,
  // which morphs the two clips' playback speeds toward each other for the length
  // of the blend — and leaves the *outgoing* action's timeScale sitting at
  // outgoingDuration / incomingDuration forever. view3d restores only the
  // incoming action, so every switch between clips of different lengths strands
  // a wrong speed on the clip you just left: select it again and it plays at
  // that speed (a 2.5s clip left after a 0.4s one comes back 6.25x too fast).
  // Normalising every action once the blend has finished is what keeps clip
  // speeds correct across repeated switching. setEffectiveTimeScale() also calls
  // stopWarping() internally, so this clears both past residue and any warp
  // still in flight.
  function normalizeTimeScales(animator) {
    var actions = (animator && animator.actions) || [];
    for (var i = 0; i < actions.length; i++) {
      if (actions[i]) actions[i].setEffectiveTimeScale(1);
    }
  }

  function stepZoom(view3d, delta) {
    try {
      var camera = view3d.camera;
      if (!camera) return;
      var pose = camera.currentPose.clone();
      var maxZoom = camera.baseFov - 5;
      pose.zoom = Math.min(maxZoom, Math.max(-100, pose.zoom + delta));
      camera.reset(300, undefined, pose);
    } catch (err) {}
  }

  // Bottom-left bar holds the capture button on its own; the bottom-right bar
  /*
   * Enforces the rotate / translate / zoom permissions.
   *
   * Passing `rotate: false`, `translate: false` or `zoom: false` to View3D looks
   * like it should work and does nothing at all. Its OrbitControl builds each
   * sub-control with `bc(option)`, and bc is:
   *
   *     function bc(e){ return "object"==typeof e ? e : {} }
   *
   * so a boolean is discarded and the control is constructed with defaults.
   * OrbitControl.enable() then enables all three unconditionally, without
   * consulting the options at all. Net effect: all three settings were inert —
   * the wheel still zoomed, drag still rotated, and pan still panned.
   *
   * The sub-controls are reachable via view3d.control.{rotate,translate,zoom} and
   * each has a real disable(), so the permissions are applied by hand once the
   * control is up.
   */
  function applyControlPermissions(view3d, cfg) {
    var control = view3d.control;
    if (!control) return;
    [
      ['rotate', cfg.rotate],
      ['translate', cfg.translate],
      ['zoom', cfg.zoom]
    ].forEach(function (pair) {
      if (pair[1]) return;
      var sub = control[pair[0]];
      if (sub && sub.disable) {
        try {
          sub.disable();
        } catch (e) {}
      }
    });
  }

  /*
   * Whether a desktop shopper should be offered a QR code to open this page on
   * their phone and use AR there.
   *
   * Only on a device with a mouse: a phone or tablet that can't enter AR (an
   * older Android, Firefox) is already the device a QR code would send them to.
   * And only when some phone could actually use it — Quick Look on its own does
   * nothing without a .usdz, so quickLook with no iosSrc doesn't count.
   */
  function canHandOffArToPhone(cfg) {
    if (!(cfg.webAR || cfg.sceneViewer || (cfg.quickLook && cfg.iosSrc))) return false;
    try {
      return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    } catch (e) {
      return false;
    }
  }

  // The page as the phone should open it. Only `variant` survives from the
  // query string: it picks what is shown, while everything else there is
  // tracking that would only make the code denser and harder to scan. The hash
  // goes too.
  function arHandOffUrl() {
    try {
      var url = new URL(window.location.href);
      var variant = url.searchParams.get('variant');
      url.search = variant ? '?variant=' + encodeURIComponent(variant) : '';
      url.hash = '';
      return url.href;
    } catch (e) {
      return window.location.href.split('#')[0];
    }
  }

  /*
   * The QR panel: an overlay over the viewer itself rather than a popup off
   * the button, since a viewer can be short enough that a popup would be
   * clipped by its `overflow: hidden`. Built lazily on first open — most
   * shoppers never press it — and the code is redrawn on every open, because
   * variant pickers rewrite ?variant= in place as the shopper chooses. Closes on the close button, a click on the
   * backdrop or Escape, and hands focus back through `onClose`.
   */
  function buildArQrOverlay(el, onClose) {
    var overlay = null;
    var code = null;
    var isOpen = false;

    function build() {
      overlay = document.createElement('div');
      overlay.className = 'viewer-3d-ar-qr';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-label', 'View in your room on your phone');

      var card = document.createElement('div');
      card.className = 'viewer-3d-ar-qr-card';
      code = document.createElement('div');
      code.className = 'viewer-3d-ar-qr-code';
      var title = document.createElement('p');
      title.className = 'viewer-3d-ar-qr-title';
      title.textContent = 'View in your room';
      var text = document.createElement('p');
      text.className = 'viewer-3d-ar-qr-text';
      text.textContent = 'Scan with your phone’s camera to see this in AR.';
      card.appendChild(code);
      card.appendChild(title);
      card.appendChild(text);
      overlay.appendChild(card);

      var closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'viewer-3d-mini-toolbar-btn viewer-3d-ar-qr-close';
      closeBtn.setAttribute('aria-label', 'Close');
      closeBtn.innerHTML = CLOSE_ICON;
      closeBtn.addEventListener('click', close);
      overlay.appendChild(closeBtn);

      // The overlay sits over the canvas; keep presses on it from reaching
      // view3d's controls underneath, and let a click on the backdrop close it.
      ['pointerdown', 'mousedown', 'touchstart', 'wheel'].forEach(function (evt) {
        overlay.addEventListener(evt, function (e) {
          e.stopPropagation();
        });
      });
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) close();
      });
      el.appendChild(overlay);
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') close();
    }

    function open() {
      var svg = qrSvg(arHandOffUrl());
      if (!svg) return;
      if (!overlay) build();
      code.innerHTML = svg;
      isOpen = true;
      overlay.classList.add('is-open');
      document.addEventListener('keydown', onKeyDown);
      overlay.querySelector('.viewer-3d-ar-qr-close').focus();
    }

    function close() {
      if (!isOpen) return;
      isOpen = false;
      overlay.classList.remove('is-open');
      document.removeEventListener('keydown', onKeyDown);
      if (onClose) onClose();
    }

    // A URL too long for any QR version is the one way this can't work; say so
    // up front so the caller doesn't render a button that does nothing.
    if (!qrEncode(arHandOffUrl())) return null;

    return {
      toggle: function () {
        if (isOpen) close();
        else open();
      }
    };
  }

  // holds zoom in / zoom out / reset / fullscreen. The animation selector is not
  // here at all — it gets its own bar in the top-left corner (see
  // buildAnimationList), well clear of these so its popup never covers them.
  function buildMiniToolbar(el, view3d, cfg) {
    // Plain reads, not `!== false` fallbacks — cfg is already merged onto
    // DEFAULTS, and the old fallbacks defaulted these on independently of what
    // the app considers default.
    // Gated on cfg.zoom as well as the button setting. "Allow zoom" is the
    // capability; these buttons are just one way to reach it. They drive
    // camera.reset() directly (see stepZoom), which bypasses view3d's zoom
    // *control* entirely — so with zoom disabled the wheel and pinch correctly
    // stopped working while these two carried on zooming regardless.
    var showZoom = cfg.showZoomButtons && cfg.zoom;
    var showReset = cfg.showCameraResetButton;
    var showFullscreen = cfg.showFullscreenButton;
    var showScreenshot = cfg.showScreenshotButton;

    /*
     * One bar per spot, holding a marker per control in the order the
     * merchant arranged them. A control is slotted in at its own marker, so
     * the ones that arrive later — AR once the device has answered, the
     * animation switcher once the model has loaded — still land in their
     * place. A bar is attached only once it holds a real control: an empty one
     * would still run its entrance animation and catch pointer events.
     */
    var bars = {};
    var marks = {};
    CONTROL_SLOTS.forEach(function (slot) {
      cfg.controlsLayout[slot].forEach(function (id) {
        if (!bars[slot]) {
          bars[slot] = document.createElement('div');
          bars[slot].className = 'viewer-3d-mini-toolbar pos-' + slot;
        }
        var mark = document.createComment(id);
        bars[slot].appendChild(mark);
        marks[id] = { slot: slot, mark: mark };
      });
    });

    function place(id, node) {
      var m = marks[id];
      if (!m) return;
      m.mark.parentNode.insertBefore(node, m.mark);
      if (!bars[m.slot].parentNode) el.appendChild(bars[m.slot]);
    }
    place.slotOf = function (id) {
      return marks[id] ? marks[id].slot : 'bottom-right';
    };

    // Tooltips open under a button against the top edge — above it there's
    // no room — and over it everywhere else.
    function makeButton(label, icon, onClick, tooltipBelow) {
      var btn = document.createElement('button');
      btn.type = 'button';
      // An explicit class rather than letting CSS match `button` inside the
      // toolbar: the animation-clip list is nested inside the toolbar too, so a
      // descendant selector would size its rows like icon buttons.
      btn.className = 'viewer-3d-mini-toolbar-btn';
      btn.setAttribute('aria-label', label);
      btn.innerHTML = icon;
      btn.addEventListener('click', onClick);
      // Reads aria-label at hover time rather than closing over `label`, so the
      // fullscreen button's tooltip follows the label it swaps to. No `title`
      // attribute — it would stack the OS tooltip on top of ours.
      attachTooltip(btn, function () {
        return btn.getAttribute('aria-label');
      }, tooltipBelow);
      return btn;
    }

    function addButton(id, label, icon, onClick) {
      var feature = FEATURE_EVENTS[id];
      var handler = feature
        ? function () {
            track(el, feature);
            return onClick.apply(this, arguments);
          }
        : onClick;
      var btn = makeButton(label, icon, handler, place.slotOf(id).indexOf('top') === 0);
      place(id, btn);
      return btn;
    }

    /*
     * "View in your room".
     *
     * The webAR / sceneViewer / quickLook settings only tell view3d which
     * session types it may use — they start nothing. Without a call to
     * view3d.ar.enter() there was no way to reach AR at all, so those three
     * switches did nothing a shopper could see.
     *
     * Deliberately not given a settings toggle of its own: it is added only
     * when the merchant has left at least one AR session type on AND the
     * device can actually enter one, so on a desktop — where the great
     * majority of these pages are viewed — nothing is rendered. A fourth
     * switch would only be a way to hide a button that already hides itself.
     *
     * isAvailable() is async (WebXR's is a promise), so the button appears a
     * frame or two after the rest of the toolbar. It is appended to the
     * left-hand bar, away from the zoom cluster, so nothing shifts under a
     * finger that is already reaching for a control.
     *
     * Where AR isn't available but the device is a desktop, the same button
     * opens a QR code of this page instead (see buildArQrOverlay), so the
     * shopper can carry on on their phone.
     */
    if (cfg.webAR || cfg.sceneViewer || cfg.quickLook) {
      try {
        // A rejection means "no" as well: inside an iframe without
        // allow="xr-spatial-tracking" (the theme editor, for one) WebXR's
        // isSessionSupported() throws a SecurityError instead of answering
        // false, which used to skip the QR fallback along with the button.
        view3d.ar.isAvailable().catch(function () {
          return false;
        }).then(function (available) {
          if (!document.contains(el)) return;
          if (available) {
            addButton('ar', 'View in your room', AR_ICON, function () {
              track(el, 'ar');
              view3d.ar.enter().catch(function (err) {
                // Permission refused, or an AR session already running. Silence
                // here would look identical to a dead button.
                console.warn('[viewer-3d] could not enter AR:', err);
              });
            });
          } else if (canHandOffArToPhone(cfg)) {
            var qrBtn;
            var qr = buildArQrOverlay(el, function () {
              qrBtn.focus();
            });
            if (!qr) return;
            qrBtn = addButton('ar', 'View in your room on your phone', AR_ICON, function () {
              track(el, 'ar');
              hideTooltip();
              qr.toggle();
            });
          }
        }).catch(function () {});
      } catch (e) {}
    }

    if (showZoom) {
      addButton('zoomIn', 'Zoom in', ZOOM_IN_ICON, function () {
        stepZoom(view3d, 15);
      });
      addButton('zoomOut', 'Zoom out', ZOOM_OUT_ICON, function () {
        stepZoom(view3d, -15);
      });
    }
    if (showReset) {
      addButton('reset', 'Resets view', RESET_ICON, function () {
        if (view3d.camera) view3d.camera.reset(500);
      });
    }
    if (showFullscreen) {
      // Uses the real Fullscreen API so the viewer takes over the whole *screen*
      // — browser chrome included — rather than just filling the page viewport.
      //
      // The CSS maximize below is kept as a fallback, not as the primary path:
      // requestFullscreen() is genuinely unavailable in some places this widget
      // renders (the theme editor preview and app-embed previews are iframes
      // without `allow="fullscreen"`), and it fails inconsistently there —
      // a rejected promise on some engines, a synchronous throw on others, and on
      // a few nothing at all. So: ask for real fullscreen, and if the request is
      // refused in any of those ways, fall back to the maximize so the button
      // still does something. On a normal storefront page the native path is the
      // one that runs.
      var maximized = false;
      var prevOverflow = '';
      var prevParent = null;
      var prevNextSibling = null;

      var setFsIcon = function (isOn) {
        fsBtn.innerHTML = isOn ? EXIT_FULLSCREEN_ICON : FULLSCREEN_ICON;
        fsBtn.setAttribute('aria-label', isOn ? 'Exit fullscreen' : 'Fullscreen');
      };

      var exitMaximize = function () {
        if (!maximized) return;
        maximized = false;
        el.classList.remove('viewer-3d--pseudo-fullscreen');
        if (prevParent) {
          prevParent.insertBefore(el, prevNextSibling);
          prevParent = null;
          prevNextSibling = null;
        }
        document.body.style.overflow = prevOverflow;
        document.removeEventListener('keydown', onKeyDown);
        setFsIcon(false);
        if (view3d.resize) view3d.resize();
      };

      var onKeyDown = function (e) {
        if (e.key === 'Escape') exitMaximize();
      };

      var enterMaximize = function () {
        maximized = true;
        prevParent = el.parentNode;
        prevNextSibling = el.nextSibling;
        document.body.appendChild(el);
        el.classList.add('viewer-3d--pseudo-fullscreen');
        prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        document.addEventListener('keydown', onKeyDown);
        setFsIcon(true);
        if (view3d.resize) view3d.resize();
      };

      // The browser drives the icon and the resize through fullscreenchange
      // rather than the click handler doing it, because fullscreen can also be
      // left by means we never see: Escape, F11, the browser's own exit affordance
      // or switching tabs. Listening to the event is the only way the button
      // reflects reality in all of those cases.
      var onFsChange = function () {
        var on = nativeFullscreenElement() === el;
        setFsIcon(on);
        if (view3d.resize) view3d.resize();
      };
      FS_CHANGE_EVENTS.forEach(function (evt) {
        document.addEventListener(evt, onFsChange);
      });

      // A dedicated close button in the top-right corner, shown only while
      // fullscreen is active. Its own bar rather than a member of an existing
      // one, because it's the only control in that corner — and a child of `el`
      // so it's inside the fullscreen element and therefore actually painted
      // (in native fullscreen the browser renders nothing outside that subtree).
      // Visibility is driven entirely by CSS off :fullscreen / the fallback
      // class, so there's no state here to fall out of sync.
      var exitFullscreen = function () {
        if (maximized) exitMaximize();
        else if (nativeFullscreenElement()) exitNativeFullscreen();
      };

      var closeBar = document.createElement('div');
      var closeSlot = fullscreenCloseSlot(cfg.controlsLayout);
      closeBar.className =
        'viewer-3d-mini-toolbar pos-' + closeSlot + ' viewer-3d-fs-only';
      closeBar.appendChild(
        makeButton('Exit fullscreen', CLOSE_ICON, exitFullscreen, closeSlot.indexOf('top') === 0)
      );
      el.appendChild(closeBar);

      var fsBtn = addButton('fullscreen', 'Fullscreen', FULLSCREEN_ICON, function () {
        if (maximized) {
          exitMaximize();
          return;
        }
        if (nativeFullscreenElement()) {
          exitNativeFullscreen();
          return;
        }
        // A rejection or a synchronous failure both mean the request was refused,
        // so the fallback covers either.
        var request = requestNativeFullscreen(el);
        if (!request) {
          enterMaximize();
          return;
        }
        request.catch(function () {
          enterMaximize();
        });
      });
    }

    // The WebGL canvas is transparent wherever the model doesn't cover it —
    // the visible background color behind it is just the wrapper element's
    // own CSS background painted underneath. canvas.toDataURL() alone would
    // therefore export a see-through PNG, so the current background color
    // is painted onto an offscreen canvas first and the WebGL frame is
    // drawn on top of that before exporting.
    if (showScreenshot) {
    addButton('screenshot', 'Capture and download image', CAMERA_ICON, function () {
      try {
        var canvas = el.querySelector('canvas');
        if (!canvas) return;
        if (view3d.renderer && view3d.renderer.renderSingleFrame) {
          view3d.renderer.renderSingleFrame(true);
        }
        var composite = document.createElement('canvas');
        composite.width = canvas.width;
        composite.height = canvas.height;
        var ctx = composite.getContext('2d');
        if (!ctx) return;
        var bg = cfg.background;
        ctx.fillStyle = (typeof bg === 'string' && bg.charAt(0) === '#') ? bg : '#ffffff';
        ctx.fillRect(0, 0, composite.width, composite.height);
        ctx.drawImage(canvas, 0, 0);
        var link = document.createElement('a');
        link.href = composite.toDataURL('image/png');
        link.download = 'model-view-' + Date.now() + '.png';
        document.body.appendChild(link);
        link.click();
        link.remove();
      } catch (err) {
        console.warn('[viewer-3d] capture failed:', err);
      }
    });
    }

    // buildAnimationList slots the switcher in once the model has loaded.
    return place;
  }

  // Mirrors view3d's built-in AnimationSelector interaction (a "current clip
  // name" button that opens a list on click) but the list is a popup instead of
  // the vendor's fixed dropdown — this is what makes it independently
  // positionable and adds a "None" option to fully stop the animation.
  //
  // It gets its own bar in the top-left corner rather than sharing one of the
  // bottom bars, so the popup — which opens downward from there — has the whole
  // height of the viewer to expand into and never covers the zoom/reset/
  // fullscreen buttons. The popup is nested inside a small wrapper around the
  // name button (position: relative) so it stays anchored to that button rather
  // than appearing somewhere unrelated on the card. Clips only exist once the
  // model has loaded, so this is deferred to the 'ready' event.
  // Turns the merchant-facing "Default animation index" into the clip index this
  // viewer uses internally. The setting counts the way the switcher lists clips —
  // 1, 2, 3… — with 0 for "none", since it is typed in by hand next to that list;
  // internally the index is view3d's 0-based one, with -1 for "None" (selectClip).
  //
  // A position the model doesn't have resolves to "None" rather than to the first
  // clip: the clip count isn't knowable when the setting is saved (it's validated
  // against 0..99 and nothing more), and playing some *other* clip than the one
  // asked for is what makes the setting look broken.
  //
  // MUST match resolveDefaultClipIndex in app/lib/viewer-config.ts, which this
  // file can't import.
  function resolveDefaultClipIndex(setting, clipCount) {
    if (typeof setting !== 'number' || !isFinite(setting) || setting < 1) return -1;
    var idx = Math.floor(setting) - 1;
    return idx < clipCount ? idx : -1;
  }

  function buildAnimationList(el, view3d, cfg, place) {
    if (!cfg.showAnimationSelector) {
      // Hiding the switcher means "no animation", not "an animation you can't
      // control". view3d autoplays defaultAnimationIndex once the model is
      // ready, so returning here without stopping it left the model looping
      // forever with nothing on screen to pause or change it — and since the
      // switcher is hidden by default now, that would be most models.
      view3d.once('ready', function () {
        try {
          if (view3d.animator) view3d.animator.stop();
        } catch (e) {}
      });
      return;
    }

    view3d.once('ready', function () {
      var clips = (view3d.animator && view3d.animator.clips) || [];
      if (!clips.length) return;

      // Wherever the merchant put it, sharing a bar with any controls placed
      // in the same spot.
      var position = place.slotOf('animation');

      var wrap = document.createElement('div');
      wrap.className = 'viewer-3d-animation-name-wrap';
      place('animation', wrap);

      var panel = document.createElement('div');
      panel.className = 'viewer-3d-animation-list anchor-' + position;
      panel.setAttribute('role', 'listbox');

      var itemsWrap = document.createElement('div');
      itemsWrap.className = 'viewer-3d-animation-list-items';
      panel.appendChild(itemsWrap);

      var nameBtn = document.createElement('button');
      nameBtn.type = 'button';
      nameBtn.className = 'viewer-3d-animation-name-btn';
      nameBtn.setAttribute('aria-label', 'Choose animation');
      nameBtn.setAttribute('aria-haspopup', 'listbox');
      // The pulsing dot the admin preview shows whenever a clip is playing
      // (hidden while the selection is "None"), reproduced so the storefront
      // button isn't just a bare clip name next to the same chevron.
      var nameDot = document.createElement('span');
      nameDot.className = 'viewer-3d-animation-name-dot';
      nameDot.innerHTML = '<span></span><span></span>';
      var nameLabel = document.createElement('span');
      nameLabel.className = 'viewer-3d-animation-name-label';
      var nameChevron = document.createElement('span');
      nameChevron.innerHTML = CHEVRON_DOWN_ICON;
      nameBtn.appendChild(nameDot);
      nameBtn.appendChild(nameLabel);
      nameBtn.appendChild(nameChevron);

      var open = false;
      function setOpen(next) {
        open = next;
        // A class, not an inline `display`, so the panel can transition in and
        // out (it's hidden with visibility + opacity instead — `display` can't
        // be transitioned, which is why opening used to just snap into place).
        panel.classList.toggle('is-open', open);
        nameChevron.innerHTML = open ? CHEVRON_UP_ICON : CHEVRON_DOWN_ICON;
        nameBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        nameBtn.classList.toggle('is-open', open);
        if (open) hideTooltip();
      }
      setOpen(false);
      // Returning null while the list is open suppresses the tooltip — it would
      // otherwise sit on top of the very list the click just opened, which is
      // why the admin drops its own tooltip in that state too.
      // Below when the switcher sits against the top edge, where there's no
      // room above it for a tooltip.
      attachTooltip(nameBtn, function () {
        return open ? null : 'Choose animation';
      }, position.indexOf('top') === 0);
      nameBtn.addEventListener('mousedown', function (e) {
        e.stopPropagation();
      });
      nameBtn.addEventListener('click', function () {
        setOpen(!open);
      });
      document.addEventListener('mousedown', function (e) {
        if (open && !panel.contains(e.target)) setOpen(false);
      });
      // Escape closes the list and returns focus to the button that opened it —
      // the admin preview has had this and the storefront hadn't, so a keyboard
      // user could open the list here with no way to dismiss it.
      document.addEventListener('keydown', function (e) {
        if (open && e.key === 'Escape') {
          setOpen(false);
          nameBtn.focus();
        }
      });

      // idx -1 means "None" — kept separate from clipButtons (indexed 0..N-1
      // to match the clips array) rather than sharing one array, so a plain
      // index lookup can't misalign the two.
      var clipButtons = [];
      var uiIndex = null;
      function setActive(idx) {
        uiIndex = idx;
        nameLabel.textContent = idx === -1 ? 'None' : clips[idx].name;
        // Restart the label's wipe-in. Removing the class isn't enough on its
        // own — without reading a layout property in between, the browser
        // coalesces the remove and the add into no change at all and the
        // animation doesn't replay. Runs on the first call too, matching the
        // admin, where the equivalent span is keyed on the active index so React
        // remounts it (and so animates it on mount as well).
        nameLabel.classList.remove('is-changing');
        void nameLabel.offsetWidth;
        nameLabel.classList.add('is-changing');
        // A class rather than an inline `display`, which the stylesheet's
        // `display: flex !important` (needed to survive theme CSS) would outrank.
        nameDot.classList.toggle('is-hidden', idx === -1);
        noneBtn.classList.toggle('active', idx === -1);
        noneBtn.setAttribute('aria-selected', idx === -1 ? 'true' : 'false');
        clipButtons.forEach(function (btn, i) {
          btn.classList.toggle('active', i === idx);
          btn.setAttribute('aria-selected', i === idx ? 'true' : 'false');
        });
      }

      // Switching clips used to be a hard cut — animator.play() stops the
      // outgoing clip on the same frame the incoming one starts, so the model
      // visibly snaps between poses. crossFade/fadeOut blend the two instead,
      // which is the whole point of this function existing rather than the two
      // call sites poking the animator directly.
      //
      // The fades are driven by the mixer's clock, and the mixer's clock is
      // exactly what pause() freezes (it sets timeScale to 0) — so a fade
      // started while paused would hang forever, stuck at partial weights with
      // two clips half-blended on screen. Paused viewers therefore keep the
      // old instant switch, which is all a paused viewer can meaningfully do.
      var FADE_MS = 320;
      var selectionSeq = 0;

      function selectClip(idx) {
        var animator = view3d.animator;
        if (!animator) return;
        if (idx !== -1 && !(idx >= 0 && idx < clips.length)) return;

        // Re-picking the clip that's already playing would otherwise restart it
        // from frame 0 and crossfade it against itself — three's crossFadeTo
        // schedules a fade-out and a fade-in on the same action, the second
        // overwriting the first, so the model drops to its bind pose and fades
        // back in. Nothing to do instead. A clip that has *finished*
        // (repeat mode "none") isn't animating, so it still restarts.
        if (idx !== -1 && idx === animator.activeAnimationIndex && !!animator.animating) {
          setOpen(false);
          return;
        }

        var seq = ++selectionSeq;
        if (idx !== -1) track(el, 'f_animation');
        // UI first: the toolbar responds on the click, not when the blend ends.
        setActive(idx);
        setOpen(false);

        if (animator.paused) {
          if (idx === -1) {
            animator.stop();
          } else {
            animator.play(idx);
            animator.pause();
          }
          normalizeTimeScales(animator);
          return;
        }

        // Re-picking the clip that is already selected but has finished —
        // repeat mode "none" leaves it clamped and paused on its last frame —
        // is a restart, not a blend, and crossFade cannot do it: it rewinds the
        // action without clearing three's `paused` flag, and with start and end
        // being the same action it would fade the clip against itself. play()
        // stops every action first, and stop() resets them, which unpauses.
        if (idx !== -1 && idx === animator.activeAnimationIndex) {
          animator.play(idx);
          normalizeTimeScales(animator);
          if (view3d.renderer && view3d.renderer.renderSingleFrame) {
            view3d.renderer.renderSingleFrame(true);
          }
          return;
        }

        if (idx === -1) {
          animator.fadeOut(FADE_MS).catch(function () {});
        } else {
          animator.crossFade(idx, FADE_MS).catch(function () {});
        }

        // Runs once the blend has finished, and only for the most recent
        // selection — a stale timer from a superseded transition must not touch
        // the new one, hence the seq check.
        //
        // Two jobs. First, strip the warp residue crossFade leaves on the
        // outgoing action (see normalizeTimeScales) — safe to do here because by
        // now that action is at weight 0, so changing its speed is invisible.
        // Second, for None, actually halt the actions: fadeOut only lowers their
        // weight to zero and leaves them running. A timer rather than fadeOut's
        // promise because that promise resolves from a BEFORE_RENDER callback, so
        // an idle render loop leaves it pending forever and None never stops.
        setTimeout(function () {
          if (seq !== selectionSeq) return;
          if (idx === -1) animator.stop();
          normalizeTimeScales(animator);
        }, FADE_MS + 80);
      }

      var noneBtn = document.createElement('button');
      noneBtn.type = 'button';
      noneBtn.setAttribute('role', 'option');
      noneBtn.textContent = 'None';
      noneBtn.addEventListener('click', function () {
        selectClip(-1);
      });
      itemsWrap.appendChild(noneBtn);

      clips.forEach(function (clip, idx) {
        var btn = document.createElement('button');
        btn.type = 'button';
        var num = document.createElement('span');
        num.className = 'viewer-3d-animation-list-index';
        num.textContent = idx + 1 < 10 ? '0' + (idx + 1) : String(idx + 1);
        btn.appendChild(num);
        var label = document.createElement('span');
        label.className = 'viewer-3d-animation-list-label';
        label.textContent = clip.name;
        btn.appendChild(label);
        btn.setAttribute('role', 'option');
        btn.addEventListener('click', function () {
          selectClip(idx);
        });
        itemsWrap.appendChild(btn);
        clipButtons.push(btn);
      });

      // Resolved against the clips this model actually has: the setting is
      // validated against 0..99 when saved, with no way to know the clip count
      // at that point, so a position the model doesn't have would otherwise
      // index past the end of `clips` and throw out of setActive — taking the
      // whole selector down with it.
      var activeIndex = resolveDefaultClipIndex(
        cfg.defaultAnimationIndex,
        clips.length
      );
      setActive(activeIndex);

      // In repeat mode "all" the animator advances to the next clip by itself
      // whenever one loops (ModelAnimator._onAnimationLoop calls play(nextIndex)),
      // so the toolbar has to follow the animator rather than only our own
      // clicks — otherwise it sits there showing whatever was last picked while a
      // completely different clip plays. Guarded on a real change so the label's
      // wipe animation doesn't re-run for a play() we issued ourselves.
      view3d.on('animationStart', function (evt) {
        var idx = evt && evt.index;
        if (typeof idx === 'number' && idx >= 0 && idx < clips.length && idx !== uiIndex) {
          setActive(idx);
        }
      });

      // view3d plays defaultAnimationIndex itself on load, but its
      // ModelAnimator.play() silently returns when the index has no action —
      // so an out-of-range saved index left *nothing* playing while the toolbar
      // above happily showed a clip name and a pulsing "playing" dot. Re-issue
      // the play for the resolved index so what's on screen is what's running.
      if (activeIndex === -1) {
        view3d.animator.stop();
      } else if (view3d.animator.activeAnimationIndex !== activeIndex) {
        view3d.animator.play(activeIndex);
      }

      wrap.appendChild(nameBtn);
      wrap.appendChild(panel);
    });
  }

  // Styled to match the admin preview's loading and error states rather than
  // being ad-hoc inline CSS, since these are the first thing anyone sees of the
  // viewer. The toolbar stays hidden until 'ready' fires (see initOne) exactly
  // as it does in the admin, so this overlay is what fills the gap.
  function buildLoadingOverlay(el) {
    var overlay = document.createElement('div');
    overlay.className = 'viewer-3d-loading';
    overlay.innerHTML =
      '<div class="viewer-3d-loading-pill">' +
      '<span class="viewer-3d-loading-spinner">' + SPINNER_ICON + '</span>' +
      '<span class="viewer-3d-loading-text">Loading model…</span>' +
      '</div>';
    el.appendChild(overlay);
    return overlay;
  }

  function showError(el, message) {
    var note = document.createElement('div');
    note.className = 'viewer-3d-error';
    note.innerHTML =
      '<span class="viewer-3d-error-icon">' + ALERT_ICON + '</span>' +
      '<p class="viewer-3d-error-text"></p>';
    note.querySelector('.viewer-3d-error-text').textContent = message;
    el.appendChild(note);
    console.error('[viewer-3d] ' + message);
  }

  function parseConfig(raw) {
    if (!raw) return {};
    try {
      var c = JSON.parse(raw);
      return c && typeof c === 'object' ? compact(c) : {};
    } catch (err) {
      console.warn('[viewer-3d] invalid config JSON:', err);
      return {};
    }
  }

  // Strips null/undefined values before the config is merged onto DEFAULTS.
  // Object.assign copies a key whose value is null, so without this a config
  // carrying `"showAnimationSelector": null` would *overwrite* the app default
  // with null — and since these flags are now read as plain booleans rather than
  // `!== false`, null reads as "off" and the control silently disappears. A
  // Liquid `nil` serialises to exactly that null (a theme block setting the
  // merchant has never touched), which is how it bites in practice. "Absent"
  // and "explicitly null" must both mean "use the default".
  function compact(obj) {
    var out = {};
    Object.keys(obj).forEach(function (key) {
      if (obj[key] !== null && obj[key] !== undefined) out[key] = obj[key];
    });
    return out;
  }

  // Deliberately a line-for-line mirror of buildOptions() in
  // app/components/ViewerPreview.tsx — `cfg` has already been merged onto
  // DEFAULTS by the caller, so every option is assigned unconditionally there
  // and here. Keep the two in step: any option one side passes and the other
  // omits is a way for the storefront and the admin preview to render the same
  // model differently.
  function buildOptions(modelUrl, posterUrl, cfg) {
    var options = {
      src: modelUrl,
      autoInit: true,
      exposure: cfg.exposure,
      useDefaultEnv: cfg.useDefaultEnv,
      skyboxBlur: cfg.skyboxBlur,
      yaw: cfg.yaw,
      pitch: cfg.pitch,
      initialZoom: cfg.initialZoom,
      rotate: cfg.rotate,
      translate: cfg.translate,
      zoom: cfg.zoom,
      scrollable: cfg.scrollable,
      wheelScrollable: cfg.wheelScrollable,
      useGrabCursor: cfg.useGrabCursor,
      // view3d's option is the 0-based clip index; ours is 1-based with 0 for
      // "none" (resolveDefaultClipIndex). The clip count isn't known yet here, so
      // this is the plain shift — buildAnimationList re-resolves it on 'ready'
      // against the clips the model actually turned out to have. A -1 (our
      // "none") is deliberate rather than clamped away: ModelAnimator.play(-1)
      // finds no action and returns, so nothing autoplays and there is no frame
      // of unwanted animation to stop afterwards.
      defaultAnimationIndex: cfg.defaultAnimationIndex - 1,
      animationRepeatMode: cfg.animationRepeatMode,
      webAR: webArOption(cfg.webAR, cfg.arPlacement),
      sceneViewer: arSessionOption(cfg.sceneViewer, cfg.arPlacement),
      quickLook: cfg.quickLook,
      fixSkinnedBbox: cfg.fixSkinnedBbox,
      shadow: cfg.shadow,
      maintainSize: cfg.maintainSize,
      autoplay: cfg.autoRotate ? { delay: 0, speed: 0.5 } : false
    };

    if (posterUrl) options.poster = posterUrl;

    if (TONE_MAPPINGS[cfg.toneMapping] != null) {
      options.toneMapping = TONE_MAPPINGS[cfg.toneMapping];
    }
    if (cfg.skybox) options.skybox = cfg.skybox;
    if (cfg.envmap) options.envmap = cfg.envmap;

    // A plain color is *only* ever painted as the wrapper element's CSS
    // background, with the WebGL canvas left transparent on top — never handed
    // to view3d as options.background. Passing it through would make three.js
    // set scene.background instead, and once scene.background is non-null
    // view3d's skyboxBlur path swaps it out for the environment map texture
    // (View3D.ts), so the configured flat color could end up replaced by the
    // default studio envmap. The admin preview has always taken the CSS route;
    // this is the storefront matching it. Image URLs still go to view3d, since
    // CSS can't reproduce how it maps one onto the scene.
    if (typeof cfg.background === 'string' && cfg.background.indexOf('://') > -1) {
      options.background = cfg.background;
    }

    if (cfg.fovMode === 'auto') options.fov = 'auto';
    else options.fov = cfg.fov;

    if (cfg.iosSrc) options.iosSrc = cfg.iosSrc;
    if (cfg.variant) options.variant = cfg.variant;

    return options;
  }

  // Height and background are the two settings a theme block can also supply
  // (they're the only appearance settings in the block schema, for merchants
  // who never opened the app), so for those two the block's resolved value —
  // handed over in data-viewer-height / data-viewer-bg — stands in for the
  // app default. Everything layered on top of this still wins: the saved
  // metafield config first, then a hash preview.
  function baseConfig(el) {
    var base = Object.assign({}, DEFAULTS);
    var height = parseInt(el.dataset.viewerHeight, 10);
    if (!isNaN(height)) base.height = height;
    if (el.dataset.viewerBg) base.background = el.dataset.viewerBg;
    return base;
  }

  function parseHashPreview() {
    if (!window.location.hash) return null;
    var m = window.location.hash.match(/preview_config=([^&]+)/);
    if (!m) return null;
    try {
      var parsed = JSON.parse(decodeURIComponent(m[1]));
      // compact() for the same reason as in parseConfig — this object is merged
      // last, so a null here would clobber both the default and the saved value.
      return parsed && typeof parsed === 'object' ? compact(parsed) : null;
    } catch (err) {
      console.warn('[viewer-3d] invalid preview_config hash:', err);
      return null;
    }
  }

  // Mirrors the inline `style` the admin preview's root <div> gets: the
  // configured height, and the background color painted *behind* the
  // transparent WebGL canvas — falling back to white for a non-color
  // background (an image URL, which view3d itself renders into the scene)
  // exactly as ViewerPreview.tsx's `bgIsColor ? background : "#ffffff"` does.
  // Runs for every viewer, not just hash-preview ones, so the page block —
  // which has no per-product metafield to template these into its markup —
  // still lands on the same values.
  function applyWrapperStyles(el, cfg) {
    if (typeof cfg.height === 'number') {
      el.style.setProperty('--viewer-height', cfg.height + 'px');
    }
    var bg =
      typeof cfg.background === 'string' && cfg.background.charAt(0) === '#'
        ? cfg.background
        : '#ffffff';
    el.style.setProperty('--viewer-bg', bg);
    el.style.background = bg;
  }

  /*
   * Registration only — cheap, and safe to run for every block on the page. The
   * expensive half (WebGL context, model download, GLB parse) is mountOne, which
   * the observer calls when this element comes near the viewport.
   */
  function initOne(el) {
    if (el.hasAttribute(INIT_ATTR)) return;
    el.setAttribute(INIT_ATTR, '');

    var io = getLazyObserver();
    if (!io) {
      // No IntersectionObserver: mount straight away, i.e. the old eager
      // behaviour. Still goes through the queue, so a page of viewers on such a
      // browser at least loads them one at a time instead of all together.
      enqueueMount(el);
      return;
    }
    showPlaceholder(el);
    observedEls.push(el);
    io.observe(el);
  }

  /*
   * Engagement counts for the merchant's Analytics page: how often each viewer
   * is seen, used and opened in AR. Counts only — nothing identifies the
   * shopper. The block sets data-track-url only on the live storefront (never
   * in the theme editor), so without it this does nothing.
   *
   * Events are batched and sent with sendBeacon to the app proxy
   * (/apps/viewer-3d/track), which signs them for the app. sendBeacon never
   * blocks the page and survives navigation; anything still queued is sent
   * when the page is hidden. Each event is sent at most once per viewer per
   * page load, so reloads are the only way to count again.
   */
  var trackQueue = [];
  var trackUrl = null;
  var trackTimer = 0;

  /*
   * Device class, from the input and screen rather than the user agent: a
   * coarse pointer means touch, and the shorter screen side separates phones
   * from tablets. Only this word is sent — nothing that identifies a device.
   */
  var DEVICE = (function () {
    try {
      var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      if (!coarse) return 'desktop';
      return Math.min(screen.width, screen.height) >= 768 ? 'tablet' : 'mobile';
    } catch (e) {
      return 'unknown';
    }
  })();

  function flushTrack() {
    clearTimeout(trackTimer);
    trackTimer = 0;
    if (!trackQueue.length || !trackUrl) return;
    var events = trackQueue.splice(0, 20);
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(trackUrl, JSON.stringify({ events: events }));
      }
    } catch (e) {}
    if (trackQueue.length) flushTrack();
  }

  function queueTrack(el, item) {
    var url = el.dataset.trackUrl;
    if (!url || navigator.webdriver) return;
    trackUrl = url;
    item.p = el.dataset.placement || 'product';
    item.t = el.dataset.trackTarget || '';
    item.d = DEVICE;
    trackQueue.push(item);
    if (!trackTimer) trackTimer = setTimeout(flushTrack, 1500);
  }

  /** Counts `event` for this viewer, at most once per page load. */
  function track(el, event) {
    var sent = el.__viewer3dTracked || (el.__viewer3dTracked = {});
    if (sent[event]) return;
    sent[event] = true;
    queueTrack(el, { e: event });
  }

  /*
   * Time with the 3D model: counted only while at least half the viewer is on
   * screen and the tab is visible. Reported each time the page is hidden, as
   * the seconds gained since the last report — `n` marks the first report, so
   * the server counts each viewer once when averaging.
   */
  var dwellers = [];

  function trackDwell(el) {
    if (!el.dataset.trackUrl || !window.IntersectionObserver) return;
    var d = { el: el, ms: 0, since: 0, onScreen: false, reported: false };
    function start() {
      if (!d.since && d.onScreen && document.visibilityState === 'visible') {
        d.since = Date.now();
      }
    }
    d.stop = function () {
      if (d.since) {
        d.ms += Date.now() - d.since;
        d.since = 0;
      }
    };
    d.start = start;
    new window.IntersectionObserver(function (entries) {
      d.onScreen = entries[entries.length - 1].intersectionRatio >= 0.5;
      if (d.onScreen) start();
      else d.stop();
    }, { threshold: [0, 0.5] }).observe(el);
    dwellers.push(d);
  }

  function reportDwell() {
    dwellers.forEach(function (d) {
      d.stop();
      // Capped per report: a tab left open overnight is not ten hours of
      // looking at a chair.
      var secs = Math.min(600, Math.round(d.ms / 1000));
      d.ms = 0;
      if (secs < 1) return;
      queueTrack(d.el, { e: 'dwell', v: secs, n: d.reported ? 0 : 1 });
      d.reported = true;
    });
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      reportDwell();
      flushTrack();
    } else {
      dwellers.forEach(function (d) {
        d.start();
      });
    }
  });
  window.addEventListener('pagehide', function () {
    reportDwell();
    flushTrack();
  });

  /*
   * Add to cart, attributed to the 3D viewer on the same product page: once
   * per page load, as `cart_3d` when the shopper interacted with a model
   * first, or `cart_no3d` when they saw it but did not. Comparing the two is
   * the "does 3D sell" number on the Analytics page.
   *
   * Caught at the form submit (Dawn and most themes submit the product form,
   * even when they then add over AJAX) and, for themes that do not, on the
   * click of the form's submit button. Capture phase, so a theme that stops
   * the event cannot hide it.
   */
  var cartCounted = false;

  function onAddToCart() {
    if (cartCounted) return;
    var viewers = Array.prototype.slice.call(
      document.querySelectorAll('[data-view3d][data-placement="product"][data-track-url]')
    );
    var interacted = viewers.filter(function (v) {
      return v.__viewer3dTracked && v.__viewer3dTracked.interact;
    });
    var viewed = viewers.filter(function (v) {
      return v.__viewer3dTracked && v.__viewer3dTracked.view;
    });
    if (interacted.length) track(interacted[0], 'cart_3d');
    else if (viewed.length) track(viewed[0], 'cart_no3d');
    else return;
    cartCounted = true;
  }

  function isCartForm(form) {
    return !!(form && form.getAttribute && /\/cart\/add/.test(form.getAttribute('action') || ''));
  }

  document.addEventListener('submit', function (e) {
    if (isCartForm(e.target)) onAddToCart();
  }, true);
  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest && e.target.closest('button, input[type="submit"]');
    if (!btn) return;
    if (btn.name === 'add' || (isCartForm(btn.form) && (btn.type === 'submit'))) onAddToCart();
  }, true);

  /** The first press, drag or scroll on a viewer counts as an interaction. */
  function trackFirstInteraction(el) {
    var types = ['pointerdown', 'wheel', 'touchstart'];
    function onFirst(e) {
      // Presses on our own overlays (toolbar, AR QR) are not the model.
      if (e.target && e.target.closest && e.target.closest('button')) return;
      types.forEach(function (t) {
        el.removeEventListener(t, onFirst, true);
      });
      track(el, 'interact');
    }
    types.forEach(function (t) {
      el.addEventListener(t, onFirst, { passive: true, capture: true });
    });
  }

  /** Toolbar controls whose use the Analytics page reports. */
  var FEATURE_EVENTS = {
    zoomIn: 'f_zoom',
    zoomOut: 'f_zoom',
    fullscreen: 'f_fullscreen',
    screenshot: 'f_screenshot'
  };

  /*
   * Hotspots: numbered pins on the model that open a card and turn the camera
   * to face the spot. Mirrors app/lib/hotspots.ts (sanitizeHotspots,
   * buildHotspotElement), which this file cannot import — keep them in step.
   *
   * Rendered with view3d's own FaceAnnotation / PointAnnotation (in the bundled
   * view3d.pkgd.min.js), which follow the model every frame and run the camera
   * focus on open. The markup is built here with textContent only: view3d's
   * default annotation element sets its label with innerHTML.
   */
  var MAX_HOTSPOTS = 20;

  function hsString(v, max) {
    return typeof v === 'string' ? v.trim().slice(0, max) : '';
  }

  function hsTriple(v, fallback) {
    return Array.isArray(v) && v.length === 3 && v.every(isFinite) ? v : fallback;
  }

  function safeHotspotUrl(raw) {
    var url = hsString(raw, 500);
    if (!url) return '';
    if (url.charAt(0) === '/' && url.charAt(1) !== '/') return url;
    try {
      return new URL(url).protocol === 'https:' ? url : '';
    } catch (e) {
      return '';
    }
  }

  function hsHttps(raw) {
    var url = hsString(raw, 500);
    try {
      return url && new URL(url).protocol === 'https:' ? url : '';
    } catch (e) {
      return '';
    }
  }

  function hsImage(raw) {
    var url = raw && hsHttps(raw.url);
    return url ? { url: url, alt: hsString(raw.alt, 200) } : null;
  }

  function hsVideo(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.kind === 'youtube' && /^[\w-]{11}$/.test(String(raw.id))) {
      return { kind: 'youtube', id: String(raw.id) };
    }
    if (raw.kind === 'vimeo' && /^\d{6,12}$/.test(String(raw.id))) {
      return { kind: 'vimeo', id: String(raw.id) };
    }
    if (raw.kind === 'file') {
      var url = hsHttps(raw.url);
      return url ? { kind: 'file', url: url, poster: hsHttps(raw.poster) } : null;
    }
    return null;
  }

  function hsProduct(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var id = String(raw.id || '').match(/(\d{1,20})$/);
    var variantId = String(raw.variantId || '').match(/(\d{1,20})$/);
    var handle = hsString(raw.handle, 255);
    if (!id || !variantId || !/^[a-z0-9][a-z0-9-]*$/i.test(handle)) return null;
    return {
      id: id[1],
      variantId: variantId[1],
      handle: handle,
      title: hsString(raw.title, 120) || handle,
      imageUrl: hsHttps(raw.imageUrl),
      price: hsString(raw.price, 20).replace(/[^\d.,]/g, ''),
      addToCart: raw.addToCart !== false,
      buyNow: raw.buyNow === true
    };
  }

  // The card's reorderable blocks. Mirrors HOTSPOT_BLOCKS in app/lib/hotspots.ts.
  var HS_BLOCKS = ['image', 'video', 'text', 'product'];

  function hsOrder(raw) {
    if (!Array.isArray(raw)) return null;
    var out = raw.filter(function (b, i) {
      return HS_BLOCKS.indexOf(b) !== -1 && raw.indexOf(b) === i;
    });
    return out.length ? out : null;
  }

  /*
   * The card's blocks in the order to show them; without a saved order, the
   * layout cards always had. Mirrors hotspotBlockOrder in app/lib/hotspots.ts.
   */
  function hsBlockOrder(h) {
    var base = h.video && h.image
      ? ['video', 'text', 'image', 'product']
      : ['image', 'video', 'text', 'product'];
    if (!h.order) return base;
    return h.order.concat(base.filter(function (b) {
      return h.order.indexOf(b) === -1;
    }));
  }

  function sanitizeHotspots(raw) {
    if (!Array.isArray(raw)) return [];
    var out = [];
    raw.slice(0, MAX_HOTSPOTS).forEach(function (h) {
      if (!h || typeof h !== 'object') return;
      var meshIndex = typeof h.meshIndex === 'number' ? Math.floor(h.meshIndex) : -1;
      var faceIndex = typeof h.faceIndex === 'number' ? Math.floor(h.faceIndex) : -1;
      var position = Array.isArray(h.position) && h.position.length === 3 &&
        h.position.every(isFinite) ? h.position : null;
      var onFace = meshIndex >= 0 && faceIndex >= 0;
      if (!onFace && !position) return;
      out.push({
        id: hsString(h.id, 40).replace(/[^\w-]/g, ''),
        title: hsString(h.title, 60) || 'Hotspot ' + (out.length + 1),
        description: hsString(h.description, 280),
        linkLabel: hsString(h.linkLabel, 40),
        linkUrl: safeHotspotUrl(h.linkUrl),
        meshIndex: onFace ? meshIndex : -1,
        faceIndex: onFace ? faceIndex : -1,
        weights: hsTriple(h.weights, [1 / 3, 1 / 3, 1 / 3]),
        position: position,
        focus: hsTriple(h.focus, [0, 0, 0]),
        image: hsImage(h.image),
        video: hsVideo(h.video),
        product: hsProduct(h.product),
        order: hsOrder(h.order)
      });
    });
    return out;
  }

  function buildHotspotEl(h, index, color, label) {
    var el = document.createElement('div');
    el.className = 'view3d-annotation e3d-hotspot';
    if (label === 'title') el.className += ' e3d-hotspot--title';
    el.style.setProperty('--e3d-hotspot', color);
    el.setAttribute('data-hotspot-id', h.id);

    var pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'e3d-hotspot-pin';
    pin.textContent = label === 'title' ? h.title : String(index + 1);
    pin.setAttribute('aria-label', 'Hotspot ' + (index + 1) + ': ' + h.title);
    el.appendChild(pin);

    var card = document.createElement('div');
    card.className = 'view3d-annotation-tooltip e3d-hotspot-card';
    if (h.image || h.video || h.product) card.className += ' e3d-hotspot-card--rich';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', h.title);

    // The blocks in the merchant's order (hsBlockOrder); the CSS spaces them
    // whatever the order.
    hsBlockOrder(h).forEach(function (block) {
      if (block === 'image' && h.image) card.appendChild(buildHsImage(h.image));
      else if (block === 'video' && h.video) card.appendChild(buildHsVideo(h.video));
      else if (block === 'text') card.appendChild(buildHsText(h));
      else if (block === 'product' && h.product) card.appendChild(buildHsProduct(h.product));
    });
    // view3d cancels wheel events on the whole annotation (so scrolling over
    // a pin never zooms the model), which also stops a tall card scrolling.
    card.addEventListener('wheel', function (e) {
      card.scrollTop += e.deltaY;
    }, { passive: true });
    el.appendChild(card);
    return el;
  }

  // Title, description and link: the card's text, kept together.
  function buildHsText(h) {
    var box = document.createElement('div');
    box.className = 'e3d-hotspot-body';
    var title = document.createElement('div');
    title.className = 'e3d-hotspot-title';
    title.textContent = h.title;
    box.appendChild(title);
    if (h.description) {
      var body = document.createElement('div');
      body.className = 'e3d-hotspot-text';
      body.textContent = h.description;
      box.appendChild(body);
    }
    if (h.linkUrl) {
      var a = document.createElement('a');
      a.className = 'e3d-hotspot-link';
      a.href = h.linkUrl;
      a.textContent = h.linkLabel || 'Learn more';
      if (h.linkUrl.charAt(0) !== '/') {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      }
      box.appendChild(a);
    }
    return box;
  }

  function buildHsImage(image) {
    var img = document.createElement('img');
    img.className = 'e3d-hotspot-media';
    img.src = image.url;
    img.alt = image.alt || '';
    img.loading = 'lazy';
    img.decoding = 'async';
    return img;
  }

  var PLAY_ICON =
    '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';

  // A thumbnail with a play button; the player itself loads only when pressed,
  // so twenty hotspots never mean twenty embedded players.
  function buildHsVideo(video) {
    var box = document.createElement('div');
    box.className = 'e3d-hotspot-video';
    box.setAttribute('data-kind', video.kind);
    box.setAttribute('data-src', video.kind === 'file' ? video.url : video.id);
    var poster = video.kind === 'youtube'
      ? 'https://i.ytimg.com/vi/' + video.id + '/hqdefault.jpg'
      : video.kind === 'file' ? hsHttps(video.poster) : '';
    if (poster) {
      box.setAttribute('data-poster', poster);
      box.style.backgroundImage = 'url("' + poster + '")';
    }
    var play = document.createElement('button');
    play.type = 'button';
    play.className = 'e3d-hotspot-play';
    play.setAttribute('aria-label', 'Play video');
    play.innerHTML = PLAY_ICON;
    play.addEventListener('click', function (e) {
      e.stopPropagation();
      var kind = box.getAttribute('data-kind');
      var src = box.getAttribute('data-src');
      box.textContent = '';
      box.style.backgroundImage = '';
      if (kind === 'file') {
        var v = document.createElement('video');
        var posterUrl = box.getAttribute('data-poster');
        if (posterUrl) v.poster = posterUrl;
        v.src = src;
        v.controls = true;
        v.autoplay = true;
        v.playsInline = true;
        box.appendChild(v);
        return;
      }
      var iframe = document.createElement('iframe');
      iframe.src = kind === 'youtube'
        ? 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(src) + '?autoplay=1&rel=0&playsinline=1'
        : 'https://player.vimeo.com/video/' + encodeURIComponent(src) + '?autoplay=1';
      iframe.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
      // YouTube won't play without a Referer (Error 153), and a theme or app
      // may set a policy that withholds it. Mirrors activateHotspotVideo in
      // app/lib/hotspots.ts.
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      iframe.allowFullscreen = true;
      iframe.title = 'Video';
      box.appendChild(iframe);
    });
    box.appendChild(play);
    return box;
  }

  // Closing a card stops its video: the player goes back to its thumbnail.
  function resetHsVideos(root) {
    var boxes = root.querySelectorAll('.e3d-hotspot-video');
    Array.prototype.forEach.call(boxes, function (box) {
      if (!box.querySelector('iframe, video:not(.e3d-hotspot-frame)')) return;
      var kind = box.getAttribute('data-kind');
      var src = box.getAttribute('data-src');
      box.replaceWith(buildHsVideo(kind === 'file'
        ? { kind: 'file', url: src, poster: box.getAttribute('data-poster') || '' }
        : { kind: kind, id: src }));
    });
  }

  /*
   * A file video with no poster shows its own first frame rather than a blank
   * box: a muted, metadata-only <video> behind the play button, added when the
   * card opens so a page of hotspots does not fetch every video at load.
   * `#t=0.1` makes iOS Safari paint a frame. Mirrors primeHotspotVideoFrames
   * in app/lib/hotspots.ts.
   */
  function primeHsVideoFrames(root) {
    var boxes = root.querySelectorAll('.e3d-hotspot-video[data-kind="file"]:not([data-poster])');
    Array.prototype.forEach.call(boxes, function (box) {
      if (box.querySelector('video, iframe')) return;
      var frame = document.createElement('video');
      frame.className = 'e3d-hotspot-frame';
      frame.muted = true;
      frame.playsInline = true;
      frame.preload = 'metadata';
      frame.setAttribute('aria-hidden', 'true');
      frame.src = (box.getAttribute('data-src') || '').split('#')[0] + '#t=0.1';
      box.insertBefore(frame, box.firstChild);
    });
  }

  // The storefront's own root, so a market's /fr/ prefix is kept.
  function shopRoot() {
    var root = window.Shopify && window.Shopify.routes && window.Shopify.routes.root;
    return typeof root === 'string' && root.charAt(0) === '/' ? root : '/';
  }

  function formatMoney(cents) {
    var currency = (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || '';
    var amount = Number(cents) / 100;
    try {
      if (currency) {
        return new Intl.NumberFormat(document.documentElement.lang || undefined, {
          style: 'currency',
          currency: currency
        }).format(amount);
      }
    } catch (e) {}
    return amount.toFixed(2);
  }

  function setHsStatus(box, html, isError) {
    var status = box.querySelector('.e3d-hotspot-status');
    if (!status) {
      status = document.createElement('div');
      status.className = 'e3d-hotspot-status';
      status.setAttribute('role', 'status');
      box.appendChild(status);
    }
    if (isError) status.setAttribute('data-error', '');
    else status.removeAttribute('data-error');
    status.textContent = '';
    if (html) status.appendChild(html);
  }

  function buildHsProduct(product) {
    var box = document.createElement('div');
    box.className = 'e3d-hotspot-product';
    box.setAttribute('data-handle', product.handle);
    box.setAttribute('data-variant-id', product.variantId);

    var row = document.createElement('div');
    row.className = 'e3d-hotspot-product-row';
    if (product.imageUrl) {
      var img = document.createElement('img');
      img.src = product.imageUrl;
      img.alt = '';
      img.loading = 'lazy';
      row.appendChild(img);
    }
    var info = document.createElement('div');
    var name = document.createElement('div');
    name.className = 'e3d-hotspot-product-title';
    name.textContent = product.title;
    var price = document.createElement('div');
    price.className = 'e3d-hotspot-product-price';
    price.textContent = product.price;
    info.appendChild(name);
    info.appendChild(price);
    row.appendChild(info);
    box.appendChild(row);

    if (product.addToCart || product.buyNow) {
      var actions = document.createElement('div');
      actions.className = 'e3d-hotspot-actions';
      if (product.addToCart) actions.appendChild(hsButton('Add to cart', 'primary', 'add'));
      if (product.buyNow) actions.appendChild(hsButton('Buy now', 'secondary', 'buy'));
      box.appendChild(actions);
    }
    // Always there, so a shopper who wants every option, photo and detail has
    // the full product page one tap away. Carries the chosen variant.
    var view = document.createElement('a');
    view.className = 'e3d-hotspot-product-link';
    view.href = shopRoot() + 'products/' + encodeURIComponent(product.handle) +
      '?variant=' + encodeURIComponent(product.variantId);
    view.textContent = 'View product →';
    box.appendChild(view);
    return box;
  }

  function hsButton(label, style, action) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'e3d-hotspot-btn e3d-hotspot-btn--' + style;
    b.setAttribute('data-action', action);
    b.textContent = label;
    return b;
  }

  /*
   * Live product data, fetched once per card per page load when it opens:
   * the price as the shopper's market shows it, and whether it can be bought.
   * The variant the merchant chose is kept if it is still available; else the
   * first variant that is.
   */
  function refreshHsProduct(box) {
    if (box.__e3dLoaded) return;
    box.__e3dLoaded = true;
    var handle = box.getAttribute('data-handle');
    fetch(shopRoot() + 'products/' + encodeURIComponent(handle) + '.js', { credentials: 'same-origin' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (p) {
        var variants = (p && p.variants) || [];
        if (!variants.length) return;
        var wanted = box.getAttribute('data-variant-id');
        var start = variants.filter(function (v) { return String(v.id) === wanted && v.available; })[0] ||
          variants.filter(function (v) { return v.available; })[0] ||
          variants[0];
        // More than one variant: let the shopper choose before buying.
        if (variants.length > 1) buildHsOptions(box, p, variants, start);
        applyHsVariant(box, start, true);
      })
      .catch(function () {
        // The snapshot stays; the buttons still work with the saved variant.
      });
  }

  // A variant's option values, whichever shape /products/<handle>.js uses.
  function variantValues(v) {
    if (Array.isArray(v.options)) return v.options.map(String);
    return [v.option1, v.option2, v.option3].filter(function (x) {
      return x !== null && x !== undefined;
    }).map(String);
  }

  /*
   * One <select> per product option (Size, Color…), built from the live
   * variants. Changing any of them finds the matching variant and updates the
   * price, stock and what the buttons will buy.
   */
  function buildHsOptions(box, p, variants, start) {
    var names = (p.options || []).map(function (o, i) {
      return typeof o === 'string' ? o : (o && o.name) || 'Option ' + (i + 1);
    });
    var count = Math.max(names.length, variantValues(variants[0]).length);
    if (!count) return;
    var wrap = document.createElement('div');
    wrap.className = 'e3d-hotspot-options';
    var selects = [];
    for (var i = 0; i < count; i++) {
      var values = [];
      variants.forEach(function (v) {
        var val = variantValues(v)[i];
        if (val !== undefined && values.indexOf(val) === -1) values.push(val);
      });
      var label = document.createElement('label');
      label.className = 'e3d-hotspot-option';
      var caption = document.createElement('span');
      caption.textContent = names[i] || 'Option ' + (i + 1);
      var select = document.createElement('select');
      values.forEach(function (val) {
        var opt = document.createElement('option');
        opt.value = val;
        opt.textContent = val;
        select.appendChild(opt);
      });
      select.value = variantValues(start)[i];
      label.appendChild(caption);
      label.appendChild(select);
      wrap.appendChild(label);
      selects.push(select);
    }
    function onChange() {
      var picked = selects.map(function (sel) { return sel.value; });
      var match = variants.filter(function (v) {
        var vals = variantValues(v);
        return picked.every(function (val, idx) { return vals[idx] === val; });
      })[0] || null;
      applyHsVariant(box, match, false);
    }
    selects.forEach(function (sel) {
      sel.addEventListener('change', onChange);
      // Keep presses on the dropdown from reaching the model's controls.
      sel.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    });
    var row = box.querySelector('.e3d-hotspot-product-row');
    if (row && row.nextSibling) box.insertBefore(wrap, row.nextSibling);
    else box.appendChild(wrap);
  }

  // Shows a variant's price and stock and points the buttons at it; null for
  // a combination the product does not have.
  function applyHsVariant(box, variant, initial) {
    var priceEl = box.querySelector('.e3d-hotspot-product-price');
    var buttons = box.querySelectorAll('.e3d-hotspot-btn');
    var link = box.querySelector('.e3d-hotspot-product-link');
    var labels = { add: 'Add to cart', buy: 'Buy now' };
    var status = box.querySelector('.e3d-hotspot-status');
    if (status && !initial) status.textContent = '';
    if (variant && priceEl) priceEl.textContent = formatMoney(variant.price);
    if (variant) {
      box.setAttribute('data-variant-id', String(variant.id));
      if (link) {
        link.href = shopRoot() + 'products/' + encodeURIComponent(box.getAttribute('data-handle')) +
          '?variant=' + encodeURIComponent(String(variant.id));
      }
    } else {
      box.removeAttribute('data-variant-id');
    }
    var buyable = !!(variant && variant.available);
    Array.prototype.forEach.call(buttons, function (b, idx) {
      b.disabled = !buyable;
      var action = b.getAttribute('data-action');
      if (buyable) b.textContent = labels[action] || b.textContent;
      else if (idx === 0) b.textContent = variant ? 'Sold out' : 'Unavailable';
      else b.textContent = labels[action] || b.textContent;
    });
  }

  /*
   * Small viewers: the card opens as a bottom sheet on the page instead of
   * floating by its pin. The viewer crops everything outside itself, so in a
   * small or phone-sized viewer a card of any length was partly hidden; the
   * sheet is fixed to the bottom of the screen, always fully visible and
   * scrollable. The card node itself is moved into the sheet (keeping its
   * listeners and state) and moved back when the hotspot closes.
   */
  var SHEET_MAX_W = 520;
  var SHEET_MAX_H = 380;

  function wantsHsSheet(root) {
    var r = root.getBoundingClientRect();
    return r.width < SHEET_MAX_W || r.height < SHEET_MAX_H || window.innerWidth < 640;
  }

  var hsSheet = null;

  function getHsSheet() {
    if (hsSheet) return hsSheet;
    var backdrop = document.createElement('div');
    backdrop.className = 'e3d-hotspot-sheet-backdrop';
    var sheet = document.createElement('div');
    sheet.className = 'e3d-hotspot-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'e3d-hotspot-sheet-close';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    var body = document.createElement('div');
    body.className = 'e3d-hotspot-sheet-body';
    sheet.appendChild(close);
    sheet.appendChild(body);
    backdrop.appendChild(sheet);
    document.body.appendChild(backdrop);
    hsSheet = { backdrop: backdrop, sheet: sheet, body: body, close: close, current: null };
    function dismiss() {
      if (hsSheet.current && hsSheet.current.annotation.focusing) {
        hsSheet.current.annotation.unfocus();
      } else {
        closeHsSheet();
      }
    }
    close.addEventListener('click', dismiss);
    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop) dismiss();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && hsSheet.current) dismiss();
    });
    // Shop buttons inside a card that now lives in the sheet.
    sheet.addEventListener('click', onHsClick);
    return hsSheet;
  }

  function openHsSheet(annotation) {
    var hEl = annotation.element;
    var card = hEl && hEl.querySelector('.e3d-hotspot-card');
    if (!card) return;
    var s = getHsSheet();
    closeHsSheet();
    s.current = { annotation: annotation, card: card, home: hEl };
    card.style.maxHeight = '';
    s.body.appendChild(card);
    s.sheet.setAttribute('aria-label', card.getAttribute('aria-label') || 'Hotspot');
    s.sheet.style.setProperty('--e3d-hotspot', hEl.style.getPropertyValue('--e3d-hotspot'));
    s.backdrop.setAttribute('data-open', '');
    s.close.focus({ preventScroll: true });
  }

  function closeHsSheet() {
    if (!hsSheet || !hsSheet.current) return;
    var cur = hsSheet.current;
    hsSheet.current = null;
    cur.home.appendChild(cur.card);
    hsSheet.backdrop.removeAttribute('data-open');
  }

  function onHsClick(e) {
    var button = e.target && e.target.closest && e.target.closest('.e3d-hotspot-btn');
    if (!button || button.disabled) return;
    e.stopPropagation();
    var box = button.closest('.e3d-hotspot-product');
    if (box) onHsAction(box, button.getAttribute('data-action'), button);
  }

  /*
   * Fits an opening card inside the viewer. view3d decides flip-up/left from a
   * size measured when the annotation was created — before it was on the page,
   * so 0 — and tall cards ran off the bottom. Mirrors fitHotspotCard in
   * app/lib/hotspots.ts.
   */
  function fitHsCard(annotation, root) {
    var hEl = annotation && annotation.element;
    var card = hEl && hEl.querySelector('.e3d-hotspot-card');
    if (!card) return;
    var box = root.getBoundingClientRect();
    var pin = hEl.getBoundingClientRect();
    var above = pin.top - box.top - 12;
    var below = box.bottom - pin.bottom - 12;
    card.style.maxHeight = Math.max(120, Math.max(above, below)) + 'px';
    if (annotation.resize) annotation.resize();
    Array.prototype.forEach.call(card.querySelectorAll('img'), function (img) {
      if (!img.complete) {
        img.addEventListener('load', function () {
          if (annotation.resize) annotation.resize();
        }, { once: true });
      }
    });
  }

  function onHsAction(box, action, button) {
    var variantId = box.getAttribute('data-variant-id');
    if (!variantId) return;
    if (action === 'buy') {
      // Shopify's cart permalink: one of this variant, straight to checkout.
      onAddToCart();
      flushTrack();
      window.location.href = '/cart/' + encodeURIComponent(variantId) + ':1';
      return;
    }
    var label = button.textContent;
    button.disabled = true;
    button.textContent = 'Adding…';
    fetch(shopRoot() + 'cart/add.js', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ items: [{ id: Number(variantId), quantity: 1 }] })
    })
      .then(function (res) {
        return res.json().then(function (json) {
          if (!res.ok) throw new Error((json && (json.description || json.message)) || 'Could not add to cart');
          return json;
        });
      })
      .then(function () {
        button.textContent = 'Added ✓';
        var frag = document.createDocumentFragment();
        frag.appendChild(document.createTextNode('Added to your cart · '));
        var link = document.createElement('a');
        link.href = shopRoot() + 'cart';
        link.textContent = 'View cart';
        frag.appendChild(link);
        setHsStatus(box, frag, false);
        // Counted as an add-to-cart after 3D in the merchant's Analytics.
        onAddToCart();
        // A nudge for themes that refresh their cart count on these events.
        ['cart:refresh', 'cart:updated', 'cart:change'].forEach(function (name) {
          try {
            document.dispatchEvent(new CustomEvent(name, { bubbles: true }));
          } catch (e) {}
        });
        setTimeout(function () {
          button.disabled = false;
          button.textContent = label;
        }, 2500);
      })
      .catch(function (err) {
        button.disabled = false;
        button.textContent = label;
        setHsStatus(box, document.createTextNode(err.message || 'Could not add to cart'), true);
      });
  }

  /*
   * The page block's library entries leave hotspot text out (it would swell
   * the one shop metafield every page reads) and say `hotspotsRemote: true`
   * instead; this fetches the model's full config through the same endpoints
   * resolveById uses. Everywhere else the hotspots are already in the config.
   */
  function loadHotspots(el, cfg) {
    if (Array.isArray(cfg.hotspots) && cfg.hotspots.length) {
      return Promise.resolve(cfg.hotspots);
    }
    if (!cfg.hotspotsRemote || !el.dataset.modelId) return Promise.resolve([]);
    var urls = resolveEndpoints(el);
    if (!urls.length) return Promise.resolve([]);
    return fetchModel(urls, 0)
      .then(function (data) {
        return (data && data.config && data.config.hotspots) || [];
      })
      .catch(function () {
        return [];
      });
  }

  /*
   * Hover to open (hotspotTrigger 'hover'). Mirrors wireHotspotHover in
   * app/lib/hotspots.ts: a mouse on the pin opens the card without the camera
   * turn (which would pull the pin from under the pointer) via view3d's own
   * _onFocus, so annotationFocus still fires for analytics and the product
   * refresh; leaving pin and card closes it after a short grace period. Touch
   * still taps, and a viewer small enough to show cards as a sheet falls back
   * to click — a modal on hover would be unusable.
   */
  function wireHsHover(hEl, el, getAnn) {
    var timer;
    hEl.addEventListener('pointerenter', function (e) {
      if (e.pointerType !== 'mouse' || wantsHsSheet(el)) return;
      clearTimeout(timer);
      var ann = getAnn();
      if (ann && !ann.focusing && ann._onFocus) {
        // No camera turn to undo when it closes; see resetViewOnHsClose.
        ann.__e3dHoverOpened = true;
        ann._onFocus();
      }
    });
    hEl.addEventListener('pointerleave', function (e) {
      if (e.pointerType !== 'mouse') return;
      clearTimeout(timer);
      timer = setTimeout(function () {
        var ann = getAnn();
        if (ann && ann.focusing && !(hsSheet && hsSheet.current)) ann.unfocus();
      }, 250);
    });
  }

  /*
   * Closing a hotspot's card glides the camera back to the starting view (the
   * toolbar's Reset view). Not when another hotspot opened in the same click,
   * when the shopper dragged the model (view3d closes the card as soon as it
   * is grabbed; a press with no camera movement still counts as a click and
   * resets), or when the card was opened by hover, which never moved the
   * camera. Mirrors resetViewOnHotspotClose in app/lib/hotspots.ts.
   */
  function resetViewOnHsClose(view3d) {
    var holding = false;
    var pending = false;
    var holdPose = null;
    function pose() {
      var p = view3d.camera && view3d.camera.currentPose;
      return p ? [p.yaw, p.pitch, p.zoom] : null;
    }
    function reset() {
      var list = (view3d.annotation && view3d.annotation.list) || [];
      for (var i = 0; i < list.length; i++) if (list[i].focusing) return;
      if (view3d.camera && view3d.camera.reset) view3d.camera.reset(500);
    }
    var controls = (view3d.control && view3d.control.controls) || [];
    controls.forEach(function (c) {
      if (!c.on) return;
      c.on('hold', function () {
        holding = true;
        holdPose = pose();
      });
      c.on('release', function () {
        holding = false;
        if (!pending) return;
        pending = false;
        var now = pose();
        var moved = !holdPose || !now || now.some(function (v, i) {
          return Math.abs(v - holdPose[i]) > 0.5;
        });
        if (!moved) reset();
      });
    });
    view3d.on('annotationUnfocus', function (e) {
      var ann = e && e.annotation;
      var hovered = !!(ann && ann.__e3dHoverOpened);
      if (ann) ann.__e3dHoverOpened = false;
      if (hovered) return;
      // After the event that closed it: by then a pin pressed in the same
      // click has opened, and a press on the model has reported its hold —
      // whose release then decides between a click and a drag.
      setTimeout(function () {
        if (holding) pending = true;
        else reset();
      }, 0);
    });
  }

  function attachHotspots(el, view3d, cfg) {
    if (cfg.showHotspots === false) return;
    var V = getCtor() && window.View3D;
    var Face = V && (V.FaceAnnotation || (V.default && V.default.FaceAnnotation));
    var Point = V && (V.PointAnnotation || (V.default && V.default.PointAnnotation));
    if (!Face || !Point || !view3d.annotation) return;
    var color = /^#[0-9a-f]{6}$/i.test(cfg.hotspotColor || '') ? cfg.hotspotColor : '#2a78d6';
    var label = cfg.hotspotLabel === 'title' ? 'title' : 'number';
    var hover = cfg.hotspotTrigger === 'hover';

    loadHotspots(el, cfg).then(function (raw) {
      var list = sanitizeHotspots(raw);
      if (!list.length || !document.contains(el)) return;
      var annotations = list.map(function (h, i) {
        var hEl = buildHotspotEl(h, i, color, label);
        if (hover) {
          wireHsHover(hEl, el, function () { return annotations[i]; });
        }
        // A second press on an open hotspot closes it. Runs before view3d's
        // own click handler (attached later, by annotation.add), which only
        // ever opens — so it must stop that one from reopening.
        hEl.addEventListener('click', function (e) {
          var ann = annotations[i];
          // Only the pin toggles; presses inside the open card (Add to cart,
          // play, links) must leave it open.
          var onPin = e.target && e.target.closest && e.target.closest('.e3d-hotspot-pin');
          // Not stopped either: the shop buttons' listener is further up, on
          // the viewer, and view3d's own handler only re-focuses an open one.
          if (!onPin) return;
          if (ann && ann.focusing) {
            e.stopImmediatePropagation();
            ann.unfocus();
          }
        });
        var common = { element: hEl, focus: h.focus, focusDuration: 700 };
        if (h.meshIndex >= 0 && h.faceIndex >= 0) {
          return new Face(view3d, Object.assign({}, common, {
            meshIndex: h.meshIndex,
            faceIndex: h.faceIndex,
            weights: h.weights
          }));
        }
        return new Point(view3d, Object.assign({}, common, { position: h.position }));
      });
      try {
        view3d.annotation.add.apply(view3d.annotation, annotations);
        if (view3d.renderer && view3d.renderer.renderSingleFrame) {
          view3d.renderer.renderSingleFrame();
        }
      } catch (err) {
        console.warn('[viewer-3d] could not add hotspots:', err);
        return;
      }
      // Counted for the merchant's Analytics, once per viewer per page load.
      // Opening a hotspot is using the 3D model, so it counts as an
      // interaction too — which is what credits a hotspot's add-to-cart to 3D.
      view3d.on('annotationFocus', function (e) {
        track(el, 'f_hotspot');
        track(el, 'interact');
        var hEl = e && e.annotation && e.annotation.element;
        var product = hEl && hEl.querySelector('.e3d-hotspot-product');
        if (product) refreshHsProduct(product);
        if (!hEl) return;
        primeHsVideoFrames(hEl);
        if (wantsHsSheet(el)) openHsSheet(e.annotation);
        else fitHsCard(e.annotation, el);
      });
      resetViewOnHsClose(view3d);
      view3d.on('annotationUnfocus', function (e) {
        var hEl = e && e.annotation && e.annotation.element;
        if (hsSheet && hsSheet.current && hsSheet.current.annotation === e.annotation) {
          closeHsSheet();
        }
        if (hEl) resetHsVideos(hEl);
      });
      // Shop buttons, delegated: one listener for every card in this viewer.
      el.addEventListener('click', onHsClick);
      // Escape closes an open hotspot.
      el.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        annotations.forEach(function (a) {
          if (a.focusing) a.unfocus();
        });
      });
    });
  }

  function mountOne(el, done) {
    var Ctor = getCtor();
    patchWebXrNoOverlay();
    if (!Ctor) {
      showError(el, 'egjs-view3d library not loaded');
      done();
      return;
    }

    var modelUrl = el.dataset.modelUrl;

    /*
     * Ask the app for this model whenever Liquid could not supply the whole
     * picture — a missing URL, or a URL without the model's saved settings.
     *
     * Only the missing-URL half used to trigger this. The other half failed
     * silently and was the harder bug by far: the viewer appeared, looked
     * plausible, and simply had the wrong controls, because a config the block
     * never received is indistinguishable downstream from one the merchant
     * never configured. A viewer showing settings that were changed weeks ago
     * is worth one request to avoid.
     *
     * data-config-complete is set by the block when it emitted the model's real
     * config. The product block has no id to resolve and always reads the
     * config straight off the product metafield, so it is unaffected.
     */
    var needsConfig = el.dataset.modelId && !el.dataset.configComplete;
    if ((!modelUrl || needsConfig) && !el.hasAttribute(RESOLVED_ATTR)) {
      if (el.dataset.modelId && (el.dataset.proxyBase || el.dataset.apiBase)) {
        el.removeAttribute(INIT_ATTR);
        // The slot goes back before the request, not after it: this detour is a
        // network round trip that builds nothing, so holding the queue shut for
        // its duration would stall every other viewer behind it. resolveById
        // re-enters through enqueueMount and takes a fresh slot then.
        done();
        resolveById(el);
        return;
      }
    }

    if (!modelUrl) {
      showError(el, 'no model URL set');
      done();
      return;
    }

    // view3d paints its own poster over the canvas until the model is ready, so
    // ours would sit under it doing nothing. Removed before the snapshot below,
    // or every restore would bring a stale copy of it back.
    removePlaceholder(el);

    // Snapshotted before anything is built onto the element, and keyed on the
    // element rather than stored on the record so it survives the record being
    // dropped by an eviction and is still there for the re-mount after it.
    if (!pristineHTML.has(el)) pristineHTML.set(el, el.innerHTML);

    // Free a context *before* taking another, not after: the point is to never
    // be holding one over budget, not to notice afterwards that we were.
    enforceLiveBudget(el);

    var posterUrl = el.dataset.posterUrl || '';
    var preview = parseHashPreview();
    // Defaults first so a key absent from the metafield resolves to the app's
    // default rather than view3d's; the hash preview (written by the admin's
    // "Preview on storefront" button) wins over the saved config so an unsaved
    // draft can be previewed live.
    var cfg = Object.assign(baseConfig(el), parseConfig(el.dataset.config));
    if (preview && typeof preview === 'object') {
      cfg = Object.assign(cfg, preview);
      console.log('[viewer-3d] preview config applied from URL hash', preview);
    }
    cfg.controlsLayout = normalizeControlsLayout(cfg.controlsLayout);

    // The USDZ Shopify generated for this product — the only file iOS Quick
    // Look can open, and without it the AR button does nothing on an iPhone.
    //
    // Applied after the merge rather than as a baseConfig default, because a
    // saved config always carries an explicit "iosSrc": "" and compact() only
    // drops null — so as a default it would have been overwritten by that empty
    // string every time and never once taken effect. Only fills a gap, so a
    // merchant who typed their own iOS AR source still wins.
    if (!cfg.iosSrc && el.dataset.iosSrc) cfg.iosSrc = el.dataset.iosSrc;
    applyWrapperStyles(el, cfg);

    var options = buildOptions(modelUrl, posterUrl, cfg);

    try {
      var view3d = new Ctor(el, options);
      console.log('[viewer-3d] initialized', modelUrl, options);

      // Registered before anything else can throw, so a later failure still
      // leaves the instance reachable for teardown rather than orphaning the
      // very context this is meant to reclaim.
      //
      // visible starts true because reaching here means the observer saw this
      // element approach the viewport (or there is no observer, in which case
      // every viewer is treated as visible and nothing is ever paused). ready
      // and paused are what pauseRender/resumeRender arbitrate over.
      var record = {
        el: el,
        view3d: view3d,
        observer: null,
        visible: isElVisible(el),
        ready: false,
        paused: false,
        // Re-stamped each time it leaves the viewport; this initial value only
        // orders viewers that have been built but never scrolled away yet.
        lastVisible: Date.now(),
        // True while a WebXR AR session is running (see pauseRender).
        inAR: false
      };
      instances.push(record);

      view3d.on('arStart', function () {
        // The session has installed its own loop: nothing of ours is paused.
        record.inAR = true;
        record.paused = false;
      });
      view3d.on('arEnd', function () {
        record.inAR = false;
        // view3d restores its default loop when AR ends; back to the normal
        // rules if the viewer is off screen or the tab hidden.
        if (!record.visible || document.hidden) pauseRender(record);
      });

      // Created only once construction has succeeded, so a constructor throw
      // leaves the error panel alone on the element rather than stacked under a
      // spinner that nothing will ever clear.
      var loadingOverlay = buildLoadingOverlay(el);

      // `is-loaded` both reveals the toolbar and runs its entrance animation.
      // Holding it back until the model is actually ready mirrors the admin,
      // which can't render its toolbar any earlier — the animation selector
      // needs the clip list, which only exists once the model has loaded.
      view3d.once('ready', function () {
        // A view is a model that actually loaded — viewers mount lazily as
        // they approach the viewport, so this is close to "seen".
        track(el, 'view');
        trackFirstInteraction(el);
        trackDwell(el);
        attachHotspots(el, view3d, cfg);
        el.classList.add('is-loaded');
        loadingOverlay.remove();
        record.ready = true;
        // The vendor (re)starts its own render loop as part of finishing a load,
        // so a viewer scrolled out of view while it was still loading would come
        // back rotating away offscreen. This is the one place that can catch
        // that, since the observer has already delivered its callback for it.
        if (!record.visible) pauseRender(record);
        // Frees the queue for the next viewer only once this model is actually
        // decoded — the whole point of the cap is that the expensive stretch
        // doesn't overlap with another one.
        done();
      });
      view3d.once('loadError', function () {
        loadingOverlay.remove();
        showError(el, 'Failed to load model');
        done();
      });

      // view3d's own auto-resizer only reliably re-fits the camera when the
      // container's size at construction time was exactly 0x0. Theme
      // sections/grids often have *some* non-zero but still-transitional size
      // at that moment (lazy images, fonts, carousels still resizing) — in
      // that case view3d's resizer discards the one notification that would
      // have corrected the fit, permanently leaving the model too big or too
      // small. Running our own resize on every real layout change, for the
      // life of the element, guarantees it self-corrects no matter when the
      // container actually settles.
      if (window.ResizeObserver) {
        var resizeRaf = 0;
        var resizeObserver = new ResizeObserver(function () {
          cancelAnimationFrame(resizeRaf);
          resizeRaf = requestAnimationFrame(function () {
            if (view3d.resize) view3d.resize();
          });
        });
        resizeObserver.observe(el);
        record.observer = resizeObserver;
      }

      var showAxes = cfg.showAxes;
      // Every control except the axis gizmo is one of our own overlays
      // (buildMiniToolbar / buildAnimationList) rather than the vendor's
      // ControlBar — a fixed full-width bottom strip with a click-to-open clip
      // dropdown. Ours can be positioned independently, adds zoom in/out, and
      // shows the clip list inline. The play button and progress bar, the only
      // two features that came from the plugin itself, have been removed, so the
      // gizmo is now the sole reason to load it at all.
      //
      // autoHide is off because it is on by default and registers
      // pointerenter/pointerleave handlers plus a class-toggling timer for a bar
      // that holds nothing here — and "show on hover" faded an empty 48px strip
      // of rgba(0,0,0,.3) across the bottom of the model. The bar itself is
      // hidden in viewer-3d.css. The gizmo's per-frame-positioned axis hit
      // targets are dealt with below.
      if (showAxes && window.View3D && window.View3D.ControlBar) {
        try {
          // eslint-disable-next-line no-inner-declarations
          var detachGizmoHitTargets = function () {
            try {
              var axes = el.querySelectorAll('.view3d-gizmo .view3d-gizmo-axis');
              for (var i = 0; i < axes.length; i++) {
                if (axes[i].parentNode) axes[i].parentNode.removeChild(axes[i]);
              }
            } catch (e) {}
          };
          var plugins = view3d.loadPlugins(new window.View3D.ControlBar({
            autoHide: false,
            playButton: false,
            progressBar: false,
            animationSelector: false,
            fullscreenButton: false,
            cameraResetButton: false,
            navigationGizmo: showAxes
          }));
          // loadPlugins is async and its rejection would otherwise be unhandled.
          // Its resolution is also when the gizmo has appended its six axis hit
          // targets, which have to come straight back out — see
          // detachGizmoHitTargets in app/components/ViewerPreview.tsx for the
          // full reasoning. Short version: NavigationGizmo._onRender rewrites
          // left/top/zIndex on all six on every rendered frame, so leaving them
          // in the document means ~1000 attribute mutations a second on a
          // merchant's storefront page — which any MutationObserver in the theme
          // or another app then has to process, forever. In the admin that alone
          // was enough to make App Bridge rebuild the page's header buttons
          // faster than a click could land. Detached, view3d writes to them
          // harmlessly; the visible gizmo is canvas-painted and unaffected.
          if (plugins && plugins.then) {
            plugins.then(detachGizmoHitTargets).catch(function (pluginErr) {
              console.warn('[viewer-3d] ControlBar plugin failed:', pluginErr);
            });
          }
        } catch (pluginErr) {
          console.warn('[viewer-3d] ControlBar plugin failed:', pluginErr);
        }
      }

      // After View3D has enabled its own controls, or the disable would be
      // overwritten the moment the model finished loading.
      view3d.once('ready', function () {
        applyControlPermissions(view3d, cfg);
      });

      var place = buildMiniToolbar(el, view3d, cfg);
      buildAnimationList(el, view3d, cfg, place);
    } catch (err) {
      showError(el, 'init failed: ' + (err && err.message ? err.message : err));
      // A throw here means neither 'ready' nor 'loadError' will ever fire, so
      // this is the only thing that can hand the slot back.
      done();
    }
  }

  /*
   * Second resolution path for a Model ID: ask the app.
   *
   * The block prefers to resolve the id in Liquid from the shop metafield the
   * app mirrors its library into, which costs no request and survives the app
   * being down. When that lookup comes back empty the block emits
   * data-model-id + data-api-base instead of an error panel, and this fills in
   * the model URL and config from /api/model/<id>.
   *
   * On success it re-enters the mount queue, so there is exactly one code path
   * building a viewer regardless of where the model details came from. It goes
   * through enqueueMount rather than calling mountOne directly so the load still
   * takes a queue slot — a resolved viewer is no cheaper to build than any other.
   */
  var RESOLVING_ATTR = 'data-view3d-resolving';
  // Set once the app has been asked about this element, successfully or not, so
  // a config top-up is attempted exactly once per element instead of on every
  // re-entry into the mount.
  var RESOLVED_ATTR = 'data-view3d-resolved';

  // Every place the id might be resolvable from, in order of preference.
  //
  // The proxy path is relative, so it hits the shop's own domain and Shopify
  // forwards it to the app — same-origin, and nothing here needs to know the
  // app's URL. The absolute origin is the fallback for a shop whose app proxy
  // isn't deployed; it is also the one that produced nothing but "Failed to
  // fetch" whenever the hardcoded URL in the block had gone stale, which is why
  // it is no longer tried first.
  function resolveEndpoints(el) {
    var id = encodeURIComponent(el.dataset.modelId);
    var urls = [];
    function add(base, path) {
      if (!base) return;
      urls.push(String(base).replace(/\/+$/, '') + path + id);
    }
    add(el.dataset.proxyBase, '/model/');
    add(el.dataset.apiBase, '/api/model/');
    return urls;
  }

  function fetchModel(urls, index) {
    var url = urls[index];
    return fetch(url, { credentials: 'omit' })
      .then(function (res) {
        // A shop without the app proxy configured answers with its own 404 HTML
        // page, not JSON, so the status has to be checked before parsing or the
        // real error would surface as a JSON syntax complaint.
        if (!res.ok) throw new Error('HTTP ' + res.status + ' from ' + url);
        return res.json();
      })
      .then(function (data) {
        if (!data || !data.url) throw new Error('no file for this id');
        return data;
      })
      .catch(function (err) {
        if (index + 1 < urls.length) {
          console.warn('[viewer-3d] ' + err.message + ' — trying next endpoint');
          return fetchModel(urls, index + 1);
        }
        throw err;
      });
  }

  function resolveById(el) {
    // initAll re-runs on shopify:section:load, and initOne bounces back here
    // each time while the fetch is outstanding — without this guard a theme
    // editor session would queue a request per re-render.
    if (el.hasAttribute(RESOLVING_ATTR)) return;
    el.setAttribute(RESOLVING_ATTR, '');

    var id = el.dataset.modelId;
    // Whether the element can still render if this lookup fails. When Liquid
    // already resolved the URL this is only a config top-up, so a failure must
    // degrade to the config we have rather than replacing a working viewer with
    // an error panel.
    var optional = !!el.dataset.modelUrl;
    var urls = resolveEndpoints(el);
    if (!urls.length) {
      el.removeAttribute(RESOLVING_ATTR);
      el.setAttribute(RESOLVED_ATTR, '');
      if (optional) return enqueueMount(el);
      showError(el, 'no way to resolve model "' + id + '"');
      return;
    }

    fetchModel(urls, 0)
      .then(function (data) {
        el.setAttribute('data-model-url', data.url);
        // The block's own data-config holds only its two interaction settings
        // when the id didn't resolve; the model's saved settings are better, so
        // they replace it rather than merging under it.
        if (data.config) {
          el.setAttribute('data-config', JSON.stringify(data.config));
        }
        // Set before re-entering the mount, so the fresh config can't send it
        // straight back here for another round.
        el.setAttribute(RESOLVED_ATTR, '');
        el.removeAttribute(RESOLVING_ATTR);
        enqueueMount(el);
      })
      .catch(function (err) {
        el.removeAttribute(RESOLVING_ATTR);
        el.setAttribute(RESOLVED_ATTR, '');

        if (optional) {
          // Loud, because the alternative is what made this so hard to see: a
          // viewer that renders perfectly well with the wrong controls, and no
          // hint anywhere that its settings never arrived.
          console.warn(
            '[viewer-3d] model "' + id + '" rendered WITHOUT its saved settings' +
              ' — could not reach the app (' +
              (err && err.message ? err.message : err) +
              '; tried: ' + urls.join(', ') + '). Controls, animation and' +
              ' background fall back to defaults until this resolves.',
          );
          return enqueueMount(el);
        }

        // Names the id and every endpoint tried. "Failed to fetch" on its own is
        // the browser refusing to say whether it was DNS, CORS or a dead host,
        // and without the URLs there is no way to tell which.
        showError(
          el,
          'could not load model "' + id + '" — ' +
            (err && err.message ? err.message : err) +
            ' (tried: ' + urls.join(', ') + ')',
        );
      });
  }

  function initAll() {
    // Before adding more, reclaim any whose element has left the document.
    teardownDetached();
    document.querySelectorAll('[data-view3d]').forEach(initOne);
  }

  /*
   * No `whenReady` wait for window.View3D any more. It used to poll for the
   * eager vendor script before doing anything at all, which is now backwards:
   * initAll only *registers* elements with the observer, and the observer is
   * what asks for the library. Waiting here would mean nothing is registered —
   * so nothing ever comes into view — until a bundle that is never requested
   * arrives.
   */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }

  document.addEventListener('shopify:section:load', initAll);

  // The theme editor's own signal that a section is going away. initAll's sweep
  // would catch it on the next render anyway, but only if another render
  // follows — deleting the last viewer on the page never produces one, and the
  // orphaned render loop would run until the tab was closed.
  document.addEventListener('shopify:section:unload', function () {
    teardownDetached();
  });

  /*
   * A backgrounded tab is the other case where viewers burn cycles for nothing.
   * Browsers throttle rAF heavily there, but not to zero in every engine, and a
   * throttled three.js draw still costs GPU on a machine the shopper has moved
   * on from. Stopping the loops outright makes it exactly free.
   *
   * On the way back, only the ones the observer says are on screen resume — the
   * offscreen ones stay paused and are woken by their own intersection.
   */
  document.addEventListener('visibilitychange', function () {
    for (var i = 0; i < instances.length; i++) {
      if (document.hidden) pauseRender(instances[i]);
      else if (instances[i].visible) resumeRender(instances[i]);
    }
  });
})();
