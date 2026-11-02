window.__ModuleLoader__.load({ id: "dsh-file-toolkit", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;

var React = require("react");

// --- PDF viewer half (native rendering + highlighted find) -----------------
var PdfPart = (function () {
/**
 * Implementation id registered with the document-preview registry. The sidebar
 * dispatches the keyed body slot with `key === selected implementation id`, so
 * this constant is the only contract between the two registrations.
 */
var IMPL_ID = "dsh-pdf-native/pdf";
var RPC = "/dsh-pdf-native/rpc";
var STYLE_ID = "dsh-pdf-native-style";
var CSS = [
	".dshp-bar{position:absolute;bottom:14px;right:14px;z-index:3;display:flex;align-items:center;gap:4px;",
	"width:370px;max-width:calc(100% - 28px);box-sizing:border-box;padding:5px 6px 5px 10px;border-radius:10px;",
	"border:1px solid rgba(128,128,128,.26);box-shadow:0 10px 28px rgba(0,0,0,.22);font-size:12px;}",
	".dshp-bar input{flex:1 1 auto;min-width:0;height:26px;padding:0 8px;border-radius:6px;border:1px solid transparent;",
	"background:rgba(128,128,128,.12);color:inherit;font:inherit;outline:none;}",
	".dshp-bar input:focus{border-color:#4c7dff;background:transparent;}",
	".dshp-bar input::placeholder{color:inherit;opacity:.45;}",
	".dshp-count{flex:none;min-width:42px;text-align:center;font-size:11px;opacity:.7;",
	"font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
	".dshp-count.is-error{color:#e05252;opacity:1;}",
	".dshp-btn{flex:none;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;",
	"padding:0;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:13px;",
	"line-height:1;cursor:pointer;}",
	".dshp-btn:hover:not(:disabled){background:rgba(128,128,128,.16);}",
	".dshp-btn:disabled{opacity:.35;cursor:default;}",
	".dshp-btn.text{width:auto;padding:0 7px;font-size:11px;color:#4c7dff;}",
	".dshp-sep{flex:none;width:1px;height:16px;background:rgba(128,128,128,.28);margin:0 2px;}",
	".dshp-launch{position:absolute;bottom:14px;right:14px;z-index:3;display:inline-flex;align-items:center;gap:5px;",
	"padding:5px 11px 5px 9px;border-radius:999px;border:1px solid rgba(128,128,128,.3);cursor:pointer;",
	"font-size:12px;box-shadow:0 4px 14px rgba(0,0,0,.16);background:rgba(255,255,255,.94);color:#111;}",
	".dshp-launch:hover{filter:brightness(.97);}"
].join("\n");

function ensureStyle(doc) {
	if (!doc) return;
	var tag = doc.getElementById(STYLE_ID);
	if (!tag) {
		tag = doc.createElement("style");
		tag.id = STYLE_ID;
		doc.head.appendChild(tag);
	}
	if (tag.textContent !== CSS) tag.textContent = CSS;
}

function toBase64(bytes) {
	var chunk = 0x8000;
	var out = "";
	for (var i = 0; i < bytes.length; i += chunk) {
		out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
	}
	return btoa(out);
}

function rpc(payload) {
	return fetch(RPC, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(payload)
	}).then(function (response) {
		return response.json().catch(function () { return { ok: false, error: "bad response" }; });
	});
}

/** First opaque ancestor background, so overlay panels never see through. */
function solidSurfaceFor(el) {
	var node = el;
	while (node && node.nodeType === 1) {
		var bg = getComputedStyle(node).backgroundColor;
		var m = /^rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s\/]+([\d.]+))?\)$/i.exec(bg);
		if (m && (m[4] === undefined || Number(m[4]) >= 0.98)) {
			var r = Number(m[1]), g = Number(m[2]), b = Number(m[3]);
			var light = (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55;
			return { background: "rgb(" + r + ", " + g + ", " + b + ")", color: light ? "#111111" : "#f2f2f2" };
		}
		node = node.parentElement;
	}
	return { background: "#ffffff", color: "#111111" };
}

/**
 * Sidebar PDF body: native viewer plus a small find panel.
 *
 * The native viewer's own find bar cannot be opened from a page, so the panel
 * asks the Host to index the PDF text (PyMuPDF) and jumps by page number.
 */
function NativePdfBody(props) {
	var content = props && props.content;
	var bytes = React.useMemo(function () {
		try {
			if (!content || content.kind !== "bytes" || !content.data) return null;
			var data = content.data instanceof Uint8Array ? content.data : new Uint8Array(content.data);
			return data.byteLength > 0 ? data : null;
		} catch (error) {
			return null;
		}
	}, [content]);

	var url = React.useMemo(function () {
		if (!bytes) return null;
		return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
	}, [bytes]);

	React.useEffect(function () {
		return function () {
			if (url) URL.revokeObjectURL(url);
		};
	}, [url]);

	React.useEffect(function () {
		return function () {
			if (searchUrl) URL.revokeObjectURL(searchUrl);
		};
	}, [searchUrl]);

	var pageState = React.useState(0);
	var page = pageState[0], setPage = pageState[1];
	var openState = React.useState(false);
	var open = openState[0], setOpen = openState[1];
	var queryState = React.useState("");
	var query = queryState[0], setQuery = queryState[1];
	var matchState = React.useState(null);
	var matches = matchState[0], setMatches = matchState[1];
	var indexState = React.useState(0);
	var index = indexState[0], setIndex = indexState[1];
	var busyState = React.useState(false);
	var busy = busyState[0], setBusy = busyState[1];
	var errorState = React.useState("");
	var error = errorState[0], setError = errorState[1];
	var themeState = React.useState({ background: "#ffffff", color: "#111111" });
	var theme = themeState[0], setTheme = themeState[1];
	var searchUrlState = React.useState(null);
	var searchUrl = searchUrlState[0], setSearchUrl = searchUrlState[1];

	var boxRef = React.useRef(null);
	var inputRef = React.useRef(null);
	var frameRef = React.useRef(null);

	React.useEffect(function () {
		if (open && inputRef.current) inputRef.current.focus();
	}, [open]);

	function openFind() {
		if (boxRef.current) setTheme(solidSurfaceFor(boxRef.current));
		setOpen(true);
		setTimeout(function () {
			if (inputRef.current) {
				inputRef.current.focus();
				inputRef.current.select();
			}
		}, 0);
	}

	function isFindShortcut(event) {
		var mod = event.ctrlKey || event.metaKey;
		if (event.key === "F3") return true;
		if (mod && !event.altKey && (event.key === "f" || event.key === "F" || event.code === "KeyF")) return true;
		return false;
	}

	function onFindShortcut(event) {
		if (!isFindShortcut(event)) return;
		event.preventDefault();
		event.stopPropagation();
		openFind();
	}

	// Ctrl/Cmd+F is not forwarded to the embedded PDF plugin by Electron, so the
	// page binds it to this panel instead of leaving the shortcut dead.
	React.useEffect(function () {
		window.addEventListener("keydown", onFindShortcut, true);
		document.addEventListener("keydown", onFindShortcut, true);
		return function () {
			window.removeEventListener("keydown", onFindShortcut, true);
			document.removeEventListener("keydown", onFindShortcut, true);
		};
	}, []);

	// While the PDF itself has focus, key events never reach the parent window;
	// the blob iframe is same-origin, so bind the same shortcut inside it.
	React.useEffect(function () {
		var frame = frameRef.current;
		if (!frame) return;
		function attach() {
			try {
				var win = frame.contentWindow;
				if (!win) return;
				win.addEventListener("keydown", onFindShortcut, true);
			} catch (error) {
				// cross-document access refused: the toolbar button still works
			}
		}
		function detach() {
			try {
				var win = frame.contentWindow;
				if (win) win.removeEventListener("keydown", onFindShortcut, true);
			} catch (error) {
				// ignore
			}
		}
		frame.addEventListener("load", attach);
		attach();
		return function () {
			frame.removeEventListener("load", attach);
			detach();
		};
	}, [frameKey]);

	function toggle() {
		if (open) {
			setOpen(false);
			return;
		}
		if (boxRef.current) setTheme(solidSurfaceFor(boxRef.current));
		setError("");
		setOpen(true);
	}

	function jumpTo(entry) {
		if (!entry) return;
		setPage(entry.page);
	}

	function runSearch() {
		var text = query.trim();
		if (!text) return;
		if (!bytes) {
			setError("没有 PDF 内容");
			return;
		}
		setBusy(true);
		setError("");
		rpc({ action: "highlightPdf", data: toBase64(bytes), query: text }).then(function (result) {
			if (!result || !result.ok) {
				setMatches(null);
				setError("查找失败：" + ((result && result.error) || "插件未加载"));
				return;
			}
			var pages = result.pages || [];
			setMatches(pages);
			if (pages.length === 0 || !result.pdf) {
				if (searchUrl) URL.revokeObjectURL(searchUrl);
				setSearchUrl(null);
				setIndex(0);
				setPage(0);
				return;
			}
			var binary = atob(result.pdf);
			var data = new Uint8Array(binary.length);
			for (var i = 0; i < binary.length; i += 1) data[i] = binary.charCodeAt(i);
			var nextUrl = URL.createObjectURL(new Blob([data], { type: "application/pdf" }));
			if (searchUrl) URL.revokeObjectURL(searchUrl);
			setSearchUrl(nextUrl);
			setIndex(0);
			setPage(pages[0].page);
		}).catch(function (failure) {
			setMatches(null);
			setError("查找失败：" + failure.message);
		}).then(function () {
			setBusy(false);
		});
	}

	function clearSearch() {
		if (searchUrl) URL.revokeObjectURL(searchUrl);
		setSearchUrl(null);
		setMatches(null);
		setError("");
		setIndex(0);
		setPage(0);
	}

	function move(step) {
		if (!matches || matches.length === 0) return;
		var next = (index + step + matches.length) % matches.length;
		setIndex(next);
		jumpTo(matches[next]);
	}

	function onKeyDown(event) {
		if (event.key === "Enter") {
			event.preventDefault();
			runSearch();
		} else if (event.key === "Escape") {
			event.preventDefault();
			setOpen(false);
		}
	}

	function statusText() {
		if (busy) return "…";
		if (error) return "失败";
		if (!matches) return "";
		if (matches.length === 0) return "0";
		return (index + 1) + "/" + matches.length;
	}

	function statusTitle() {
		if (error) return error;
		if (busy) return "查找中";
		if (matches && matches.length > 0) {
			var current = matches[index] || matches[0];
			return "第 " + current.page + " 页" + (current.count > 1 ? "，该页 " + current.count + " 处" : "");
		}
		if (matches && matches.length === 0) return "没有找到";
		return "回车查找";
	}

	if (!url) {
		return React.createElement("div", {
			style: {
				display: "flex", alignItems: "center", justifyContent: "center",
				width: "100%", height: "100%", minHeight: "160px",
				fontSize: "12px", opacity: 0.6
			}
		}, "PDF bytes unavailable");
	}

	var activeUrl = searchUrl || url;
	var src = activeUrl + "#toolbar=1&navpanes=0&view=FitH" + (page > 0 ? "&page=" + page : "");
	var frameKey = (searchUrl ? "h" : "o") + "-" + page;
	var buttonStyle = {
		padding: "3px 9px", fontSize: "12px", borderRadius: "6px",
		border: "1px solid rgba(128,128,128,.4)", background: "transparent",
		color: "inherit", cursor: "pointer"
	};

	return React.createElement("div", {
		ref: boxRef,
		style: { position: "relative", display: "flex", width: "100%", height: "100%", minHeight: "160px" }
	},
		React.createElement("iframe", {
			key: frameKey,
			ref: frameRef,
			src: src,
			title: "PDF",
			style: { border: 0, display: "block", flex: "1 1 auto", width: "100%", height: "100%", background: "#ffffff" }
		}),
		open ? null : React.createElement("button", {
			type: "button",
			className: "dshp-launch",
			onClick: toggle,
			title: "查找（Ctrl+F）"
		},
			React.createElement("svg", {
				width: 13, height: 13, viewBox: "0 0 16 16", fill: "none",
				stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round"
			},
				React.createElement("circle", { cx: 7, cy: 7, r: 4.5 }),
				React.createElement("path", { d: "M10.6 10.6 L14 14" })
			),
			"查找"
		),
		open ? React.createElement("div", {
			className: "dshp-bar",
			style: { background: theme.background, color: theme.color }
		},
			React.createElement("input", {
				ref: inputRef,
				value: query,
				placeholder: "在文档中查找…",
				onChange: function (event) { setQuery(event.target.value); },
				onKeyDown: onKeyDown
			}),
			React.createElement("span", {
				className: "dshp-count" + (error ? " is-error" : ""),
				title: statusTitle()
			}, statusText()),
			React.createElement("button", {
				type: "button", className: "dshp-btn", title: "上一处",
				onClick: function () { move(-1); },
				disabled: !matches || matches.length === 0
			}, "‹"),
			React.createElement("button", {
				type: "button", className: "dshp-btn", title: "下一处",
				onClick: function () { move(1); },
				disabled: !matches || matches.length === 0
			}, "›"),
			searchUrl ? React.createElement(React.Fragment, null,
				React.createElement("span", { className: "dshp-sep" }),
				React.createElement("button", {
					type: "button", className: "dshp-btn text", title: "清除高亮",
					onClick: clearSearch
				}, "清除")
			) : null,
			React.createElement("span", { className: "dshp-sep" }),
			React.createElement("button", {
				type: "button", className: "dshp-btn", title: "关闭（Esc）",
				onClick: function () { setOpen(false); }
			}, "✕")
		) : null
	);
}

var inject = ["slots", "documentPreviews"];
var name = "dsh-pdf-native";

/**
 * Register a PDF preview implementation ranked above `builtin`, plus the keyed
 * body the sidebar renders for that implementation. Unloading the plugin
 * disposes both registrations and the builtin pdf.js body takes over again.
 */
function apply(ctx) {
	if (typeof document !== "undefined") ensureStyle(document);
	ctx.effect(function () {
		return ctx.documentPreviews.register({
			id: IMPL_ID,
			extensions: ["pdf"],
			binaryExtensions: ["pdf"],
			priority: "external",
			title: function () { return "PDF (native)"; },
			loading: "bytes-complete",
			wrap: false
		});
	}, "dsh-pdf-native: preview implementation");

	ctx.effect(function () {
		return ctx.slots.inject("sidebar.right.tab.document", function () {
			return ctx.slots.register({
				name: "sidebar.right.tab.document",
				key: IMPL_ID
			}, NativePdfBody);
		});
	}, "dsh-pdf-native: keyed body");
}
return { apply: apply };
})();

