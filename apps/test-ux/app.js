/* Bac à sable UX hifago — moteur générique de rendu + navigation.
   Ne pas modifier pour ajouter un écran : éditer screens.js. Voir README.md. */

(function () {
  "use strict";

  var GAP = { sm: "var(--wf-gap-sm)", md: "var(--wf-gap-md)", lg: "var(--wf-gap-lg)" };
  var CONTAINER_TYPES = ["row", "col", "header", "nav", "footer", "card", "list-item", "grid"];

  function applyLayoutProps(el, spec) {
    if (spec.justify) el.style.justifyContent = spec.justify;
    if (spec.align) el.style.alignItems = spec.align;
    if (spec.gap) el.style.gap = GAP[spec.gap] || spec.gap;
    if (spec.wrap) el.style.flexWrap = "wrap";
    if (spec.grow) { el.style.flexGrow = "1"; el.style.flexBasis = "0"; el.style.minWidth = "0"; }
    if (spec.width) el.style.width = spec.width;
    if (spec.height) el.style.height = spec.height;
  }

  function makeClickable(el, spec) {
    if (!spec.onClick) return;
    el.classList.add("wf-clickable");
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.title = "Aller à l'écran : " + spec.onClick;
    var go = function (e) {
      e.preventDefault();
      navigate(spec.onClick);
    };
    el.addEventListener("click", go);
    el.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") go(e);
    });
  }

  function renderLeaf(spec) {
    var el;
    switch (spec.type) {
      case "text": {
        el = document.createElement("p");
        el.className = "wf-block wf-text wf-text-" + (spec.variant || "body");
        el.textContent = spec.label || "";
        break;
      }
      case "image": {
        el = document.createElement("div");
        el.className = "wf-block wf-image";
        var cap = document.createElement("span");
        cap.textContent = spec.label || "photo";
        el.appendChild(cap);
        break;
      }
      case "avatar": {
        el = document.createElement("div");
        el.className = "wf-block wf-avatar";
        el.textContent = spec.label ? spec.label.slice(0, 2).toUpperCase() : "AV";
        break;
      }
      case "badge": {
        el = document.createElement("span");
        el.className = "wf-block wf-badge";
        el.textContent = spec.label || "badge";
        break;
      }
      case "divider": {
        el = document.createElement("hr");
        el.className = "wf-block wf-divider";
        break;
      }
      case "button": {
        el = document.createElement("button");
        el.type = "button";
        el.className = "wf-block wf-button wf-button-" + (spec.variant || "secondary");
        el.textContent = spec.label || "Bouton";
        break;
      }
      case "searchbar": {
        el = document.createElement("div");
        el.className = "wf-block wf-searchbar";
        el.innerHTML = '<span class="wf-icon">🔍</span><span>' + (spec.label || "Rechercher…") + "</span>";
        break;
      }
      case "select": {
        el = document.createElement("div");
        el.className = "wf-block wf-select";
        el.innerHTML = "<span>" + (spec.label || "Sélection") + "</span><span>▾</span>";
        break;
      }
      case "checkbox": {
        el = document.createElement("label");
        el.className = "wf-block wf-checkbox";
        el.innerHTML = '<span class="wf-box"></span><span>' + (spec.label || "Case à cocher") + "</span>";
        break;
      }
      case "form-field": {
        el = document.createElement("div");
        el.className = "wf-block wf-form-field";
        var lab = document.createElement("span");
        lab.className = "wf-text-label";
        lab.textContent = spec.label || "Champ";
        var input = document.createElement("div");
        input.className = "wf-input";
        el.appendChild(lab);
        el.appendChild(input);
        break;
      }
      default: {
        el = document.createElement("div");
        el.className = "wf-block";
        el.textContent = spec.label || spec.type;
      }
    }
    return el;
  }

  function renderBlock(spec) {
    if (CONTAINER_TYPES.indexOf(spec.type) === -1) {
      var leaf = renderLeaf(spec);
      makeClickable(leaf, spec);
      return leaf;
    }

    var el = document.createElement(spec.type === "nav" ? "nav" : spec.type === "footer" ? "footer" : spec.type === "header" ? "header" : "div");
    el.className = "wf-block wf-" + spec.type;
    applyLayoutProps(el, spec);

    var kids = spec.children;
    if (spec.type === "grid") {
      el.setAttribute("data-cols", String(spec.columns || 3));
      if (spec.repeat && spec.item) {
        kids = [];
        for (var i = 0; i < spec.repeat; i++) kids.push(spec.item);
      }
    }
    (kids || []).forEach(function (child) {
      el.appendChild(renderBlock(child));
    });

    makeClickable(el, spec);
    return el;
  }

  function currentScreenId() {
    var hash = decodeURIComponent(location.hash.replace(/^#/, ""));
    if (hash && window.SCREENS[hash]) return hash;
    return window.START_SCREEN || Object.keys(window.SCREENS)[0];
  }

  function navigate(id) {
    if (!window.SCREENS[id]) {
      console.warn("Écran inconnu :", id);
      return;
    }
    location.hash = id;
  }

  function render() {
    var id = currentScreenId();
    var screen = window.SCREENS[id];
    var stage = document.getElementById("wf-canvas");
    stage.innerHTML = "";
    var section = document.createElement("div");
    section.className = "wf-section-pad";
    (screen.blocks || []).forEach(function (b) { section.appendChild(renderBlock(b)); });
    stage.appendChild(section);

    document.getElementById("wf-breadcrumb").innerHTML =
      "Écran : <b>" + screen.name + "</b>" + (screen.route ? ' <span style="opacity:.6">(' + screen.route + ")</span>" : "");
    var picker = document.getElementById("wf-picker");
    if (picker.value !== id) picker.value = id;
  }

  function buildPicker() {
    var picker = document.getElementById("wf-picker");
    Object.keys(window.SCREENS).forEach(function (id) {
      var opt = document.createElement("option");
      opt.value = id;
      opt.textContent = window.SCREENS[id].name + " (" + id + ")";
      picker.appendChild(opt);
    });
    picker.addEventListener("change", function () { navigate(picker.value); });
  }

  function buildDeviceToggle() {
    var frame = document.getElementById("wf-frame");
    var buttons = document.querySelectorAll("[data-device-btn]");
    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var device = btn.getAttribute("data-device-btn");
        if (device === "desktop") frame.removeAttribute("data-device");
        else frame.setAttribute("data-device", device);
        buttons.forEach(function (b) { b.setAttribute("aria-pressed", b === btn ? "true" : "false"); });
      });
    });
  }

  function buildBackButton() {
    document.getElementById("wf-back").addEventListener("click", function () {
      history.back();
    });
  }

  window.addEventListener("hashchange", render);
  window.addEventListener("DOMContentLoaded", function () {
    buildPicker();
    buildDeviceToggle();
    buildBackButton();
    render();
  });
})();
