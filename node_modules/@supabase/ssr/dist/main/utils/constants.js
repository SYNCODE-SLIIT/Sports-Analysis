"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_COOKIE_OPTIONS = void 0;
exports.DEFAULT_COOKIE_OPTIONS = {
    path: "/",
    sameSite: "lax",
    httpOnly: false,
    // https://developer.chrome.com/blog/cookie-max-age-expires
    // https://httpwg.org/http-extensions/draft-ietf-httpbis-rfc6265bis.html#name-cookie-lifetime-limits
    maxAge: 400 * 24 * 60 * 60,
};
//# sourceMappingURL=constants.js.map