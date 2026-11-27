/*
 * zhihu_web - MD5 (RFC 1321)
 * Why hand-rolled: WebCrypto has no MD5 and the Zhihu x-zse-96 signature needs
 * it. Pure JavaScript keeps the signing logic in the portable web layer, so the
 * same file works on Windows, Android and Linux hosts without native help.
 */
(function (global) {
  'use strict';

  var SHIFT = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];

  var K = new Int32Array(64);
  for (var i = 0; i < 64; i += 1) {
    K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
  }

  var encoder = new TextEncoder();

  function wordsToHex(words) {
    var hex = '';
    for (var w = 0; w < words.length; w += 1) {
      var word = words[w];
      for (var b = 0; b < 4; b += 1) {
        var byte = (word >>> (b * 8)) & 0xff;
        hex += (byte < 16 ? '0' : '') + byte.toString(16);
      }
    }
    return hex;
  }

  function md5Words(bytes) {
    var length = bytes.length;
    var paddedLength = ((length + 8) >> 6) * 64 + 64;
    var buffer = new Uint8Array(paddedLength);
    buffer.set(bytes);
    buffer[length] = 0x80;

    var view = new DataView(buffer.buffer);
    var bitLength = length * 8;
    view.setUint32(paddedLength - 8, bitLength >>> 0, true);
    view.setUint32(paddedLength - 4, Math.floor(bitLength / 4294967296), true);

    var a0 = 0x67452301 | 0;
    var b0 = 0xefcdab89 | 0;
    var c0 = 0x98badcfe | 0;
    var d0 = 0x10325476 | 0;
    var block = new Int32Array(16);

    for (var offset = 0; offset < paddedLength; offset += 64) {
      for (var i = 0; i < 16; i += 1) {
        block[i] = view.getInt32(offset + i * 4, true);
      }
      var a = a0;
      var b = b0;
      var c = c0;
      var d = d0;
      for (var k = 0; k < 64; k += 1) {
        var f;
        var g;
        if (k < 16) {
          f = (b & c) | (~b & d);
          g = k;
        } else if (k < 32) {
          f = (d & b) | (~d & c);
          g = (5 * k + 1) % 16;
        } else if (k < 48) {
          f = b ^ c ^ d;
          g = (3 * k + 5) % 16;
        } else {
          f = c ^ (b | ~d);
          g = (7 * k) % 16;
        }
        var sum = (a + f + K[k] + block[g]) | 0;
        var shift = SHIFT[k];
        var temp = d;
        d = c;
        c = b;
        b = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0;
        a = temp;
      }
      a0 = (a0 + a) | 0;
      b0 = (b0 + b) | 0;
      c0 = (c0 + c) | 0;
      d0 = (d0 + d) | 0;
    }
    return [a0, b0, c0, d0];
  }

  global.ZW = global.ZW || {};
  global.ZW.md5Hex = function (text) {
    return wordsToHex(md5Words(encoder.encode(String(text))));
  };
})(window);
