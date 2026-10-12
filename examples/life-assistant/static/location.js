(function () {
  'use strict';

  const defaults = {
    container: '#nearby',
    requestOnPrompt: true,
    autoLocate: true,
    maxShops: 3,
    isConnected: () => false
  };
  let options = { ...defaults };
  let coords = null;
  let shops = [];
  let status = 'idle';
  let message = '定位后为你找到附近门店。';
  let locationTask = null;
  let shopTask = null;
  let shopController = null;
  let locationVersion = 0;
  let shopVersion = 0;
  let initVersion = 0;
  let initialized = false;

  const copyCoords = () => coords ? { ...coords } : null;
  const connected = () => {
    try { return Boolean(options.isConnected()); } catch (_) { return false; }
  };
  const makeError = (code, text, source) => Object.assign(new Error(text), { code, source });
  function notify(name, ...args) {
    if (typeof options[name] !== 'function') return;
    try { options[name](...args); } catch (_) { /* A host callback must not break location state. */ }
  }
  function container() {
    return typeof options.container === 'string'
      ? document.querySelector(options.container)
      : options.container;
  }
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function numericDistance(shop) {
    const value = shop.distance;
    if (typeof value !== 'number' && typeof value !== 'string') return Infinity;
    if (typeof value === 'string' && !value.trim()) return Infinity;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : Infinity;
  }
  function distanceLabel(shop) {
    const distance = numericDistance(shop);
    if (!Number.isFinite(distance)) return '';
    return distance < 1
      ? '约' + Math.round(distance * 1000) + '米'
      : '约' + distance.toFixed(1).replace(/\.0$/, '') + '公里';
  }
  function render() {
    const root = container();
    if (!root) return;
    const header = element('div', undefined, 'nearby-header');
    header.append(element('h3', '附近瑞幸'));
    const retry = element('button', '重新定位', 'nearby-retry');
    retry.type = 'button';
    retry.disabled = status === 'locating';
    retry.addEventListener('click', () => { relocate(); });
    header.append(retry);
    const info = element('p', message, 'nearby-status');
    info.setAttribute('role', status === 'error' ? 'alert' : 'status');
    info.setAttribute('aria-live', 'polite');
    const list = element('div', undefined, 'nearby-shops');
    const limit = Math.max(1, Math.min(10, Number(options.maxShops) || 3));
    shops.slice(0, limit).forEach((shop, index) => {
      const row = element('div', undefined, 'nearby-shop');
      const detail = element('div', undefined, 'nearby-shop-detail');
      if (index === 0 && Number.isFinite(numericDistance(shop))) {
        detail.append(element('small', '离你最近', 'nearby-nearest'));
      }
      detail.append(element('strong', String(shop.deptName || shop.shopName || shop.name || '瑞幸门店')));
      const address = shop.address || shop.deptAddress || shop.shopAddress;
      if (address) detail.append(element('p', String(address)));
      const distance = distanceLabel(shop);
      if (distance) detail.append(element('small', distance));
      const select = element('button', '选这家店', 'nearby-select');
      select.type = 'button';
      select.disabled = !connected() || typeof options.onSelect !== 'function';
      select.addEventListener('click', () => {
        if (!connected() || !coords) {
          fail(makeError('not_connected', '连接瑞幸后为你找到附近门店。', 'shops'));
          return;
        }
        notify('onSelect', { ...shop }, copyCoords());
      });
      row.append(detail, select);
      list.append(row);
    });
    root.replaceChildren(header, info, list);
  }
  function setStatus(next, text) {
    status = next;
    message = text;
    render();
  }
  function fail(error) {
    shops = [];
    setStatus('error', error.message);
    notify('onError', error);
    return null;
  }
  function cancelShops() {
    shopVersion += 1;
    if (shopController) shopController.abort();
    shopController = null;
    shopTask = null;
  }
  function locationError(error) {
    if (error && error.code === 1) {
      return makeError('permission_denied', '定位失败，可重新定位或选择门店。', 'location');
    }
    if (error && error.code === 3) {
      return makeError('location_timeout', '定位失败，可重新定位或选择门店。', 'location');
    }
    return makeError('position_unavailable', '定位失败，可重新定位或选择门店。', 'location');
  }

  function relocate() {
    if (locationTask) return locationTask;
    if (!navigator.geolocation) {
      return Promise.resolve(fail(makeError('unsupported', '定位失败，可重新定位或选择门店。', 'location')));
    }
    const version = ++locationVersion;
    cancelShops();
    coords = null;
    shops = [];
    setStatus('locating', '正在定位…');
    const task = new Promise((resolve, reject) => {
      try {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 15000,
          maximumAge: 60000
        });
      } catch (error) { reject(error); }
    }).then(async position => {
      if (version !== locationVersion) return null;
      const longitude = position && position.coords && position.coords.longitude;
      const latitude = position && position.coords && position.coords.latitude;
      if (typeof longitude !== 'number' || !Number.isFinite(longitude) || Math.abs(longitude) > 180 ||
          typeof latitude !== 'number' || !Number.isFinite(latitude) || Math.abs(latitude) > 90) {
        return fail(makeError('invalid_coordinates', '定位失败，可重新定位或选择门店。', 'location'));
      }
      // The official nearby-shop coordinates use GCJ; browser locations use WGS84.
      // Do not recommend shops from a mismatched coordinate system.
      if (typeof window.toLuckinCoordinates !== 'function') {
        return fail(makeError('coordinate_conversion_unavailable', '定位失败，可重新定位或选择门店。', 'location'));
      }
      let converted;
      try { converted = window.toLuckinCoordinates({ longitude, latitude }); } catch (_) {
        return fail(makeError('coordinate_conversion_failed', '定位失败，可重新定位或选择门店。', 'location'));
      }
      if (!converted || typeof converted.longitude !== 'number' || !Number.isFinite(converted.longitude) ||
          Math.abs(converted.longitude) > 180 || typeof converted.latitude !== 'number' ||
          !Number.isFinite(converted.latitude) || Math.abs(converted.latitude) > 90) {
        return fail(makeError('invalid_converted_coordinates', '定位失败，可重新定位或选择门店。', 'location'));
      }
      coords = { longitude: converted.longitude, latitude: converted.latitude };
      notify('onLocation', copyCoords());
      if (!connected()) {
        setStatus('waiting_connection', '连接瑞幸后为你找到附近门店。');
        return copyCoords();
      }
      await refreshShops();
      return copyCoords();
    }).catch(error => version === locationVersion ? fail(locationError(error)) : null)
      .finally(() => { if (locationTask === task) locationTask = null; });
    locationTask = task;
    return task;
  }

  function unpack(result) {
    if (!result || typeof result !== 'object') {
      throw makeError('invalid_response', '附近门店查询失败，可重新定位或选择门店。', 'shops');
    }
    if (result.isError) {
      throw makeError('tool_error', '附近门店查询失败，可重新定位或选择门店。', 'shops');
    }
    let value = result.structuredContent;
    if (value === null || value === undefined) {
      for (const item of result.content || []) {
        if (item.type !== 'text') continue;
        try { value = JSON.parse(item.text); break; } catch (_) { /* Other text blocks may be explanatory. */ }
      }
    }
    if (value === null || value === undefined) value = result;
    if (value && (value.success === false || value.error ||
        (value.code !== undefined && ![0, 200, '0', '200'].includes(value.code)))) {
      throw makeError('business_error', '附近门店查询失败，可重新定位或选择门店。', 'shops');
    }
    return value && value.data !== undefined ? value.data : value;
  }
  function shopList(value, depth = 0) {
    if (Array.isArray(value)) {
      return value.every(item => item && typeof item === 'object' && !Array.isArray(item)) ? value : null;
    }
    if (value && typeof value === 'object' && depth < 5) {
      for (const key of ['shopList', 'list', 'shops', 'deptList', 'storeList', 'rows', 'records', 'data']) {
        if (value[key] !== undefined) {
          const result = shopList(value[key], depth + 1);
          if (result !== null) return result;
        }
      }
    }
    return null;
  }

  function refreshShops() {
    if (!coords) {
      if (locationTask) return locationTask;
      setStatus('idle', '定位后为你找到附近门店。');
      return Promise.resolve(null);
    }
    if (!connected()) {
      cancelShops();
      shops = [];
      setStatus('waiting_connection', '连接瑞幸后为你找到附近门店。');
      return Promise.resolve(null);
    }
    if (shopTask) return shopTask;
    const requestCoords = copyCoords();
    const version = ++shopVersion;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    shopController = controller;
    let timedOut = false;
    const timer = controller ? setTimeout(() => { timedOut = true; controller.abort(); }, 25000) : null;
    shops = [];
    setStatus('loading_shops', '正在为你查找附近门店…');
    const task = (async () => {
      const response = await fetch('/api/tool', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'queryShopList', arguments: requestCoords }),
        ...(controller ? { signal: controller.signal } : {})
      });
      const body = await response.json();
      if (!response.ok || body.ok === false) {
        throw makeError(body.error && body.error.code || 'request_failed', '附近门店查询失败，可重新定位或选择门店。', 'shops');
      }
      const list = shopList(unpack(body.result));
      if (list === null) {
        throw makeError('invalid_shop_list', '附近门店查询失败，可重新定位或选择门店。', 'shops');
      }
      if (version !== shopVersion) return null;
      if (!connected()) {
        shops = [];
        setStatus('waiting_connection', '连接瑞幸后为你找到附近门店。');
        return null;
      }
      shops = list.map(shop => ({ ...shop })).sort((a, b) => numericDistance(a) - numericDistance(b));
      setStatus(shops.length ? 'ready' : 'empty', shops.length
        ? '为你找到附近瑞幸门店。'
        : '暂时没找到附近门店，可重新定位或选择门店。');
      notify('onShops', shops.map(shop => ({ ...shop })), copyCoords());
      return shops.map(shop => ({ ...shop }));
    })().catch(error => {
      if (version !== shopVersion) return null;
      if (timedOut) return fail(makeError('shop_timeout', '附近门店查询失败，可重新定位或选择门店。', 'shops'));
      return fail(error.source ? error : makeError('network_error', '附近门店查询失败，可重新定位或选择门店。', 'shops'));
    }).finally(() => {
      if (timer !== null) clearTimeout(timer);
      if (shopTask === task) { shopTask = null; shopController = null; }
    });
    shopTask = task;
    return task;
  }

  async function init(settings = {}) {
    options = { ...options, ...settings };
    render();
    if (initialized) {
      if (coords) await refreshShops();
      return getState();
    }
    initialized = true;
    const version = ++initVersion;
    if (!options.autoLocate) return getState();
    let permission = 'prompt';
    if (navigator.permissions && typeof navigator.permissions.query === 'function') {
      try { permission = (await navigator.permissions.query({ name: 'geolocation' })).state; } catch (_) { /* Use the browser prompt when permission inspection is unsupported. */ }
    }
    if (version !== initVersion) return getState();
    if (permission === 'denied') {
      fail(locationError({ code: 1 }));
    } else if (permission === 'granted' || options.requestOnPrompt) {
      await relocate();
    } else {
      setStatus('idle', '点击「重新定位」，为你找到附近门店。');
    }
    return getState();
  }
  function getState() {
    return { status, message, coords: copyCoords(), shops: shops.map(shop => ({ ...shop })) };
  }
  function clear() {
    initVersion += 1;
    locationVersion += 1;
    cancelShops();
    locationTask = null;
    coords = null;
    shops = [];
    initialized = false;
    setStatus('idle', '位置已清除，可重新定位或选择门店。');
  }

  // Precise location lives only in this page session; no browser storage is used.
  window.OneLocation = { init, refreshShops, relocate, getState, clear };
})();
