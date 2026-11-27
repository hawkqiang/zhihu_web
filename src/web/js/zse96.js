/*
 * zhihu_web - Zhihu x-zse-96 request signature.
 *
 * Ported from zhi-purity via huamurui/zhihu-minus-minus
 * (src/api/zse96/zse_purity.ts, GPL-3.0). The mobile client needed this to get
 * past Zhihu's request signing; the desktop web reader needs exactly the same
 * thing, so the algorithm lives here as plain JavaScript.
 *
 * source = "101_3_3.0" + "+" + path + "+" + d_c0
 * signature = "2.0_" + customEncode(SM4-CBC(MD5(source)))
 */
(function (global) {
  'use strict';

  var ZK = [
    1170614578, 1024848638, 1413669199, -343334464, -766094290, -1373058082,
    -143119608, -297228157, 1933479194, -971186181, -406453910, 460404854,
    -547427574, -1891326262, -1679095901, 2119585428, -2029270069, 2035090028,
    -1521520070, -5587175, -77751101, -2094365853, -1243052806, 1579901135,
    1321810770, 456816404, -1391643889, -229302305, 330002838, -788960546,
    363569021, -1947871109
  ];

  var ZB = [
    20, 223, 245, 7, 248, 2, 194, 209, 87, 6, 227, 253, 240, 128, 222, 91, 237, 9,
    125, 157, 230, 93, 252, 205, 90, 79, 144, 199, 159, 197, 186, 167, 39, 37,
    156, 198, 38, 42, 43, 168, 217, 153, 15, 103, 80, 189, 71, 191, 97, 84, 247,
    95, 36, 69, 14, 35, 12, 171, 28, 114, 178, 148, 86, 182, 32, 83, 158, 109, 22,
    255, 94, 238, 151, 85, 77, 124, 254, 18, 4, 26, 123, 176, 232, 193, 131, 172,
    143, 142, 150, 30, 10, 146, 162, 62, 224, 218, 196, 229, 1, 192, 213, 27, 110,
    56, 231, 180, 138, 107, 242, 187, 54, 120, 19, 44, 117, 228, 215, 203, 53,
    239, 251, 127, 81, 11, 133, 96, 204, 132, 41, 115, 73, 55, 249, 147, 102, 48,
    122, 145, 106, 118, 74, 190, 29, 16, 174, 5, 177, 129, 63, 113, 99, 31, 161,
    76, 246, 34, 211, 13, 60, 68, 207, 160, 65, 111, 82, 165, 67, 169, 225, 57,
    112, 244, 155, 51, 236, 200, 233, 58, 61, 47, 100, 137, 185, 64, 17, 70, 234,
    163, 219, 108, 170, 166, 59, 149, 52, 105, 24, 212, 78, 173, 45, 0, 116, 226,
    119, 136, 206, 135, 175, 195, 25, 92, 121, 208, 126, 139, 3, 75, 141, 21, 130,
    98, 241, 40, 154, 66, 184, 49, 181, 46, 243, 88, 101, 183, 8, 23, 72, 188,
    104, 179, 210, 134, 250, 201, 164, 89, 216, 202, 220, 50, 221, 152, 140, 33,
    235, 214
  ];

  var ALPHABET = '6fpLRqJO8M/c3jnYxFkUVC4ZIG12SiH=5v0mXDazWBTsuw7QetbKdoPyAl+hN9rgE';

  var KEY16 = new Uint8Array([
    0x30, 0x35, 0x39, 0x30, 0x35, 0x33, 0x66, 0x37,
    0x64, 0x31, 0x35, 0x65, 0x30, 0x31, 0x64, 0x37
  ]);

  var ZSE_VERSION = '101_3_3.0';

  function rotl(value, bits) {
    return (value << bits) | (value >>> (32 - bits));
  }

  function substitute(value) {
    var rotated =
      ((ZB[(value >>> 24) & 0xff] << 24) |
        (ZB[(value >>> 16) & 0xff] << 16) |
        (ZB[(value >>> 8) & 0xff] << 8) |
        ZB[value & 0xff]) >>> 0;
    return (rotated ^ rotl(rotated, 2) ^ rotl(rotated, 10) ^ rotl(rotated, 18) ^ rotl(rotated, 24)) >>> 0;
  }

  function encryptBlock(bytes) {
    var state = new Int32Array(36);
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    state[0] = view.getInt32(0);
    state[1] = view.getInt32(4);
    state[2] = view.getInt32(8);
    state[3] = view.getInt32(12);
    for (var i = 0; i < 32; i += 1) {
      state[i + 4] = (state[i] ^ substitute(state[i + 1] ^ state[i + 2] ^ state[i + 3] ^ ZK[i])) >>> 0;
    }
    var out = new Uint8Array(16);
    var outView = new DataView(out.buffer);
    for (var j = 0; j < 4; j += 1) {
      outView.setInt32(j * 4, state[35 - j]);
    }
    return out;
  }

  function customEncode(bytes) {
    var paddedLength = Math.ceil(bytes.length / 3) * 3;
    var data = new Uint8Array(paddedLength);
    data.set(bytes);

    var out = '';
    var counter = 0;
    for (var p = data.length - 1; p >= 0; p -= 3) {
      var value = 0;
      var m0 = (58 >> (8 * (counter % 4))) & 0xff;
      counter += 1;
      value |= (data[p] ^ m0) & 0xff;
      var m1 = (58 >> (8 * (counter % 4))) & 0xff;
      counter += 1;
      value |= ((data[p - 1] ^ m1) & 0xff) << 8;
      var m2 = (58 >> (8 * (counter % 4))) & 0xff;
      counter += 1;
      value |= ((data[p - 2] ^ m2) & 0xff) << 16;

      out += ALPHABET[value & 63];
      out += ALPHABET[(value >> 6) & 63];
      out += ALPHABET[(value >> 12) & 63];
      out += ALPHABET[(value >> 18) & 63];
    }
    return out;
  }

  /** SM4-CBC with the fixed IV construction Zhihu uses (KEY16 XOR 0x2A). */
  function sm4Cbc(plain) {
    var pad = 16 - (plain.length % 16);
    var padded = new Uint8Array(plain.length + pad);
    padded.set(plain);
    padded.fill(pad, plain.length);

    var cipher = new Uint8Array(padded.length);
    var firstBlock = new Uint8Array(16);
    for (var i = 0; i < 16; i += 1) {
      firstBlock[i] = padded[i] ^ KEY16[i] ^ 42;
    }

    var previous = encryptBlock(firstBlock);
    cipher.set(previous, 0);
    for (var offset = 16; offset < padded.length; offset += 16) {
      var block = new Uint8Array(16);
      for (var j = 0; j < 16; j += 1) {
        block[j] = padded[offset + j] ^ previous[j];
      }
      previous = encryptBlock(block);
      cipher.set(previous, offset);
    }
    return cipher;
  }

  /**
   * @param {string} path  request path including query, e.g. "/api/v4/me?x=1"
   * @param {string} dc0   value of the d_c0 cookie
   * @param {string} [xZst81] optional x-zst-81 header value
   * @returns {string} signature for the x-zse-96 header
   */
  function sign96(path, dc0, xZst81) {
    var parts = [ZSE_VERSION, path, dc0 || ''];
    if (xZst81) {
      parts.push(xZst81);
    }
    var digest = global.ZW.md5Hex(parts.join('+'));
    var encoded = encodeURIComponent(digest);
    var plain = new Uint8Array(2 + encoded.length);
    plain[0] = 12;
    plain[1] = 0x00;
    for (var i = 0; i < encoded.length; i += 1) {
      plain[2 + i] = encoded.charCodeAt(i);
    }
    return '2.0_' + customEncode(sm4Cbc(plain));
  }

  global.ZW = global.ZW || {};
  global.ZW.ZSE_VERSION = ZSE_VERSION;
  global.ZW.sign96 = sign96;
})(window);
