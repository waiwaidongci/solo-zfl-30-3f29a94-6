/*
 * storage.js — 存储适配器：浏览器 localStorage 与内存实现（测试用）。
 * 核心层只面向 {getItem, setItem, removeItem} 接口编程。
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else { root.DiveCore = root.DiveCore || {}; root.DiveCore.storage = factory(); }
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  function createMemoryStorage(initial) {
    const map = new Map(Object.entries(initial || {}));
    return {
      getItem: k => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => { map.set(k, String(v)); },
      removeItem: k => { map.delete(k); },
      _dump: () => Object.fromEntries(map)
    };
  }

  function createBrowserStorage() {
    if (typeof localStorage === "undefined") {
      throw new Error("当前环境没有 localStorage，无法持久化");
    }
    return {
      getItem: k => localStorage.getItem(k),
      setItem: (k, v) => localStorage.setItem(k, v),
      removeItem: k => localStorage.removeItem(k)
    };
  }

  return { createMemoryStorage, createBrowserStorage };
});
