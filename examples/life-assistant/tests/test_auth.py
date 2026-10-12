import base64
import io
import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
from http.cookies import SimpleCookie
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import MallHTTPServer
from auth import (ALIPAY_GATEWAY_URL, BROWSER_COOKIE, CRYPTOGRAPHY_AVAILABLE, SESSION_COOKIE,
                  SESSION_TTL, STATE_TTL, AuthError, AuthManager, NoRedirect, safe_profile)
if CRYPTOGRAPHY_AVAILABLE:
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding, rsa


ORIGIN = "https://login.example.com"
WECHAT_ENV = {"WECHAT_APP_ID": "wx0123456789abcdef", "WECHAT_SECRET": "mock-wechat-secret",
              "WECHAT_REDIRECT_URI": ORIGIN + "/auth/callback/wechat"}


def cookie_header(set_cookies):
    return "; ".join(value.split(";", 1)[0] for value in set_cookies)


def state_from_url(url):
    return urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)["state"][0]


class WeChatRemote:
    def __init__(self, fail=False):
        self.requests = []
        self.fail = fail

    def __call__(self, request, timeout):
        self.requests.append(request)
        if self.fail:
            return io.BytesIO(b'{"errcode":40029,"errmsg":"mock secret should not be returned"}')
        if "/oauth2/access_token" in request.full_url:
            data = {"access_token": "mock-oauth-token", "openid": "mock-openid", "scope": "snsapi_login"}
        else:
            data = {"openid": "mock-openid", "nickname": "测试微信用户",
                    "headimgurl": "http://thirdwx.qlogo.cn/mock/avatar/132"}
        return io.BytesIO(json.dumps(data).encode())


class ConfigurationTests(unittest.TestCase):
    def test_missing_configuration_returns_disabled_without_secrets(self):
        providers = AuthManager(environ={}).providers()["providers"]
        self.assertEqual([item["id"] for item in providers], ["wechat", "alipay"])
        self.assertTrue(all(not item["enabled"] and item["reason"] for item in providers))

    def test_local_callback_is_not_treated_as_working_oauth(self):
        env = dict(WECHAT_ENV, WECHAT_REDIRECT_URI="http://127.0.0.1:8765/auth/callback/wechat")
        self.assertFalse(AuthManager(env).providers()["providers"][0]["enabled"])

    def test_configured_public_callback_still_disables_local_browser_start(self):
        manager = AuthManager(WECHAT_ENV)
        self.assertTrue(manager.providers(ORIGIN)["providers"][0]["enabled"])
        self.assertFalse(manager.providers("http://127.0.0.1:8765")["providers"][0]["enabled"])
        self.assertFalse(manager.providers(ORIGIN)["oauth_verified"])
        self.assertNotIn(WECHAT_ENV["WECHAT_SECRET"], json.dumps(manager.providers(ORIGIN)))

    def test_avatar_only_upgrades_official_wechat_cdn(self):
        self.assertEqual(safe_profile("wechat", "name", "http://evil.example/avatar", "token")["avatar"], "")
        self.assertTrue(safe_profile("wechat", "name", "http://thirdwx.qlogo.cn/avatar", "token")["avatar"].startswith("https://"))
        self.assertEqual(safe_profile("alipay", "name", "javascript:alert(1)", "token")["avatar"], "")


