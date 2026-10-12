"""Real WeChat website OAuth and Alipay RSA2 OAuth, with memory-only sessions.

Configuration is read from environment variables. No provider credentials,
OAuth tokens, authorization codes, or session identifiers are logged or saved.
Alipay optionally uses cryptography; WeChat needs only the standard library.
"""

import base64
import hashlib
import hmac
import ipaddress
import json
import os
import re
import secrets
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from http.cookies import CookieError, SimpleCookie

try:
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding, rsa
    CRYPTOGRAPHY_AVAILABLE = True
except ImportError:
    CRYPTOGRAPHY_AVAILABLE = False


WECHAT_AUTHORIZE_URL = "https://open.weixin.qq.com/connect/qrconnect"
WECHAT_TOKEN_URL = "https://api.weixin.qq.com/sns/oauth2/access_token"
WECHAT_USERINFO_URL = "https://api.weixin.qq.com/sns/userinfo"
ALIPAY_AUTHORIZE_URL = "https://openauth.alipay.com/oauth2/publicAppAuthorize.htm"
ALIPAY_GATEWAY_URL = "https://openapi.alipay.com/gateway.do"
STATE_TTL = 600
SESSION_TTL = 8 * 60 * 60
BROWSER_COOKIE = "amo_oauth_browser"
SESSION_COOKIE = "amo_session"
NETWORK_TIMEOUT = 15
MAX_RESPONSE_BYTES = 128 * 1024
PROVIDERS = (("wechat", "微信"), ("alipay", "支付宝"))


class AuthError(Exception):
    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status

    def as_json(self):
        return {"ok": False, "error": {"code": self.code, "message": self.message}}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def open_provider(request, timeout):
    return urllib.request.build_opener(NoRedirect()).open(request, timeout=timeout)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def parse_json(raw):
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object,
                           parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
        if not isinstance(value, dict):
            raise ValueError()
        return value
    except (ValueError, UnicodeError):
        raise AuthError("provider_response_invalid", "登录平台返回了无效响应。", 502)


def cookie_value(header, name):
    try:
        cookie = SimpleCookie()
        cookie.load(header or "")
        value = cookie[name].value if name in cookie else ""
        return value if re.fullmatch(r"[A-Za-z0-9_-]{43}", value) else ""
    except (CookieError, ValueError):
        return ""


def make_cookie(name, value, max_age, secure):
    cookie = SimpleCookie()
    cookie[name] = value
    cookie[name]["path"] = "/"
    cookie[name]["httponly"] = True
    cookie[name]["samesite"] = "Lax"
    cookie[name]["max-age"] = max_age
    if secure:
        cookie[name]["secure"] = True
    return cookie.output(header="").strip()


def digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def redirect_origin(uri, provider):
    try:
        parsed = urllib.parse.urlsplit(uri)
        port = parsed.port
        hostname = parsed.hostname or ""
        if (parsed.scheme != "https" or not hostname or parsed.username or parsed.password
                or parsed.query or parsed.fragment or parsed.path != "/auth/callback/" + provider):
            return None
        if hostname == "localhost" or hostname.endswith((".localhost", ".local")) or "." not in hostname:
            return None
        try:
            ipaddress.ip_address(hostname)
            return None  # Website OAuth expects a platform-registered domain.
        except ValueError:
            pass
        return "https://" + hostname.lower() + (":" + str(port) if port and port != 443 else "")
    except ValueError:
        return None


def safe_profile(provider, name, avatar, access_token):
    name = name if isinstance(name, str) else ""
    name = "".join(char for char in name if ord(char) >= 32 and ord(char) != 127).strip()
    if access_token:
        name = name.replace(access_token, "[已隐藏]")
    name = name[:80]
    if not name:
        name = "微信用户" if provider == "wechat" else "支付宝用户"
    avatar = avatar if isinstance(avatar, str) and len(avatar) <= 2048 else ""
    try:
        parsed = urllib.parse.urlsplit(avatar)
        hostname = parsed.hostname or ""
        if parsed.scheme == "http" and (hostname.endswith(".qlogo.cn") or hostname.endswith(".qpic.cn")):
            avatar = urllib.parse.urlunsplit(parsed._replace(scheme="https"))
            parsed = urllib.parse.urlsplit(avatar)
        query_keys = {key.casefold() for key, _ in urllib.parse.parse_qsl(parsed.query)}
        if (parsed.scheme != "https" or not hostname or parsed.username or parsed.password
                or any(ord(char) <= 32 for char in avatar)
                or query_keys & {"access_token", "auth_token", "token", "secret"}
                or (access_token and access_token in avatar)):
            avatar = ""
    except ValueError:
        avatar = ""
    return {"name": name, "avatar": avatar, "provider": provider}


