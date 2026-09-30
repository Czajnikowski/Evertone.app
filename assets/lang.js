// Language: a Polish page, the site's root, goes to the same page in the language picked earlier from the
// menu, or before any pick, in the browser's language when the site has it. Pages in other languages never
// redirect, so a link to one always opens it. Loaded in <head>, so the redirect happens before the page draws.

(() => {
  const script = document.currentScript;
  const root = script.dataset.root;
  const current = script.dataset.lang;
  const page = script.dataset.page === "index.html" ? "" : script.dataset.page;
  const key = "evertone-lang";
  // Folder of each language; Polish is the root.
  const folders = {
    pl: "", en: "en", de: "de", fr: "fr", es: "es", it: "it", "pt-BR": "pt-br", nl: "nl", ru: "ru",
    uk: "uk", tr: "tr", ja: "ja", ko: "ko", "zh-Hans": "zh-hans", "zh-Hant": "zh-hant", ar: "ar", he: "he",
  };

  function match(tag) {
    const t = tag.toLowerCase();
    if (t.startsWith("zh")) {
      return /hant|-tw|-hk|-mo/.test(t) ? "zh-Hant" : "zh-Hans";
    }
    if (t.startsWith("pt")) return "pt-BR";
    const base = t.split("-")[0];
    if (base === "iw") return "he";
    return Object.keys(folders).find((code) => code.toLowerCase() === base) || null;
  }

  function saved() {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function go(code) {
    const folder = folders[code];
    location.replace(root + (folder ? folder + "/" : "") + page + location.hash);
  }

  if (current === "pl" && !/bot|crawl|spider|slurp|preview/i.test(navigator.userAgent)) {
    const choice = saved();
    const target = choice in folders
      ? choice
      : (navigator.languages || [navigator.language || ""]).map(match).find(Boolean);
    if (target && target !== "pl") go(target);
  }

  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[data-lang]");
    if (link) {
      try {
        localStorage.setItem(key, link.dataset.lang);
      } catch {}
    }
    // The menu closes on a click anywhere else.
    for (const menu of document.querySelectorAll(".lang-menu[open]")) {
      if (!menu.contains(event.target)) menu.removeAttribute("open");
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const menu = document.querySelector(".lang-menu[open]");
    if (!menu) return;
    menu.removeAttribute("open");
    menu.querySelector("summary").focus();
  });
})();
