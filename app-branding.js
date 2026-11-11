/* app-branding.js — v5.24 (close anonymous access, section 6)

   Company name and logo are kept on THIS DEVICE, so the login screen never asks the database for anything.
   Dynamiq is the default; once someone has signed in on this device, the company logo is used instead.

   ORIGIN NOTES (code moved here from app-core.js in v5.24, 2026-11-11):
   - The logged-out branding read in the DOMContentLoaded handler (anonymous fetch of settings) -> replaced by brandingApplyFromDevice().
   - loadCompanyBranding() (read the settings table before sign-in) -> replaced by the version below, which uses only device storage.
   The old bodies are commented out in app-core.js with MOVED markers.

   Device storage keys:
     dwo_company_name       company name (text)
     dwo_company_logo_data  logo as a data URL, scaled to at most 400 px wide
     dwo_company_logo_src   the URL the saved logo was taken from (to know when it changed)
   app-core.js keeps these keys through an app-update reset (see the savedBranding block near the version check). */

var BRANDING_DEFAULT_LOGO = 'brand/dynamiq-lockup.svg';
var BRANDING_DEFAULT_NAME = 'Dynamiq';
var BRANDING_MAX_WIDTH = 400;
var BRANDING_MAX_CHARS = 700000; /* keep browser storage small: skip anything bigger than this */

function brandingStoreGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function brandingStoreSet(key, val) { try { localStorage.setItem(key, val); return true; } catch (e) { return false; } }
function brandingStoreDel(key) { try { localStorage.removeItem(key); } catch (e) {} }

/* Login screen: show the logo saved on this device, else the Dynamiq default. No network request. */
function brandingApplyFromDevice() {
  try {
    var img = document.getElementById('login-brand-logo');
    if (!img) return;
    var data = brandingStoreGet('dwo_company_logo_data');
    var name = brandingStoreGet('dwo_company_name');
    if (data) {
      img.src = data;
      img.alt = name || 'Company logo';
    } else {
      img.src = BRANDING_DEFAULT_LOGO;
      img.alt = BRANDING_DEFAULT_NAME;
    }
  } catch (e) {}
}

/* Same name the old app-core.js function had; now device-only (called from the window load handler). */
function loadCompanyBranding() {
  brandingApplyFromDevice();
  return Promise.resolve();
}

/* Image blob -> data URL, scaled down so it stays small in browser storage. SVG is kept as it is (it scales by itself). */
function brandingBlobToDataUrl(blob) {
  return new Promise(function (resolve, reject) {
    if (blob.type === 'image/svg+xml') {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(new Error('read')); };
      fr.readAsDataURL(blob);
      return;
    }
    var objUrl = URL.createObjectURL(blob);
    var im = new Image();
    im.onload = function () {
      try {
        var w = im.naturalWidth || BRANDING_MAX_WIDTH;
        var h = im.naturalHeight || Math.round(BRANDING_MAX_WIDTH / 3);
        if (w > BRANDING_MAX_WIDTH) { h = Math.round(h * BRANDING_MAX_WIDTH / w); w = BRANDING_MAX_WIDTH; }
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(im, 0, 0, w, h);
        var out = c.toDataURL('image/png');
        URL.revokeObjectURL(objUrl);
        resolve(out);
      } catch (e) { URL.revokeObjectURL(objUrl); reject(e); }
    };
    im.onerror = function () { URL.revokeObjectURL(objUrl); reject(new Error('image')); };
    im.src = objUrl;
  });
}

/* Fetch the logo from its URL once and save it on this device. Any failure leaves the current saved logo (or the default) as it is. */
function brandingRefreshDeviceLogo(url, force) {
  try {
    if (!url) return Promise.resolve();
    if (!force && url === brandingStoreGet('dwo_company_logo_src') && brandingStoreGet('dwo_company_logo_data')) return Promise.resolve();
    var fetchUrl = force ? (url + (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now()) : url;
    return fetch(fetchUrl, force ? { cache: 'reload' } : undefined)
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.blob(); })
      .then(brandingBlobToDataUrl)
      .then(function (dataUrl) {
        if (!dataUrl || dataUrl.length > BRANDING_MAX_CHARS) return;
        if (brandingStoreSet('dwo_company_logo_data', dataUrl)) {
          brandingStoreSet('dwo_company_logo_src', url);
          brandingApplyFromDevice();
        }
      })
      .catch(function () { /* silent: keep what is saved */ });
  } catch (e) { return Promise.resolve(); }
}

/* After sign-in (settings are loaded): save the company name, and the logo if it changed. */
function brandingRefreshAfterLogin(settings, force) {
  try {
    settings = settings || {};
    if (settings.company_name) brandingStoreSet('dwo_company_name', settings.company_name);
    if (settings.company_logo_url === undefined) return Promise.resolve(); /* settings did not load: change nothing */
    if (!settings.company_logo_url) {
      /* the company logo was removed in Settings: go back to the default on this device */
      brandingStoreDel('dwo_company_logo_data');
      brandingStoreDel('dwo_company_logo_src');
      brandingApplyFromDevice();
      return Promise.resolve();
    }
    return brandingRefreshDeviceLogo(settings.company_logo_url, !!force);
  } catch (e) { return Promise.resolve(); }
}

/* The script sits at the end of the page, so the login image already exists: apply right away (no flash of the default). */
brandingApplyFromDevice();
