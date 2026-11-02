window.__ModuleLoader__.load({ id: "dsh-pdf-native", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;

var React = require("react");

/**
 * Implementation id registered with the document-preview registry. The sidebar
 * dispatches the keyed body slot with `key === selected implementation id`, so
 * this constant is the only contract between the two registrations.
 */
var IMPL_ID = "dsh-pdf-native/pdf";

/**
 * Sidebar PDF body that hands the bytes to the browser's native PDF viewer.
 *
 * The builtin body feeds pdf.js; this one mints a blob URL and lets Chromium
 * (PDFium) render it, which is far cheaper for font-heavy LaTeX PDFs.
 */
function NativePdfBody(props) {
	var content = props && props.content;
	var url = React.useMemo(function () {
		try {
			if (!content || content.kind !== "bytes" || !content.data) return null;
			var bytes = content.data instanceof Uint8Array
				? content.data
				: new Uint8Array(content.data);
			if (bytes.byteLength === 0) return null;
			return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
		} catch (error) {
			return null;
		}
	}, [content]);

	React.useEffect(function () {
		return function () {
			if (url) URL.revokeObjectURL(url);
		};
	}, [url]);

	if (!url) {
		return React.createElement("div", {
			style: {
				display: "flex", alignItems: "center", justifyContent: "center",
				width: "100%", height: "100%", minHeight: "160px",
				fontSize: "12px", opacity: 0.6
			}
		}, "PDF bytes unavailable");
	}

	return React.createElement("iframe", {
		src: url + "#toolbar=1&navpanes=0&view=FitH",
		title: "PDF",
		style: {
			border: 0,
			display: "block",
			width: "100%",
			height: "100%",
			minHeight: "160px",
			background: "#ffffff"
		}
	});
}

var inject = ["slots", "documentPreviews"];
var name = "dsh-pdf-native";

/**
 * Register a PDF preview implementation ranked above `builtin`, plus the keyed
 * body the sidebar renders for that implementation. Unloading the plugin
 * disposes both registrations and the builtin pdf.js body takes over again.
 */
function apply(ctx) {
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

module.exports = { name: name, inject: inject, apply: apply };
return module.exports;
}});
