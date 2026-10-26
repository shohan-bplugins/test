// In-page controller for the hotspot showcase recording. The driver
// (rec/record.mjs) calls window.show.* and moves the real mouse; everything
// inside the viewer is the shipping storefront widget.
import * as THREE from "/three.module.js";

const APP_NAME = "Easy 3D Viewer";

const $ = (s, r = document) => r.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- pointer: the fake cursor follows real mouse events ---------- */
const cursor = $("#cursor");
let cursorHidden = false;
document.addEventListener("mousemove", (e) => {
  if (!cursorHidden) cursor.style.transform = `translate(${e.clientX - 3}px, ${e.clientY - 2}px)`;
}, true);
document.addEventListener("mousedown", (e) => {
  cursor.classList.add("press");
  ring(e.clientX, e.clientY);
}, true);
document.addEventListener("mouseup", () => cursor.classList.remove("press"), true);

function ring(x, y) {
  const t = $("#tapdot");
  t.style.left = x + "px";
  t.style.top = y + "px";
  t.classList.remove("go");
  void t.offsetWidth;
  t.classList.add("go");
}

/* ---------- cart badge reacts to the widget's own cart events ---------- */
let cartCount = 0;
document.addEventListener("cart:refresh", () => {
  const b = $("#cartCount");
  b.textContent = String(++cartCount);
  b.classList.add("bump");
  setTimeout(() => b.classList.remove("bump"), 450);
});

/* ---------- viewers ---------- */
function mountViewer(slot, { model, cfg, height, bg }) {
  slot = typeof slot === "string" ? $(slot) : slot;
  slot.textContent = "";
  const before = (window.__v3d || []).length;
  const el = document.createElement("div");
  el.className = "viewer-3d";
  el.style.cssText = `--viewer-height:${height}px;--viewer-bg:${bg};background:${bg};`;
  el.setAttribute("data-view3d", "");
  el.dataset.modelUrl = "/" + model;
  el.dataset.viewerHeight = String(height);
  el.dataset.viewerBg = bg;
  el.dataset.placement = "product";
  el.dataset.config = JSON.stringify(Object.assign({ background: bg, height }, cfg));
  el.innerHTML = '<canvas class="view3d-canvas"></canvas>';
  slot.appendChild(el);
  document.dispatchEvent(new Event("shopify:section:load"));
  return new Promise((resolve) => {
    const tick = () => {
      const list = window.__v3d || [];
      const v = list.length > before && list[list.length - 1];
      if (v && v.initialized) {
        window.v3d = v;
        resolve(true);
      } else setTimeout(tick, 50);
    };
    tick();
  });
}

async function setPose(yaw, pitch, zoom, ms = 0) {
  const v = window.v3d;
  const P = v.camera.currentPose.constructor;
  await v.camera.reset(ms, undefined, new P(yaw, pitch, zoom, v.camera.currentPose.pivot.clone()));
  v.renderer.renderSingleFrame();
}

/* Same posed hit test as pickHotspotAnchor in app/components/ViewerPreview.tsx. */
function pick(clientX, clientY) {
  const v = window.v3d;
  const camera = v.camera.threeCamera;
  const rect = v.renderer.canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  const rc = new THREE.Raycaster();
  rc.setFromCamera(ndc, camera);
  const ray = rc.ray;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), p = new THREE.Vector3(), t = new THREE.Vector3();
  let best = null;
  v.model.meshes.forEach((mesh, meshIndex) => {
    const g = mesh.geometry, pos = g.attributes.position, index = g.index;
    const faces = Math.floor((index ? index.count : pos.count) / 3);
    const get = (i, out) => {
      out.fromBufferAttribute(pos, i);
      if (mesh.isSkinnedMesh && mesh.boneTransform) mesh.boneTransform(i, out);
      return out.applyMatrix4(mesh.matrixWorld);
    };
    for (let f = 0; f < faces; f++) {
      const i0 = index ? index.getX(f * 3) : f * 3, i1 = index ? index.getX(f * 3 + 1) : f * 3 + 1, i2 = index ? index.getX(f * 3 + 2) : f * 3 + 2;
      get(i0, a); get(i1, b); get(i2, c);
      if (!ray.intersectTriangle(a, b, c, false, p)) continue;
      const d = p.distanceTo(ray.origin);
      if (best && d >= best.d) continue;
      THREE.Triangle.getBarycoord(p, a, b, c, t);
      best = { d, meshIndex, faceIndex: f, weights: [t.x, t.y, t.z], point: [p.x, p.y, p.z], indexed: !!index };
    }
  });
  if (!best) return null;
  const pose = v.camera.currentPose;
  const focus = [pose.yaw, pose.pitch, pose.zoom];
  return best.indexed
    ? { meshIndex: best.meshIndex, faceIndex: best.faceIndex, weights: best.weights, position: null, focus }
    : { meshIndex: -1, faceIndex: -1, weights: [1 / 3, 1 / 3, 1 / 3], position: best.point, focus };
}

