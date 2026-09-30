// Light or dark: follows the system until the visitor picks one with the header's toggle, which steps
// through system, light and dark. Loaded in <head>, before the page draws, so a saved choice doesn't flash.

(() => {
  const root = document.documentElement;
  const key = "evertone-theme";
  const choices = ["system", "light", "dark"];

  function saved() {
    try {
      const choice = localStorage.getItem(key);
      return choices.includes(choice) ? choice : "system";
    } catch {
      return "system";
    }
  }

  function apply(choice) {
    if (choice === "system") delete root.dataset.theme;
    else root.dataset.theme = choice;
    root.dataset.themeChoice = choice;
  }

  apply(saved());

  document.addEventListener("DOMContentLoaded", () => {
    const button = document.querySelector(".theme-toggle");
    if (!button) return;

    const label = () => {
      const text = button.dataset[root.dataset.themeChoice];
      button.setAttribute("aria-label", text);
      button.title = text;
    };
    label();

    button.addEventListener("click", () => {
      const next = choices[(choices.indexOf(root.dataset.themeChoice) + 1) % choices.length];
      apply(next);
      label();
      try {
        localStorage.setItem(key, next);
      } catch {}
    });
  });
})();