class WeChatFlowTests(unittest.TestCase):
    def setUp(self):
        self.now = 1000
        self.remote = WeChatRemote()
        self.manager = AuthManager(WECHAT_ENV, opener=self.remote, clock=lambda: self.now)

    def start(self):
        payload, cookies = self.manager.start("wechat", "", ORIGIN)
        return state_from_url(payload["url"]), cookie_header(cookies), cookies

    def test_real_endpoint_contract_profile_cookie_and_logout(self):
        state, browser_cookie, initial_cookies = self.start()
        cookie = SimpleCookie(initial_cookies[0])
        self.assertTrue(cookie[BROWSER_COOKIE]["httponly"])
        self.assertEqual(cookie[BROWSER_COOKIE]["samesite"], "Lax")
        self.assertTrue(cookie[BROWSER_COOKIE]["secure"])
        cookies = self.manager.callback("wechat", {"state": [state], "code": ["mock-code"]}, browser_cookie, ORIGIN)
        session = cookie_header(cookies)
        me = self.manager.me(session)
        self.assertTrue(me["authenticated"])
        self.assertEqual(me["profile"], {"name": "测试微信用户", "avatar": "https://thirdwx.qlogo.cn/mock/avatar/132", "provider": "wechat"})
        self.assertNotIn("mock-oauth-token", json.dumps(me))
        self.assertNotIn("mock-openid", json.dumps(me))
        self.assertEqual(len(self.remote.requests), 2)
        token_params = urllib.parse.parse_qs(urllib.parse.urlsplit(self.remote.requests[0].full_url).query)
        self.assertEqual(token_params["grant_type"], ["authorization_code"])
        profile_params = urllib.parse.parse_qs(urllib.parse.urlsplit(self.remote.requests[1].full_url).query)
        self.assertEqual(profile_params["lang"], ["zh_CN"])
        result, clear_cookies = self.manager.logout(session, ORIGIN)
        self.assertFalse(result["authenticated"])
        self.assertFalse(self.manager.me(session)["authenticated"])
        self.assertTrue(all("Max-Age=0" in cookie for cookie in clear_cookies))

    def test_state_is_bound_to_browser_and_wrong_browser_does_not_consume_it(self):
        state, browser_cookie, _ = self.start()
        with self.assertRaises(AuthError):
            self.manager.callback("wechat", {"state": [state], "code": ["code"]}, "", ORIGIN)
        self.assertEqual(self.remote.requests, [])
        self.manager.callback("wechat", {"state": [state], "code": ["code"]}, browser_cookie, ORIGIN)
        self.assertEqual(len(self.remote.requests), 2)

    def test_state_is_single_use_and_session_expires(self):
        state, browser_cookie, _ = self.start()
        query = {"state": [state], "code": ["code"]}
        session_cookies = self.manager.callback("wechat", query, browser_cookie, ORIGIN)
        with self.assertRaises(AuthError):
            self.manager.callback("wechat", query, browser_cookie, ORIGIN)
        self.assertEqual(len(self.remote.requests), 2)
        self.now += SESSION_TTL + 1
        self.assertFalse(self.manager.me(cookie_header(session_cookies))["authenticated"])

    def test_expired_state_does_not_exchange_code(self):
        state, browser_cookie, _ = self.start()
        self.now += STATE_TTL + 1
        with self.assertRaises(AuthError):
            self.manager.callback("wechat", {"state": [state], "code": ["code"]}, browser_cookie, ORIGIN)
        self.assertEqual(self.remote.requests, [])

    def test_state_is_bound_to_provider_and_origin(self):
        state, browser_cookie, _ = self.start()
        for provider, origin in (("alipay", ORIGIN), ("wechat", "https://another.example.com")):
            with self.assertRaises(AuthError):
                self.manager.callback(provider, {"state": [state], "code": ["code"]}, browser_cookie, origin)
        self.assertEqual(self.remote.requests, [])

    def test_provider_failure_never_creates_session_or_exposes_error(self):
        self.remote.fail = True
        state, browser_cookie, _ = self.start()
        with self.assertRaises(AuthError) as error:
            self.manager.callback("wechat", {"state": [state], "code": ["code"]}, browser_cookie, ORIGIN)
        self.assertNotIn("mock secret", str(error.exception))
        self.assertFalse(self.manager.me(browser_cookie)["authenticated"])
        self.assertEqual(self.manager._sessions, {})
        with self.assertRaises(AuthError):
            self.manager.callback("wechat", {"state": [state], "code": ["code"]}, browser_cookie, ORIGIN)


