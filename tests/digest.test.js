"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { sha256Hex, canonical, digestOf } = require("../src/core/digest.js");

test("sha256 标准向量", () => {
  assert.equal(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(
    sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
  );
});

test("sha256 支持中文与长文本", () => {
  const a = sha256Hex("潜次证据封存台");
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, sha256Hex("潜次证据封存台"));
  assert.notEqual(a, sha256Hex("潜次证据封存台 "));
  const long = "沉船".repeat(100000);
  assert.match(sha256Hex(long), /^[0-9a-f]{64}$/);
});

test("canonical 与键序无关", () => {
  const a = { x: 1, y: [1, 2, { b: 2, a: 1 }], z: "潜" };
  const b = { z: "潜", y: [1, 2, { a: 1, b: 2 }], x: 1 };
  assert.equal(canonical(a), canonical(b));
  assert.equal(digestOf(a), digestOf(b));
});

test("canonical 数组保序、区分类型", () => {
  assert.notEqual(canonical([1, 2]), canonical([2, 1]));
  assert.notEqual(canonical("1"), canonical(1));
  assert.notEqual(canonical(null), canonical("null"));
});