def load_rsa_key(value, private):
    text = value.strip().replace("\\n", "\n")
    if text.startswith("-----BEGIN"):
        data = text.encode("ascii")
        key = serialization.load_pem_private_key(data, password=None) if private else serialization.load_pem_public_key(data)
    else:
        data = base64.b64decode("".join(text.split()), validate=True)
        key = serialization.load_der_private_key(data, password=None) if private else serialization.load_der_public_key(data)
    required_type = rsa.RSAPrivateKey if private else rsa.RSAPublicKey
    if not isinstance(key, required_type) or key.key_size < 2048:
        raise ValueError("RSA2 requires an RSA key of at least 2048 bits")
    return key


def raw_response_object(text, response_key):
    """Extract exact signed JSON bytes, preserving whitespace and escaping.

    Alipay signs the response object's original JSON text, not a re-serialization.
    Parse top-level values instead of using a regex that can match nested strings.
    """
    decoder = json.JSONDecoder()
    position = len(text) - len(text.lstrip())
    if text[position:position + 1] != "{":
        raise ValueError()
    position += 1
    while True:
        while position < len(text) and text[position].isspace():
            position += 1
        if text[position:position + 1] == "}":
            break
        key, position = decoder.raw_decode(text, position)
        while position < len(text) and text[position].isspace():
            position += 1
        if text[position:position + 1] != ":":
            raise ValueError()
        position += 1
        while position < len(text) and text[position].isspace():
            position += 1
        start = position
        _, position = decoder.raw_decode(text, position)
        if key == response_key:
            return text[start:position].encode("utf-8")
        while position < len(text) and text[position].isspace():
            position += 1
        if text[position:position + 1] == ",":
            position += 1
        elif text[position:position + 1] == "}":
            break
        else:
            raise ValueError()
    raise ValueError()