@unittest.skipUnless(CRYPTOGRAPHY_AVAILABLE, "optional cryptography not installed")
class AlipayFlowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.provider_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.env = {"ALIPAY_APP_ID": "2026000000000001", "ALIPAY_REDIRECT_URI": ORIGIN + "/auth/callback/alipay",
                   "ALIPAY_PRIVATE_KEY": cls.app_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode(),
                   "ALIPAY_PUBLIC_KEY": cls.provider_key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()}

    def setUp(self):
        self.requests = []
        self.tamper = False
        self.no_signature = False

    def remote(self, request, timeout):
        self.assertEqual(request.full_url, ALIPAY_GATEWAY_URL)
        params = {key: values[0] for key, values in urllib.parse.parse_qs(request.data.decode()).items()}
        self.requests.append(params)
        signature = base64.b64decode(params.pop("sign"))
        signing = "&".join(key + "=" + params[key] for key in sorted(params))
        self.app_key.public_key().verify(signature, signing.encode(), padding.PKCS1v15(), hashes.SHA256())
        self.assertEqual(params["sign_type"], "RSA2")
        method = params["method"]
        if method == "alipay.system.oauth.token":
            self.assertEqual(params["grant_type"], "authorization_code")
            value = {"access_token": "mock-alipay-token", "user_id": "2088000000000001"}
        else:
            self.assertEqual(params["auth_token"], "mock-alipay-token")
            value = {"code": "10000", "user_id": "2088000000000001", "nick_name": '测试"用户 { }',
                     "avatar": "https://tfs.alipayobjects.com/mock/avatar.png"}
        # Deliberately preserve whitespace and ASCII escaping to catch accidental
        # re-serialization of the response object before signature verification.
        response_text = json.dumps(value, ensure_ascii=True, indent=2)
        signature = base64.b64encode(self.provider_key.sign(response_text.encode(), padding.PKCS1v15(), hashes.SHA256())).decode()
        if self.tamper:
            response_text = response_text.replace("2088000000000001", "2088000000000002")
        raw = '{"' + method.replace(".", "_") + '_response": ' + response_text
        raw += '}' if self.no_signature else ', "sign": "' + signature + '"}'
        return io.BytesIO(raw.encode())

    def flow(self):
        manager = AuthManager(self.env, opener=self.remote)
        payload, cookies = manager.start("alipay", "", ORIGIN)
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(payload["url"]).query)
        self.assertEqual(query["scope"], ["auth_user"])
        return manager, query["state"][0], cookie_header(cookies)

    def test_rsa2_request_and_exact_raw_response_signature_profile(self):
        manager, state, browser_cookie = self.flow()
        cookies = manager.callback("alipay", {"state": [state], "auth_code": ["mock-code"]}, browser_cookie, ORIGIN)
        profile = manager.me(cookie_header(cookies))["profile"]
        self.assertEqual(profile["provider"], "alipay")
        self.assertEqual(profile["name"], '测试"用户 { }')
        self.assertTrue(profile["avatar"].startswith("https://tfs.alipayobjects.com/"))
        self.assertNotIn("mock-alipay-token", json.dumps(profile))
        self.assertEqual(len(self.requests), 2)

    def test_tampered_signature_never_creates_session(self):
        self.tamper = True
        manager, state, browser_cookie = self.flow()
        with self.assertRaises(AuthError) as error:
            manager.callback("alipay", {"state": [state], "auth_code": ["mock-code"]}, browser_cookie, ORIGIN)
        self.assertEqual(error.exception.code, "provider_signature_invalid")
        self.assertEqual(manager._sessions, {})

    def test_missing_signature_never_creates_session(self):
        self.no_signature = True
        manager, state, browser_cookie = self.flow()
        with self.assertRaises(AuthError):
            manager.callback("alipay", {"state": [state], "auth_code": ["mock-code"]}, browser_cookie, ORIGIN)
        self.assertEqual(manager._sessions, {})

    def test_optional_dependency_missing_is_disabled(self):
        with patch("auth.CRYPTOGRAPHY_AVAILABLE", False):
            providers = AuthManager(self.env).providers(ORIGIN)["providers"]
        self.assertFalse(providers[1]["enabled"])
        self.assertIn("cryptography", providers[1]["reason"])


class AuthHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        static = Path(cls.temp.name)
        (static / "index.html").write_text("Mock UI", encoding="utf-8")
        cls.manager = AuthManager(environ={})
        cls.server = MallHTTPServer(("127.0.0.1", 0), static_dir=static, auth=cls.manager)
        cls.base = "http://127.0.0.1:%d" % cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(2)
        cls.temp.cleanup()

    def request(self, path, body=None, headers=None):
        data = json.dumps(body).encode() if body is not None else None
        request_headers = {"Content-Type": "application/json", **(headers or {})}
        request = urllib.request.Request(self.base + path, data=data, headers=request_headers)
        opener = urllib.request.build_opener(NoRedirect())
        try:
            with opener.open(request, timeout=2) as response:
                return response.status, response.read(), response.headers
        except urllib.error.HTTPError as response:
            return response.code, response.read(), response.headers

    def test_unconfigured_provider_ui_contract_and_me(self):
        status, raw, _ = self.request("/api/auth/providers")
        self.assertEqual(status, 200)
        self.assertTrue(all(not value["enabled"] for value in json.loads(raw)["providers"]))
        status, raw, _ = self.request("/api/auth/me")
        self.assertFalse(json.loads(raw)["authenticated"])
        status, raw, headers = self.request("/api/auth/start", {"provider": "wechat"})
        self.assertEqual(status, 503)
        self.assertEqual(json.loads(raw)["error"]["code"], "provider_not_configured")
        self.assertIsNone(headers.get("Set-Cookie"))

    def test_callback_failure_redirect_has_no_code_token_or_false_session(self):
        status, raw, headers = self.request("/auth/callback/wechat?code=mock-private-code&state=bad-state",
                                             headers={"Sec-Fetch-Site": "cross-site"})
        self.assertEqual(status, 302)
        self.assertEqual(headers["Location"], "/?login=failed")
        self.assertEqual(raw, b"")
        self.assertIsNone(headers.get("Set-Cookie"))

    def test_cross_site_start_is_blocked_and_logout_clears_cookies(self):
        self.assertEqual(self.request("/api/auth/start", {"provider": "wechat"},
                                      {"Origin": "https://evil.example"})[0], 403)
        status, raw, headers = self.request("/api/auth/logout", {})
        self.assertEqual(status, 200)
        self.assertFalse(json.loads(raw)["authenticated"])
        self.assertEqual(len(headers.get_all("Set-Cookie")), 2)


if __name__ == "__main__":
    unittest.main()