// --- File-tree context menu half (paths, copy/paste, rename, delete) ------
var MenuPart = (function () {
var STYLE_ID = "dsh-copy-path-style";
var RPC = "/dsh-copy-path/rpc";
var CSS = [
	".dsh-cp-menu{position:fixed;z-index:2147483000;min-width:190px;padding:5px;border-radius:10px;",
	"border:1px solid rgba(128,128,128,.28);box-shadow:0 12px 32px rgba(0,0,0,.24);",
	"font-size:12.5px;line-height:1.45;user-select:none;}",
	".dsh-cp-menu button{display:flex;width:100%;align-items:center;gap:8px;padding:7px 10px;border:0;border-radius:6px;",
	"background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;white-space:nowrap;}",
	".dsh-cp-menu button:hover{background:rgba(128,128,128,.16);}",
	".dsh-cp-menu button:disabled{opacity:.5;cursor:default;}",
	".dsh-cp-menu .dsh-cp-sep{height:1px;margin:5px 6px;background:rgba(128,128,128,.22);}",
	".dsh-cp-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483001;",
	"max-width:70vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:7px 12px;border-radius:999px;",
	"font-size:12px;background:rgba(20,20,20,.88);color:#fff;pointer-events:none;}",
	".dsh-cp-overlay{position:fixed;inset:0;z-index:2147483002;background:rgba(0,0,0,.28);",
	"display:flex;align-items:center;justify-content:center;}",
	".dsh-cp-dialog{min-width:280px;max-width:min(440px,92vw);padding:14px 14px 12px;border-radius:10px;",
	"box-shadow:0 18px 48px rgba(0,0,0,.35);border:1px solid rgba(128,128,128,.28);font-size:13px;}",
	".dsh-cp-dialog h4{margin:0 0 8px;font-size:13px;font-weight:600;}",
	".dsh-cp-dialog p{margin:0 0 10px;font-size:12px;opacity:.7;word-break:break-all;line-height:1.5;}",
	".dsh-cp-dialog input{width:100%;box-sizing:border-box;padding:7px 9px;border-radius:6px;",
	"border:1px solid rgba(128,128,128,.42);background:transparent;color:inherit;font:inherit;outline:none;}",
	".dsh-cp-dialog input:focus{border-color:#4c7dff;}",
	".dsh-cp-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px;}",
	".dsh-cp-btn{padding:5px 12px;border-radius:6px;border:1px solid rgba(128,128,128,.35);",
	"background:transparent;color:inherit;font:inherit;cursor:pointer;}",
	".dsh-cp-btn.primary{background:#3b6cf6;border-color:#3b6cf6;color:#fff;}",
	".dsh-cp-btn.danger{background:#d13b3b;border-color:#d13b3b;color:#fff;}"
].join("\n");

function ensureStyle(doc) {
	if (!doc) return;
	// Refresh an existing tag: on a hot plugin reload the old stylesheet is still
	// in the document and would otherwise keep the previous rule set.
	var tag = doc.getElementById(STYLE_ID);
	if (!tag) {
		tag = doc.createElement("style");
		tag.id = STYLE_ID;
		doc.head.appendChild(tag);
	}
	if (tag.textContent !== CSS) tag.textContent = CSS;
}

function isDrivePath(p) { return /^[A-Za-z]:[\\/]/.test(p); }

function toWindowsPath(p) { return isDrivePath(p) ? p.replace(/\//g, "\\") : p; }

function parentOf(p) {
	var normalized = p.replace(/[\\/]+$/, "");
	var cut = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
	return cut > 0 ? normalized.slice(0, cut) : normalized;
}

function relativeTo(root, p) {
	if (!root) return null;
	var base = root.replace(/[\\/]+$/, "");
	if (p === base) return ".";
	if (p.indexOf(base + "/") === 0) return p.slice(base.length + 1);
	if (p.indexOf(base + "\\") === 0) return p.slice(base.length + 1);
	return null;
}

function parseColor(value) {
	var m = /^rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s\/]+([\d.]+))?\)$/i.exec(String(value || ""));
	if (!m) return null;
	return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] === undefined ? 1 : Number(m[4]) };
}