/* A pin added live, as the admin's editor does after a click on the model. */
function addLivePin(anchor, { n, title, color }) {
  const V = window.View3D;
  const el = document.createElement("div");
  el.className = "view3d-annotation e3d-hotspot";
  el.style.setProperty("--e3d-hotspot", color);
  el.innerHTML = '<button type="button" class="e3d-hotspot-pin"></button><div class="view3d-annotation-tooltip e3d-hotspot-card"><div class="e3d-hotspot-title"></div><div class="e3d-hotspot-text"></div></div>';
  el.querySelector(".e3d-hotspot-pin").textContent = String(n);
  el.querySelector(".e3d-hotspot-title").textContent = title;
  const common = { element: el, focus: anchor.focus, focusDuration: 700 };
  const ann = anchor.meshIndex >= 0
    ? new V.FaceAnnotation(window.v3d, Object.assign({}, common, { meshIndex: anchor.meshIndex, faceIndex: anchor.faceIndex, weights: anchor.weights }))
    : new V.PointAnnotation(window.v3d, Object.assign({}, common, { position: anchor.position }));
  window.v3d.annotation.add(ann);
  window.livePin = { el, ann };
  el.animate([{ transform: "scale(0)" }, { transform: "scale(1.25)" }, { transform: "scale(1)" }], { duration: 420, easing: "ease-out", composite: "add" });
}
function setLivePinText(title, text) {
  if (!window.livePin) return;
  window.livePin.el.querySelector(".e3d-hotspot-title").textContent = title;
  window.livePin.el.querySelector(".e3d-hotspot-text").textContent = text;
}

/* ---------- caption + transitions ---------- */
async function caption(kick, html) {
  const box = $("#caption");
  if (box.classList.contains("on")) {
    box.classList.remove("on");
    await sleep(380);
  }
  if (!html) return;
  $("#capKick").textContent = kick || "";
  $("#capText").innerHTML = html;
  box.classList.add("on");
}
async function wipe(on) {
  $("#wipe").classList.toggle("on", on);
  await sleep(520);
}
function hideCursor(h) {
  cursorHidden = h;
  if (h) cursor.style.transform = "translate(-100px,-100px)";
}

const BOLT = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="m3 7 9 5 9-5M12 12v10"/></svg>';

