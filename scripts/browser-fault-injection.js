/* Browser DevTools Snippet. Not imported by the application. See docs/testing/FAULT-INJECTION.md. */
(() => {
  'use strict';
  window.ecFault?.restore();
  const originalFetch = window.fetch.bind(window);
  const rules = [];
  const pending = new Set();
  const history = [];
  const modes = ['http', 'network', 'timeout', 'body-timeout', 'invalid-json', 'json', 'patch', 'delay', 'after-network', 'after-timeout'];
  let active = true;

  const aborted = () => new DOMException('故障模拟已结束或请求已取消', 'AbortError');
  function wait(signal, ms) {
    return new Promise((resolve, reject) => {
      let timer;
      const clean = () => { clearTimeout(timer); pending.delete(cancel); signal?.removeEventListener('abort', cancel); };
      const cancel = () => { clean(); reject(signal?.reason || aborted()); };
      pending.add(cancel);
      if (signal?.aborted) { cancel(); return; }
      signal?.addEventListener('abort', cancel, { once: true });
      if (ms !== undefined) timer = setTimeout(() => { clean(); resolve(); }, ms);
      else timer = setTimeout(cancel, 45_000); // Project API deadline normally aborts at 30 seconds.
    });
  }
  function jsonResponse(data, status = 200, headers) {
    const resultHeaders = new Headers(headers);
    resultHeaders.delete('content-length');
    resultHeaders.delete('content-encoding');
    resultHeaders.set('content-type', 'application/json; charset=utf-8');
    return new Response(JSON.stringify(data), { status, headers: resultHeaders });
  }

  window.fetch = async (input, init) => {
    const requestUrl = new URL(input instanceof Request ? input.url : String(input), location.href);
    const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const path = requestUrl.pathname + requestUrl.search;
    if (requestUrl.origin !== location.origin || !requestUrl.pathname.startsWith('/api/')) return originalFetch(input, init);
    const rule = rules.find(item => {
      if (item.method !== method) return false;
      if (item.url instanceof RegExp) { item.url.lastIndex = 0; return item.url.test(path); }
      if (item.url.startsWith('/')) return item.url.includes('?') ? path === item.url : requestUrl.pathname === item.url;
      return path.includes(item.url);
    });
    if (!rule) return originalFetch(input, init);
    const signal = init?.signal || (input instanceof Request ? input.signal : undefined);
    const entry = { method, path, mode: rule.mode, forwarded: false };
    history.push(entry);
    if (history.length > 100) history.shift();
    console.info('[ecFault]', method, path, rule.mode);
    if (rule.mode === 'network') throw new TypeError('模拟连接中断；匹配请求未发送到后端');
    if (rule.mode === 'timeout') return wait(signal);
    if (rule.mode === 'body-timeout') {
      return new Response(new ReadableStream({ start(controller) { wait(signal).catch(error => controller.error(error)); } }), { headers: { 'content-type': 'application/json' } });
    }
    if (rule.mode === 'http') {
      if (rule.ms) await wait(signal, rule.ms);
      return jsonResponse(rule.body ?? {}, rule.status ?? 500);
    }
    if (rule.mode === 'invalid-json') return new Response('故障注入：这不是JSON', { status: 200, headers: { 'content-type': 'application/json' } });
    if (rule.mode === 'json') return jsonResponse(rule.body ?? {});
    if (rule.mode === 'delay') await wait(signal, rule.ms ?? 35_000);
    if (signal?.aborted || !active) throw signal?.reason || aborted();
    entry.forwarded = true;
    const response = await originalFetch(input, init);
    if (!response.ok) return response;
    if (rule.mode === 'patch') return jsonResponse(await rule.edit(await response.json()), response.status, response.headers);
    if (rule.mode === 'after-network' || rule.mode === 'after-timeout') {
      await response.clone().text();
      if (rule.mode === 'after-network') throw new TypeError('模拟已成功响应丢失；后端操作已实际执行');
      return wait(signal);
    }
    return response;
  };

  window.ecFault = {
    add(config) {
      if (!active) throw new Error('脚本已撤销，请重新运行Snippet安装。');
      const rule = { method: 'GET', mode: 'http', ...config };
      rule.method = rule.method.toUpperCase();
      if (!(rule.url instanceof RegExp) && (typeof rule.url !== 'string' || !rule.url)) throw new Error('必须提供具体接口url片段或正则，不要拦截全部/api/。');
      if (!modes.includes(rule.mode)) throw new Error(`未知模式：${rule.mode}`);
      if (rule.mode === 'patch' && (rule.method !== 'GET' || typeof rule.edit !== 'function')) throw new Error('patch仅用于GET，且必须提供edit函数。');
      if ((rule.mode.startsWith('after-') || rule.mode === 'delay' && rule.method !== 'GET') && rule.forward !== true) throw new Error('此模式会真实请求后端；确认使用测试数据后显式设置forward:true。');
      if (rule.status !== undefined && (!Number.isInteger(rule.status) || rule.status < 400 || rule.status > 599)) throw new Error('http故障状态仅支持400到599。');
      rules.push(rule);
      console.info('[ecFault] 已添加持续规则；手动clear前始终生效。');
    },
    clear() { rules.length = 0; console.info('[ecFault] 规则已清空；在途模拟请求等待期限或restore取消。'); },
    status() { return rules.map(({ url, method, mode, status }) => ({ url: String(url), method, mode, status })); },
    history() { return history.map(item => ({ ...item })); },
    restore() {
      rules.length = 0;
      for (const cancel of [...pending]) cancel();
      if (active) window.fetch = originalFetch;
      active = false;
      console.info('[ecFault] 已恢复fetch；未刷新页面、未清理草稿和业务恢复状态。');
    },
  };
  console.info('[ecFault] 已安装，无默认规则。ecFault.add({...})添加，clear()清空，restore()撤销。仅限当前标签页。');
})();