class AuthManager:
    def __init__(self, environ=None, opener=None, clock=None):
        env = os.environ if environ is None else environ
        self._opener = opener or open_provider
        self._clock = clock or time.monotonic
        self._lock = threading.RLock()
        self._states = {}
        self._sessions = {}
        self._configs = {}
        for provider, _ in PROVIDERS:
            prefix = provider.upper()
            keys = (["APP_ID", "SECRET", "REDIRECT_URI"] if provider == "wechat"
                    else ["APP_ID", "PRIVATE_KEY", "PUBLIC_KEY", "REDIRECT_URI"])
            config = {key: str(env.get(prefix + "_" + key, "")).strip() for key in keys}
            missing = [prefix + "_" + key for key in keys if not config[key]]
            config["origin"] = redirect_origin(config["REDIRECT_URI"], provider)
            reason = "缺少配置：" + "、".join(missing) if missing else ""
            if not reason and not config["origin"]:
                reason = "回调必须使用已在平台登记的公网 HTTPS 域名，路径为 /auth/callback/" + provider + "；本地地址不能完成真实 OAuth。"
            if not reason and provider == "wechat" and not re.fullmatch(r"wx[A-Za-z0-9]{16}", config["APP_ID"]):
                reason = "WECHAT_APP_ID 格式无效，请使用审核通过的网站应用 AppID。"
            if not reason and provider == "alipay" and not re.fullmatch(r"[0-9]{16}", config["APP_ID"]):
                reason = "ALIPAY_APP_ID 格式无效，请使用开放平台应用 AppID。"
            if not reason and provider == "alipay":
                if not CRYPTOGRAPHY_AVAILABLE:
                    reason = "缺少可选 RSA2 依赖 cryptography，请参阅 requirements-auth.txt。"
                else:
                    try:
                        config["private_key"] = load_rsa_key(config["PRIVATE_KEY"], True)
                        config["public_key"] = load_rsa_key(config["PUBLIC_KEY"], False)
                    except Exception:
                        reason = "支付宝 RSA2 密钥无效，请核对应用私钥、支付宝公钥及 PEM/Base64 格式。"
            config["reason"] = reason
            self._configs[provider] = config

    @property
    def allowed_origins(self):
        return {config["origin"] for config in self._configs.values() if not config["reason"] and config["origin"]}

    def providers(self, origin=None):
        result = []
        for provider, name in PROVIDERS:
            config = self._configs[provider]
            reason = config["reason"]
            if not reason and origin is not None and origin != config["origin"]:
                reason = "当前页面地址与 OAuth 回调站点不同，请通过已登记的公网 HTTPS 站点访问；本地模式未验证真实 OAuth。"
            result.append({"id": provider, "name": name, "enabled": not bool(reason),
                           "reason": reason or "配置已读取；仍需平台审核和真实账号联调。",
                           "verification": "not_verified"})
        return {"ok": True, "providers": result, "oauth_verified": False}

    def _cleanup(self):
        now = self._clock()
        self._states = {key: value for key, value in self._states.items() if value["expires"] > now}
        self._sessions = {key: value for key, value in self._sessions.items() if value["expires"] > now}

    def start(self, provider, cookie_header, origin):
        if not isinstance(provider, str) or provider not in self._configs:
            raise AuthError("unknown_provider", "请选择微信或支付宝登录。")
        availability = next(item for item in self.providers(origin)["providers"] if item["id"] == provider)
        if not availability["enabled"]:
            raise AuthError("provider_not_configured", availability["reason"], 503)
        browser = cookie_value(cookie_header, BROWSER_COOKIE) or secrets.token_urlsafe(32)
        state = secrets.token_urlsafe(32)
        with self._lock:
            self._cleanup()
            if len(self._states) >= 1024:
                raise AuthError("login_busy", "登录请求较多，请稍后再试。", 429)
            self._states[digest(state)] = {"provider": provider, "browser": digest(browser),
                                          "origin": origin, "expires": self._clock() + STATE_TTL}
        config = self._configs[provider]
        if provider == "wechat":
            url = WECHAT_AUTHORIZE_URL + "?" + urllib.parse.urlencode({
                "appid": config["APP_ID"], "redirect_uri": config["REDIRECT_URI"],
                "response_type": "code", "scope": "snsapi_login", "state": state,
            }) + "#wechat_redirect"
        else:
            url = ALIPAY_AUTHORIZE_URL + "?" + urllib.parse.urlencode({
                "app_id": config["APP_ID"], "scope": "auth_user",
                "redirect_uri": config["REDIRECT_URI"], "state": state,
            })
        return {"ok": True, "url": url, "expires_in": STATE_TTL}, [
            make_cookie(BROWSER_COOKIE, browser, STATE_TTL, origin.startswith("https://"))]

    def _fetch(self, request):
        try:
            with self._opener(request, timeout=NETWORK_TIMEOUT) as response:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
                if len(raw) > MAX_RESPONSE_BYTES:
                    raise AuthError("provider_response_invalid", "登录平台响应超过大小限制。", 502)
                return raw
        except AuthError:
            raise
        except (socket.timeout, TimeoutError):
            raise AuthError("provider_timeout", "登录平台响应超时，请重新发起登录。", 504)
        except urllib.error.HTTPError as exc:
            exc.close()
            raise AuthError("provider_unavailable", "登录平台拒绝了请求，请核对应用权限后重试。", 502)
        except (urllib.error.URLError, OSError, ValueError):
            raise AuthError("provider_unavailable", "无法连接登录平台，请稍后重新登录。", 502)

    def _wechat_exchange(self, code):
        config = self._configs["wechat"]
        url = WECHAT_TOKEN_URL + "?" + urllib.parse.urlencode({
            "appid": config["APP_ID"], "secret": config["SECRET"], "code": code,
            "grant_type": "authorization_code"})
        token_response = parse_json(self._fetch(urllib.request.Request(url, headers={"Accept": "application/json"})))
        token, openid = token_response.get("access_token"), token_response.get("openid")
        if token_response.get("errcode") or not isinstance(token, str) or not token or not isinstance(openid, str) or not openid:
            raise AuthError("oauth_exchange_failed", "微信授权码交换失败，请重新发起授权。", 502)
        url = WECHAT_USERINFO_URL + "?" + urllib.parse.urlencode({"access_token": token, "openid": openid, "lang": "zh_CN"})
        user = parse_json(self._fetch(urllib.request.Request(url, headers={"Accept": "application/json"})))
        if user.get("errcode") or user.get("openid") != openid:
            raise AuthError("profile_fetch_failed", "微信用户资料读取失败，请检查网站应用授权范围。", 502)
        return safe_profile("wechat", user.get("nickname"), user.get("headimgurl"), token), openid

    def _alipay_request(self, method, parameters):
        config = self._configs["alipay"]
        params = {"app_id": config["APP_ID"], "method": method, "format": "JSON", "charset": "utf-8",
                  "sign_type": "RSA2", "timestamp": datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d %H:%M:%S"),
                  "version": "1.0", **parameters}
        signing = "&".join(key + "=" + str(params[key]) for key in sorted(params) if params[key] is not None and params[key] != "")
        signature = config["private_key"].sign(signing.encode("utf-8"), padding.PKCS1v15(), hashes.SHA256())
        params["sign"] = base64.b64encode(signature).decode("ascii")
        request = urllib.request.Request(ALIPAY_GATEWAY_URL, data=urllib.parse.urlencode(params).encode("utf-8"),
                                         headers={"Content-Type": "application/x-www-form-urlencoded;charset=utf-8", "Accept": "application/json"}, method="POST")
        raw = self._fetch(request)
        data = parse_json(raw)
        response_key = method.replace(".", "_") + "_response"
        if not isinstance(data.get(response_key), dict) or not isinstance(data.get("sign"), str):
            raise AuthError("provider_signature_invalid", "支付宝响应缺少有效签名，登录未完成。", 502)
        try:
            signed = raw_response_object(raw.decode("utf-8"), response_key)
            signature = base64.b64decode(data["sign"], validate=True)
            config["public_key"].verify(signature, signed, padding.PKCS1v15(), hashes.SHA256())
        except Exception:
            raise AuthError("provider_signature_invalid", "支付宝响应验签失败，登录未完成。", 502)
        result = data[response_key]
        if "code" in result and str(result["code"]) != "10000":
            raise AuthError("oauth_exchange_failed", "支付宝授权接口返回失败，请核对应用权限后重新授权。", 502)
        return result

    def _alipay_exchange(self, code):
        token_response = self._alipay_request("alipay.system.oauth.token", {"grant_type": "authorization_code", "code": code})
        token = token_response.get("access_token")
        if not isinstance(token, str) or not token:
            raise AuthError("oauth_exchange_failed", "支付宝未返回有效访问令牌，登录未完成。", 502)
        user = self._alipay_request("alipay.user.info.share", {"auth_token": token})
        common_ids = [key for key in ("user_id", "open_id") if token_response.get(key) and user.get(key)]
        if not common_ids or any(token_response[key] != user[key] for key in common_ids):
            raise AuthError("profile_fetch_failed", "支付宝用户资料标识核对失败，登录未完成。", 502)
        subject = str(user[common_ids[0]])
        return safe_profile("alipay", user.get("nick_name"), user.get("avatar"), token), subject

    def callback(self, provider, query, cookie_header, origin):
        state_values = query.get("state", [])
        browser = cookie_value(cookie_header, BROWSER_COOKIE)
        if not browser or len(state_values) != 1 or not re.fullmatch(r"[A-Za-z0-9_-]{43}", state_values[0]):
            raise AuthError("oauth_state_invalid", "登录状态无效，请从当前浏览器重新发起登录。")
        state_key = digest(state_values[0])
        with self._lock:
            self._cleanup()
            pending = self._states.get(state_key)
            if (pending is None or pending["provider"] != provider or pending["origin"] != origin
                    or not hmac.compare_digest(pending["browser"], digest(browser))):
                raise AuthError("oauth_state_invalid", "登录状态无效或已过期，请重新发起登录。")
            del self._states[state_key]  # Consume before network I/O; no replay or parallel exchanges.
        code_values = query.get("code" if provider == "wechat" else "auth_code", [])
        if query.get("error") or len(code_values) != 1 or not isinstance(code_values[0], str) or not 1 <= len(code_values[0]) <= 2048:
            raise AuthError("oauth_denied", "授权未完成，请重新登录。")
        if any(ord(char) <= 32 for char in code_values[0]):
            raise AuthError("oauth_code_invalid", "授权码格式无效，请重新登录。")
        try:
            profile, subject = self._wechat_exchange(code_values[0]) if provider == "wechat" else self._alipay_exchange(code_values[0])
        except AuthError:
            raise
        except Exception:
            raise AuthError("oauth_exchange_failed", "登录验证失败，请重新发起登录。", 502)
        session = secrets.token_urlsafe(32)
        with self._lock:
            previous = cookie_value(cookie_header, SESSION_COOKIE)
            if previous:
                self._sessions.pop(digest(previous), None)
            self._sessions[digest(session)] = {"profile": profile, "subject": digest(provider + ":" + subject),
                                               "expires": self._clock() + SESSION_TTL}
        secure = origin.startswith("https://")
        return [make_cookie(SESSION_COOKIE, session, SESSION_TTL, secure),
                make_cookie(BROWSER_COOKIE, "", 0, secure)]

    def me(self, cookie_header):
        session = cookie_value(cookie_header, SESSION_COOKIE)
        with self._lock:
            self._cleanup()
            record = self._sessions.get(digest(session)) if session else None
            return {"ok": True, "authenticated": record is not None,
                    "profile": dict(record["profile"]) if record else None}

    def logout(self, cookie_header, origin):
        session = cookie_value(cookie_header, SESSION_COOKIE)
        browser = cookie_value(cookie_header, BROWSER_COOKIE)
        with self._lock:
            if session:
                self._sessions.pop(digest(session), None)
            if browser:
                browser_hash = digest(browser)
                self._states = {key: value for key, value in self._states.items() if value["browser"] != browser_hash}
        secure = origin.startswith("https://")
        return {"ok": True, "authenticated": False, "profile": None}, [
            make_cookie(SESSION_COOKIE, "", 0, secure), make_cookie(BROWSER_COOKIE, "", 0, secure)]

    def clear(self):
        with self._lock:
            self._states.clear()
            self._sessions.clear()
