// app-mobile-ui.js — small mobile/login UI additions (v5.07)
// Show the app version on the login screen so the build under test is obvious.
(function () {
  var el = document.getElementById('login-version');
  if (el && typeof APP_VERSION !== 'undefined') el.textContent = 'v' + APP_VERSION;
})();
