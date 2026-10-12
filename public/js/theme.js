// Runs before first paint so there is no flash of the wrong theme. Dark is the default.
(function () {
  var theme = "dark";
  try {
    theme = localStorage.getItem("sprout-theme") || "dark";
  } catch (e) {}
  document.documentElement.setAttribute("data-theme", theme === "light" ? "light" : "dark");
})();
