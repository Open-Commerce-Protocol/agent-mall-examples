/*
 * WGS84 -> GCJ-02 for Luckin shop queries.
 * Adapted from Zhejiang University's public map.transform.js:
 * https://map.zju.edu.cn/resource/imap/js/map.transform.js
 * Original copy: references/zju-map.transform.js
 * This keeps the source's rectangular out_of_china guard; it is not a
 * precise administrative boundary. See docs/北教学楼附近门店核查.md.
 */
(function (root) {
  'use strict';

  const pi = Math.PI;
  const ee = 0.00669342162296594323;
  const a = 6378245.0;

  function outOfChina(longitude, latitude) {
    return !(longitude > 73.66 && longitude < 135.05 && latitude > 3.86 && latitude < 53.55);
  }

  function transformLatitude(longitude, latitude) {
    let result = -100.0 + 2.0 * longitude + 3.0 * latitude + 0.2 * latitude * latitude +
      0.1 * longitude * latitude + 0.2 * Math.sqrt(Math.abs(longitude));
    result += (20.0 * Math.sin(6.0 * longitude * pi) + 20.0 * Math.sin(2.0 * longitude * pi)) * 2.0 / 3.0;
    result += (20.0 * Math.sin(latitude * pi) + 40.0 * Math.sin(latitude / 3.0 * pi)) * 2.0 / 3.0;
    result += (160.0 * Math.sin(latitude / 12.0 * pi) + 320 * Math.sin(latitude * pi / 30.0)) * 2.0 / 3.0;
    return result;
  }

  function transformLongitude(longitude, latitude) {
    let result = 300.0 + longitude + 2.0 * latitude + 0.1 * longitude * longitude +
      0.1 * longitude * latitude + 0.1 * Math.sqrt(Math.abs(longitude));
    result += (20.0 * Math.sin(6.0 * longitude * pi) + 20.0 * Math.sin(2.0 * longitude * pi)) * 2.0 / 3.0;
    result += (20.0 * Math.sin(longitude * pi) + 40.0 * Math.sin(longitude / 3.0 * pi)) * 2.0 / 3.0;
    result += (150.0 * Math.sin(longitude / 12.0 * pi) + 300.0 * Math.sin(longitude / 30.0 * pi)) * 2.0 / 3.0;
    return result;
  }

  /**
   * Accept a WGS84 GeolocationCoordinates-like object and return coordinates
   * for a Luckin query. Call once on native browser positions; coordinates
   * already supplied in GCJ-02 must bypass this conversion.
   */
  root.toLuckinCoordinates = function toLuckinCoordinates(coordinates) {
    const { longitude, latitude } = coordinates || {};
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude) ||
        Math.abs(longitude) > 180 || Math.abs(latitude) > 90) {
      throw new TypeError('坐标必须包含有效的 longitude 和 latitude 数值');
    }

    if (outOfChina(longitude, latitude)) {
      return { longitude, latitude };
    }

    let dlat = transformLatitude(longitude - 105.0, latitude - 35.0);
    let dlng = transformLongitude(longitude - 105.0, latitude - 35.0);
    const radlat = latitude / 180.0 * pi;
    const sinlat = Math.sin(radlat);
    const magic = 1 - ee * sinlat * sinlat;
    const sqrtmagic = Math.sqrt(magic);
    dlat = (dlat * 180.0) / ((a * (1 - ee)) / (magic * sqrtmagic) * pi);
    dlng = (dlng * 180.0) / (a / sqrtmagic * Math.cos(radlat) * pi);
    return { longitude: longitude + dlng, latitude: latitude + dlat };
  };
})(window);
