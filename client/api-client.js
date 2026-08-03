"use strict";

const ApiClient = (() => {
  function baseUrl() {
    return (window.APP_CONFIG && window.APP_CONFIG.apiUrl) || location.origin;
  }

  async function request(method, path, body, opts) {
    const url = baseUrl() + path;
    const headers = { "Content-Type": "application/json" };
    const token = (opts && opts.token) || null;
    if (token) headers["Authorization"] = "Bearer " + token;

    let res;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        credentials: "include",
      });
    } catch (e) {
      throw { status: 0, message: "无法连接服务器", code: "network_error" };
    }

    let data;
    try { data = await res.json(); } catch (_) { data = { message: "服务器响应异常" }; }

    if (!res.ok) {
      throw {
        status: res.status,
        message: data.message || "请求失败",
        code: data.code || "unknown",
      };
    }
    return data;
  }

  return {
    get: (path, opts) => request("GET", path, null, opts),
    post: (path, body, opts) => request("POST", path, body, opts),
    delete: (path, opts) => request("DELETE", path, null, opts),
    baseUrl,
  };
})();

if (typeof module !== "undefined") module.exports = { ApiClient };
if (typeof window !== "undefined") window.ApiClient = ApiClient;