function scene(html) {
  const s = $("#scene");
  s.innerHTML = html;
  s.classList.toggle("on", !!html);
  return s;
}
function intro() {
  scene(`<div class="card"><div class="glow"></div><div class="anim-in" style="position:relative;display:flex;flex-direction:column;align-items:center">
    <div class="badge"><i>${BOLT}</i>${APP_NAME}</div>
    <h2><span>Hotspots</span></h2>
    <p>Tell the story of every detail — right on the 3D model.</p>
    <div class="pins"><b>1</b><b>2</b><b>3</b><b>4</b></div></div></div>`);
}
function outro() {
  scene(`<div class="card"><div class="glow"></div><div class="anim-in" style="position:relative;display:flex;flex-direction:column;align-items:center">
    <div class="badge"><i>${BOLT}</i>${APP_NAME} for Shopify</div>
    <h2 style="font-size:96px"><span>Hotspots</span></h2>
    <p>Up to 20 per model · on Pro and Pro Plus</p>
    <ul>
      <li><b>Explain</b>Titles, notes and links pinned to the exact spot</li>
      <li><b>Show</b>Images and video — YouTube, Vimeo or your own file</li>
      <li><b>Sell</b>Live price, variants and Add to cart, inside the model</li>
    </ul></div></div>`);
}
function phone() {
  scene(`<div class="phone-scene">
    <div class="phone-copy anim-in"><div class="k">On mobile</div><h3>Cards become a bottom sheet.</h3>
      <p>Small screens get a full-width sheet that’s always readable and scrollable — with the same shop buttons.</p></div>
    <div class="phone"><div class="notch"></div><iframe id="phoneFrame" src="/mobile.html"></iframe></div></div>`);
}
function admin() {
  scene(`<div class="admin">
    <div class="topbar"><div class="shop"></div><b>Aurora Supply Co.</b><div class="search">Search</div></div>
    <div class="side"><div>Home</div><div>Orders</div><div>Products</div><div>Customers</div><div>Content</div><div>Analytics</div>
      <div class="sec">Apps</div><div class="app on"><i></i>${APP_NAME}</div><div style="padding-left:38px">Products</div><div style="padding-left:38px">3D Model Library</div><div style="padding-left:38px">Analytics</div></div>
    <div class="main">
      <div class="head"><span class="back">←</span>Aurora Runner<span class="save" id="admSave">Save</span></div>
      <div class="cols">
        <div class="pcard"><h4>Preview</h4><div class="admin-viewer" id="admViewer"></div></div>
        <div class="pcard"><h4>Hotspots</h4>
          <div class="banner" id="admBanner"><b>Click the model to place the hotspot</b><span>Turn the model to the side you want first — the hotspot opens from this same angle for shoppers.</span></div>
          <div class="hs-toolbar" id="admTools"><button class="pbtn" id="admAdd">＋ Add hotspot</button><span class="sub" id="admCount">4 of 20</span></div>
          <div class="hs-list" id="admList">
            ${["Breathable knit upper", "Recycled FOAM midsole", "Heel pull tab", "Reflective laces"].map((t, i) =>
              `<div class="hs-item"><div class="hs-row"><span class="hs-num" style="background:#2a78d6">${i + 1}</span>${t}<span class="tools">◉ ↑ ↓ ✕</span></div></div>`).join("")}
          </div>
          <div class="settings">
            <div>Hotspot color<b><span class="sw" style="background:#2a78d6"></span>#2a78d6</b></div>
            <div>Pin shows<b>Number</b></div>
            <div>Open hotspot on<b>Click</b></div>
            <div>Show hotspots on the storefront<b>On</b></div>
          </div>
        </div>
      </div>
    </div></div>`);
}
function adminPlacing(on) {
  $("#admBanner").classList.toggle("on", on);
  $("#admTools").style.display = on ? "none" : "flex";
  $("#admViewer").classList.toggle("placing", on);
}
function adminNewItem() {
  const item = document.createElement("div");
  item.className = "hs-item new";
  item.innerHTML = `<div class="hs-row"><span class="hs-num" style="background:#2a78d6">5</span><span id="admNewTitle">Hotspot 5</span><span class="tools">◉ ↑ ↓ ✕</span></div>
    <div class="field"><label>Title</label><div class="in" id="admTitleIn"></div></div>
    <div class="field"><label>Description</label><div class="in ta" id="admDescIn"></div></div>
    <div class="chips"><span>＋ Image</span><span>＋ Video</span><span>＋ Product</span></div>`;
  $("#admList").appendChild(item);
  $("#admCount").textContent = "5 of 20";
}
async function adminType(which, text, ms = 38) {
  const box = $(which === "title" ? "#admTitleIn" : "#admDescIn");
  document.querySelectorAll(".field .in").forEach((x) => x.classList.remove("focus"));
  box.classList.add("focus");
  for (let i = 1; i <= text.length; i++) {
    box.innerHTML = "";
    box.append(text.slice(0, i));
    box.insertAdjacentHTML("beforeend", '<span class="caret"></span>');
    const card = window.livePin?.el;
    if (which === "title") {
      $("#admNewTitle").textContent = text.slice(0, i);
      setLivePinText(text.slice(0, i), card?.querySelector(".e3d-hotspot-text").textContent || "");
    } else {
      setLivePinText(card?.querySelector(".e3d-hotspot-title").textContent || "", text.slice(0, i));
    }
    await sleep(ms);
  }
}

function product(title, price, lede, opt) {
  $("#pTitle").textContent = title;
  $("#pPrice").textContent = price;
  $("#pLede").textContent = lede;
  if (!opt) return;
  $(".crumb").textContent = opt.crumb;
  const labels = document.querySelectorAll(".opt-label");
  labels[0].innerHTML = `Color — <b>${opt.color}</b>`;
  labels[1].textContent = opt.sizeLabel;
  $(".swatches").innerHTML = opt.swatches.map((c, i) => `<i style="background:${c}"${i ? "" : ' class="on"'}></i>`).join("");
  $(".sizes").innerHTML = opt.sizes.map((x, i) => `<span style="width:auto;padding:0 18px"${i ? "" : ' class="on"'}>${x}</span>`).join("");
}

window.show = {
  mountViewer, setPose, pick, addLivePin, setLivePinText, caption, wipe, hideCursor,
  intro, outro, phone, admin, adminPlacing, adminNewItem, adminType, scene, product, ring,
  rect: (sel) => { const r = (typeof sel === "string" ? $(sel) : sel).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; },
  ready: true,
};
