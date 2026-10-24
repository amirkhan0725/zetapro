// Highlights the option that fits the visitor's device.
(function () {
  const ua = navigator.userAgent;
  const phone = /iPhone|iPad|Android/i.test(ua);
  const windows = /Windows NT/i.test(ua) && !phone;
  const pick = phone ? 'way-phone' : windows ? 'way-windows' : 'way-browser';
  const el = document.getElementById(pick);
  if (el) el.classList.add('suggested');
  // The Windows download is pointless on a phone; keep the hero to one button there.
  if (phone) document.getElementById('dlTop').hidden = true;
})();