/** Walk up until an actually opaque background is found; return a solid color. */
function solidSurfaceFor(el) {
	var node = el;
	while (node && node.nodeType === 1) {
		var bg = parseColor(getComputedStyle(node).backgroundColor);
		if (bg && bg.a >= 0.98) {
			return "rgb(" + bg.r + ", " + bg.g + ", " + bg.b + ")";
		}
		node = node.parentElement;
	}
	var text = parseColor(getComputedStyle(document.body).color);
	var darkText = text && (text.r + text.g + text.b) < 384;
	return darkText ? "#ffffff" : "#1f2023";
}

function textColorFor(surface) {
	var bg = parseColor(surface);
	if (!bg) return "#111111";
	var luminance = (0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b) / 255;
	return luminance < 0.55 ? "#f2f2f2" : "#111111";
}

function legacyCopy(doc, text) {
	var ta = doc.createElement("textarea");
	ta.value = text;
	ta.setAttribute("readonly", "");
	ta.style.position = "fixed";
	ta.style.top = "-1000px";
	ta.style.opacity = "0";
	doc.body.appendChild(ta);
	ta.select();
	try { doc.execCommand("copy"); } catch (error) { /* ignore */ }
	doc.body.removeChild(ta);
}

function copyText(doc, text) {
	var clip = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
	if (clip && typeof clip.writeText === "function") {
		return clip.writeText(text).catch(function () { legacyCopy(doc, text); });
	}
	legacyCopy(doc, text);
	return Promise.resolve();
}

