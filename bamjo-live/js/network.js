export function readWebSocketSource(params) {
  if (params.has("w")) {
    return {
      value: sanitizeWebSocketUrl(decodeBase64Url(params.get("w") || "")),
      shouldClean: true
    };
  }

  const key = params.has("ws") ? "ws" : params.has("socket") ? "socket" : null;
  if (!key) {
    return { value: "", shouldClean: false };
  }

  return {
    value: sanitizeWebSocketUrl(params.get(key) || ""),
    shouldClean: true
  };
}

export function buildWebSocketUrl(value, matchId) {
  if (!value || !matchId) {
    return null;
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    return null;
  }

  url.pathname = stripMatchRoute(url.pathname);
  url.search = "";
  url.hash = "";

  const base = url.toString().replace(/\/+$/, "");
  const path = url.pathname.replace(/\/+$/, "");
  const matchPath = path.endsWith("/ws")
    ? `/matches/${encodeURIComponent(matchId)}`
    : `/ws/matches/${encodeURIComponent(matchId)}`;

  return `${base}${matchPath}`;
}

export function buildSnapshotUrl(webSocketUrl) {
  try {
    const url = new URL(webSocketUrl);
    if (url.protocol === "ws:") {
      url.protocol = "http:";
    } else if (url.protocol === "wss:") {
      url.protocol = "https:";
    } else {
      return null;
    }

    url.pathname = url.pathname.replace(/\/ws\/matches\//i, "/matches/");
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function deriveDefaultWebSocketBase() {
  const host = window.location.host;
  if (!host || window.location.hostname.endsWith("github.io")) {
    return "";
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${host}`;
}

export function normalizeWebSocketBase(value) {
  if (!value) {
    return "";
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "ws:" && url.protocol !== "wss:") {
      return "";
    }

    url.pathname = stripMatchRoute(url.pathname);
    url.search = "";
    url.hash = "";

    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function stripMatchRoute(pathname) {
  return pathname
    .replace(/\/(?:ws\/)?matches\/.*$/i, "")
    .replace(/\/+$/, "");
}

export function sanitizeWebSocketUrl(value) {
  if (!value) {
    return "";
  }

  try {
    const url = new URL(value);
    url.searchParams.delete("token");
    return url.toString();
  } catch {
    return value;
  }
}

export function replaceCurrentQuery(params) {
  if (!window.history?.replaceState) {
    return;
  }

  const cleanUrl = new URL(window.location.href);
  cleanUrl.search = params.toString();
  window.history.replaceState(null, "", cleanUrl.toString());
}

function decodeBase64Url(value) {
  if (!value) {
    return "";
  }

  try {
    let base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4) {
      base64 += "=";
    }

    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}
