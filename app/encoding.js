// Gzip and base64, shared by the GitHub sync (a gzipped file, base64 in the API) and the
// move from the old address (a gzipped backup written as base64url in a link).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ZetaproEncoding = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Text to gzip bytes. */
  async function gzip(text) {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** Gzip bytes back to text. */
  async function gunzip(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }

  /** Bytes to base64, in chunks so a large array doesn't overflow the call stack. */
  function toBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  /** Base64 (whitespace allowed) to bytes. */
  function fromBase64(b64) {
    const s = atob(b64.replace(/\s/g, ''));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  /** Bytes as base64url with no padding, safe to put after a # in a link. */
  const toBase64Url = (bytes) => toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  /** Base64url, with or without padding, back to bytes. */
  function fromBase64Url(text) {
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
    return fromBase64(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  }

  return { gzip, gunzip, toBase64, fromBase64, toBase64Url, fromBase64Url };
});