function rpc(payload) {
	return fetch(RPC, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(payload)
	}).then(function (response) {
		return response.json().catch(function () { return { ok: false, error: "bad response" }; });
	});
}

function install(doc) {
	var menu = null;
	var toastEl = null;
	var toastTimer = 0;
	var activeOverlay = null;

	function closeMenu() {
		if (menu && menu.parentNode) menu.parentNode.removeChild(menu);
		menu = null;
	}

	function toast(text) {
		if (toastEl && toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
		toastEl = doc.createElement("div");
		toastEl.className = "dsh-cp-toast";
		toastEl.textContent = text;
		doc.body.appendChild(toastEl);
		clearTimeout(toastTimer);
		toastTimer = setTimeout(function () {
			if (toastEl && toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
			toastEl = null;
		}, 2000);
	}

	/**
	 * Small in-page dialog (Electron does not implement window.prompt).
	 * @param {object} options - title, detail, value, confirmLabel, danger, surface, color, withInput.
	 * @returns {Promise<string|null|boolean>} the entered text, true/false, or null on cancel.
	 */
	function showDialog(options) {
		return new Promise(function (resolve) {
			if (activeOverlay !== null) {
				resolve(options.withInput ? null : false);
				return;
			}
			var overlay = doc.createElement("div");
			overlay.className = "dsh-cp-overlay";
			// Inline geometry: the dialog must stay modal even if the stylesheet
			// in this document is stale after a hot plugin reload.
			overlay.style.position = "fixed";
			overlay.style.left = "0";
			overlay.style.top = "0";
			overlay.style.right = "0";
			overlay.style.bottom = "0";
			overlay.style.zIndex = "2147483002";
			overlay.style.background = "rgba(0,0,0,.28)";
			overlay.style.display = "flex";
			overlay.style.alignItems = "center";
			overlay.style.justifyContent = "center";
			var dialog = doc.createElement("div");
			dialog.className = "dsh-cp-dialog";
			dialog.style.background = options.surface;
			dialog.style.color = options.color;
			dialog.style.padding = "14px";
			dialog.style.borderRadius = "10px";
			dialog.style.minWidth = "280px";
			dialog.style.maxWidth = "min(440px, 92vw)";
			dialog.style.boxShadow = "0 18px 48px rgba(0,0,0,.35)";
			dialog.style.border = "1px solid rgba(128,128,128,.28)";

			var heading = doc.createElement("h4");
			heading.textContent = options.title;
			dialog.appendChild(heading);

			if (options.detail) {
				var detail = doc.createElement("p");
				detail.textContent = options.detail;
				dialog.appendChild(detail);
			}

			var input = null;
			if (options.withInput) {
				input = doc.createElement("input");
				input.type = "text";
				input.value = options.value || "";
				dialog.appendChild(input);
			}

			var actions = doc.createElement("div");
			actions.className = "dsh-cp-actions";
			var cancel = doc.createElement("button");
			cancel.type = "button";
			cancel.className = "dsh-cp-btn";
			cancel.textContent = "取消";
			var ok = doc.createElement("button");
			ok.type = "button";
			ok.className = "dsh-cp-btn " + (options.danger ? "danger" : "primary");
			ok.textContent = options.confirmLabel || "确定";
			actions.appendChild(cancel);
			actions.appendChild(ok);
			dialog.appendChild(actions);
			overlay.appendChild(dialog);

			var done = false;
			function finish(value) {
				if (done) return;
				done = true;
				activeOverlay = null;
				doc.removeEventListener("keydown", onKey, true);
				if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
				resolve(value);
			}
			function onKey(event) {
				if (event.key === "Escape") {
					event.preventDefault();
					event.stopPropagation();
					finish(options.withInput ? null : false);
				} else if (event.key === "Enter" && options.withInput) {
					event.preventDefault();
					event.stopPropagation();
					finish(input.value.trim());
				}
			}
			cancel.addEventListener("click", function () { finish(options.withInput ? null : false); });
			ok.addEventListener("click", function () {
				finish(options.withInput ? input.value.trim() : true);
			});
			overlay.addEventListener("mousedown", function (event) {
				if (event.target === overlay) finish(options.withInput ? null : false);
			});
			doc.addEventListener("keydown", onKey, true);
			doc.body.appendChild(overlay);
			activeOverlay = overlay;
			setTimeout(function () {
				if (input) {
					input.focus();
					input.select();
				} else {
					ok.focus();
				}
			}, 0);
		});
	}

	function promptText(options) {
		return showDialog(Object.assign({ withInput: true }, options)).then(function (value) {
			return typeof value === "string" && value.length > 0 ? value : null;
		});
	}

	function openMenu(x, y, surface, textColor, items) {
		closeMenu();
		var el = doc.createElement("div");
		el.className = "dsh-cp-menu";
		el.setAttribute("role", "menu");
		el.style.background = surface;
		el.style.color = textColor;
		items.forEach(function (item) {
			if (item === "-") {
				var sep = doc.createElement("div");
				sep.className = "dsh-cp-sep";
				el.appendChild(sep);
				return;
			}
			var btn = doc.createElement("button");
			btn.type = "button";
			btn.setAttribute("role", "menuitem");
			btn.textContent = item.label;
			btn.disabled = item.disabled === true;
			btn.addEventListener("click", function (event) {
				event.preventDefault();
				event.stopPropagation();
				if (btn.disabled) return;
				closeMenu();
				item.run();
			});
			el.appendChild(btn);
		});
		doc.body.appendChild(el);
		var rect = el.getBoundingClientRect();
		var left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
		var top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
		el.style.left = left + "px";
		el.style.top = top + "px";
		menu = el;
	}

	function onContextMenu(event) {
		var target = event.target;
		if (!(target && target.closest)) return;
		var row = target.closest("[data-files-entry]");
		var rootEl = target.closest("[data-files-root]");
		var path = null;
		var kind = "file";
		if (row) {
			path = row.getAttribute("data-files-path");
			kind = row.getAttribute("data-files-entry") || "file";
		} else if (rootEl && target.closest("[data-files-path]")) {
			path = rootEl.getAttribute("data-files-root");
			kind = "directory";
		}
		if (!path) return;

		event.preventDefault();
		event.stopPropagation();

		var root = rootEl ? rootEl.getAttribute("data-files-root") : null;
		var winPath = toWindowsPath(path);
		var rel = relativeTo(root, path);
		var pasteDir = kind === "directory" ? winPath : parentOf(winPath);
		var surface = solidSurfaceFor(row || rootEl || target);
		var textColor = textColorFor(surface);

		var isDir = kind === "directory";
		var baseName = winPath.split(/[\\/]/).filter(Boolean).pop() || winPath;
		var items = [];

		items.push({ label: isDir ? "打开文件夹" : "打开", run: function () {
			rpc({ action: "open", path: winPath }).then(function (result) {
				if (!result || !result.ok) toast("打开失败：" + ((result && result.error) || "插件未加载"));
			}).catch(function (error) { toast("打开失败：" + error.message); });
		} });
		items.push({ label: "在资源管理器中显示", run: function () {
			rpc({ action: "reveal", path: winPath }).then(function (result) {
				if (!result || !result.ok) toast("无法打开资源管理器：" + ((result && result.error) || "插件未加载"));
			}).catch(function (error) { toast("无法打开资源管理器：" + error.message); });
		} });
		items.push("-");

		items.push({ label: "复制绝对路径", run: function () { copyText(doc, winPath).then(function () { toast("已复制：" + winPath); }); } });
		if (rel !== null) {
			items.push({ label: "复制相对路径", run: function () { copyText(doc, rel).then(function () { toast("已复制：" + rel); }); } });
		}
		items.push({ label: "复制文件名", run: function () {
			copyText(doc, baseName).then(function () { toast("已复制：" + baseName); });
		} });
		items.push("-");

		items.push({ label: "复制文件", run: function () {
			rpc({ action: "copyFiles", paths: [winPath] }).then(function (result) {
				toast(result && result.ok ? "已复制到剪贴板，可在资源管理器粘贴" : "复制失败：" + ((result && result.error) || "插件未加载"));
			}).catch(function (error) { toast("复制失败：" + error.message); });
		} });
		items.push({ label: "粘贴文件到此", run: function () {
			rpc({ action: "pasteFiles", dir: pasteDir }).then(function (result) {
				if (result && result.ok) {
					if (result.count > 0) {
						var extra = result.skipped > 0 ? "，" + result.skipped + " 项跳过（源文件已不存在）" : "";
						toast("已粘贴 " + result.count + " 项" + extra);
					} else if (result.skipped > 0) {
						toast("没有粘贴成功：剪贴板里的 " + result.skipped + " 项已不存在");
					} else {
						toast("剪贴板里没有可粘贴的文件");
					}
				} else {
					toast("粘贴失败：" + ((result && result.error) || "插件未加载"));
				}
			}).catch(function (error) { toast("粘贴失败：" + error.message); });
		} });
		items.push("-");

		if (isDir) {
			items.push({ label: "新建文件夹…", run: function () {
				promptText({
					title: "新建文件夹",
					value: "新建文件夹",
					confirmLabel: "创建",
					surface: surface,
					color: textColor
				}).then(function (folder) {
					if (!folder) return;
					if (/[\\/]/.test(folder)) { toast("名称不能包含路径分隔符"); return; }
					rpc({ action: "mkdir", dir: winPath, name: folder }).then(function (result) {
						toast(result && result.ok ? "已创建：" + result.path : "新建失败：" + ((result && result.error) || "插件未加载"));
					}).catch(function (error) { toast("新建失败：" + error.message); });
				});
			} });
		}

		items.push({ label: "重命名…", run: function () {
			promptText({
				title: "重命名",
				detail: winPath,
				value: baseName,
				confirmLabel: "重命名",
				surface: surface,
				color: textColor
			}).then(function (next) {
				if (!next || next === baseName) return;
				if (/[\\/]/.test(next)) { toast("名称不能包含路径分隔符"); return; }
				rpc({ action: "rename", path: winPath, name: next }).then(function (result) {
					toast(result && result.ok ? "已重命名为：" + result.path : "重命名失败：" + ((result && result.error) || "插件未加载"));
				}).catch(function (error) { toast("重命名失败：" + error.message); });
			});
		} });
		items.push({ label: "删除（移到回收站）", run: function () {
			showDialog({
				title: "移到回收站？",
				detail: winPath,
				confirmLabel: "删除",
				danger: true,
				surface: surface,
				color: textColor
			}).then(function (confirmed) {
				if (confirmed !== true) return;
				rpc({ action: "delete", paths: [winPath] }).then(function (result) {
					if (result && result.ok) {
						toast(result.count > 0 ? "已移到回收站：" + baseName : "删除失败：文件已不存在");
					} else {
						toast("删除失败：" + ((result && result.error) || "插件未加载"));
					}
				}).catch(function (error) { toast("删除失败：" + error.message); });
			});
		} });

		openMenu(event.clientX, event.clientY, surface, textColor, items);
	}

	function onPointerDown(event) {
		if (!menu) return;
		if (event.target && menu.contains(event.target)) return;
		closeMenu();
	}

	function onKeyDown(event) {
		if (event.key === "Escape") closeMenu();
	}

	function onDismiss() { closeMenu(); }

	doc.addEventListener("contextmenu", onContextMenu, true);
	doc.addEventListener("mousedown", onPointerDown, true);
	doc.addEventListener("keydown", onKeyDown, true);
	doc.addEventListener("scroll", onDismiss, true);
	window.addEventListener("resize", onDismiss);
	window.addEventListener("blur", onDismiss);

	return function () {
		doc.removeEventListener("contextmenu", onContextMenu, true);
		doc.removeEventListener("mousedown", onPointerDown, true);
		doc.removeEventListener("keydown", onKeyDown, true);
		doc.removeEventListener("scroll", onDismiss, true);
		window.removeEventListener("resize", onDismiss);
		window.removeEventListener("blur", onDismiss);
		closeMenu();
		clearTimeout(toastTimer);
		if (toastEl && toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
		if (activeOverlay && activeOverlay.parentNode) activeOverlay.parentNode.removeChild(activeOverlay);
		activeOverlay = null;
	};
}

var inject = [];
var name = "dsh-copy-path";

function apply(ctx) {
	if (typeof document === "undefined") return;
	ensureStyle(document);
	var dispose = install(document);
	ctx.effect(function () { return dispose; }, "dsh-copy-path: file tree context menu");
}
return { apply: apply };
})();

var inject = [];
var name = "dsh-file-toolkit";

function apply(ctx) {
	PdfPart.apply(ctx);
	MenuPart.apply(ctx);
}

module.exports = { name: name, inject: inject, apply: apply };
return module.exports;
}});
