/**
 * dsh-file-toolkit — Host half.
 *
 * Two local RPC routes:
 *   /dsh-pdf-native/rpc  — PDF text index and highlighted copies (PyMuPDF)
 *   /dsh-copy-path/rpc   — file-tree operations (clipboard files, paste,
 *                          reveal, open, delete to recycle bin, rename, mkdir)
 *
 * Both are loopback-only helpers for the browser half; nothing leaves the
 * machine and no original file is modified by a read.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PDF_ROUTE = "/dsh-pdf-native/rpc";
const MENU_ROUTE = "/dsh-copy-path/rpc";
const MAX_PDF_BYTES = 32 * 1024 * 1024;

export const name = "dsh-file-toolkit";
export const inject = ["webServer"];

// ---------------------------------------------------------------------------
// shared plumbing
// ---------------------------------------------------------------------------

function run(file, args, env) {
	return new Promise((resolve, reject) => {
		execFile(file, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024, env: env || process.env }, (error, stdout, stderr) => {
			if (error) {
				reject(new Error(String(stderr || error.message || "").trim() || "command failed"));
				return;
			}
			resolve(String(stdout || "").trim());
		});
	});
}

function json(res, code, payload) {
	res.writeHead(code, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(JSON.stringify(payload));
}

async function readJson(req, limit) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.length;
		if (size > limit) throw new Error("payload too large");
		chunks.push(chunk);
	}
	if (chunks.length === 0) return {};
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

// ---------------------------------------------------------------------------
// PDF: index and highlight with PyMuPDF
// ---------------------------------------------------------------------------

const PY_SEARCH = [
	"import sys, json, fitz",
	"path, query = sys.argv[1], sys.argv[2]",
	"doc = fitz.open(path)",
	"q = query.casefold()",
	"out = []",
	"for i, page in enumerate(doc, 1):",
	"    text = page.get_text('text')",
	"    folded = text.casefold()",
	"    n = folded.count(q)",
	"    if n:",
	"        at = folded.find(q)",
	"        snippet = ' '.join(text[max(0, at-40):at+len(q)+40].split())",
	"        out.append({'page': i, 'count': n, 'snippet': snippet})",
	"print(json.dumps(out, ensure_ascii=False))"
].join("\n");

const PY_HIGHLIGHT = [
	"import sys, json, base64, fitz",
	"path, query = sys.argv[1], sys.argv[2]",
	"doc = fitz.open(path)",
	"pages = []",
	"for i, page in enumerate(doc, 1):",
	"    rects = page.search_for(query)",
	"    if rects:",
	"        for rect in rects:",
	"            annot = page.add_highlight_annot(rect)",
	"            annot.update()",
	"        pages.append({'page': i, 'count': len(rects)})",
	"data = doc.tobytes(garbage=3, deflate=True)",
	"print(json.dumps({'pdf': base64.b64encode(data).decode('ascii'), 'pages': pages}))"
].join("\n");

async function runPython(args) {
	const env = Object.assign({}, process.env, { PYTHONIOENCODING: "utf-8" });
	const candidates = [
		["python", args],
		["py", ["-3"].concat(args)],
		["C:\\ProgramData\\anaconda3\\python.exe", args]
	];
	let lastError = null;
	for (const candidate of candidates) {
		try {
			return await run(candidate[0], candidate[1], env);
		} catch (error) {
			lastError = error;
		}
	}
	throw lastError || new Error("python not available");
}

async function withPdfTemp(base64, prefix, fn) {
	const bytes = Buffer.from(base64, "base64");
	if (bytes.length === 0) throw new Error("empty pdf");
	if (bytes.length > MAX_PDF_BYTES) throw new Error("pdf too large");
	const dir = mkdtempSync(join(tmpdir(), prefix));
	const file = join(dir, "doc.pdf");
	try {
		writeFileSync(file, bytes);
		return await fn(file);
	} finally {
		try { rmSync(dir, { recursive: true, force: true }); } catch (error) { /* ignore */ }
	}
}

async function pdfHandler(req, res) {
	if (req.method !== "POST") {
		json(res, 405, { ok: false, error: "POST only" });
		return;
	}
	let body;
	try {
		body = await readJson(req, 48 * 1024 * 1024);
	} catch (error) {
		json(res, 400, { ok: false, error: String((error && error.message) || error) });
		return;
	}
	try {
		if (body && body.action === "ping") {
			json(res, 200, { ok: true, version: "1.0.0" });
			return;
		}
		if (body && body.action === "searchPdf") {
			if (typeof body.data !== "string" || body.data.length === 0) throw new Error("no data");
			if (typeof body.query !== "string" || body.query.trim().length === 0) throw new Error("no query");
			const output = await withPdfTemp(body.data, "dsh-pdf-search-", (file) =>
				runPython(["-c", PY_SEARCH, file, body.query.trim()]));
			json(res, 200, { ok: true, matches: JSON.parse(output || "[]") });
			return;
		}
		if (body && body.action === "highlightPdf") {
			if (typeof body.data !== "string" || body.data.length === 0) throw new Error("no data");
			if (typeof body.query !== "string" || body.query.trim().length === 0) throw new Error("no query");
			const output = await withPdfTemp(body.data, "dsh-pdf-highlight-", (file) =>
				runPython(["-c", PY_HIGHLIGHT, file, body.query.trim()]));
			const result = JSON.parse(output || "{}");
			json(res, 200, { ok: true, pages: result.pages || [], pdf: result.pdf || "" });
			return;
		}
		json(res, 400, { ok: false, error: "unknown action" });
	} catch (error) {
		json(res, 500, { ok: false, error: String((error && error.message) || error) });
	}
}

// ---------------------------------------------------------------------------
// File tree: clipboard, paste, open, reveal, delete, rename, mkdir
// ---------------------------------------------------------------------------

function quote(value) {
	return "'" + String(value).replace(/'/g, "''") + "'";
}

function powershell(script) {
	return run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
}

async function copyFiles(paths) {
	const list = paths.map(quote).join(",");
	await powershell("$ErrorActionPreference='Stop'; Set-Clipboard -LiteralPath @(" + list + ")");
}

async function pasteFiles(dir) {
	const script = [
		"$ErrorActionPreference='Stop'",
		"$dest=" + quote(dir),
		"$items=Get-Clipboard -Format FileDropList",
		"if($null -eq $items -or $items.Count -eq 0){ 'none' } else {",
		"$n=0;$skip=0",
		"foreach($i in $items){",
		"$src=$i.FullName",
		"if(-not (Test-Path -LiteralPath $src)){ $skip++; continue }",
		"$item=Get-Item -LiteralPath $src",
		"$base=[IO.Path]::GetFileNameWithoutExtension($item.Name)",
		"$ext=if($item.PSIsContainer){''}else{[IO.Path]::GetExtension($item.Name)}",
		"$target=Join-Path $dest $item.Name",
		"if((Test-Path -LiteralPath $target) -or ([IO.Path]::GetFullPath($src) -eq [IO.Path]::GetFullPath($target))){",
		"$k=0",
		"do{",
		"$candidate=if($k -eq 0){$base+'_copy'+$ext}else{$base+'_copy'+$k+$ext}",
		"$target=Join-Path $dest $candidate",
		"$k++",
		"}while(Test-Path -LiteralPath $target)",
		"}",
		"try{ Copy-Item -LiteralPath $src -Destination $target -Recurse -Force; $n++ }catch{ $skip++ }",
		"}",
		"\"ok:$($n);skip:$($skip)\"",
		"}"
	].join("; ");
	const output = await powershell(script);
	const match = /^ok:(\d+);skip:(\d+)$/.exec(output);
	if (match === null) return { count: 0, skipped: 0 };
	return { count: Number(match[1]) || 0, skipped: Number(match[2]) || 0 };
}

async function reveal(path) {
	try {
		await run("explorer.exe", ["/select," + path]);
	} catch (error) {
		// explorer returns a non-zero exit code even when it opens
	}
}

async function openPath(path) {
	await powershell("Invoke-Item -LiteralPath " + quote(path));
}

async function deletePaths(paths) {
	const script = [
		"Add-Type -AssemblyName Microsoft.VisualBasic",
		"$n=0;$skip=0",
		"foreach($p in @(" + paths.map(quote).join(",") + ")){",
		"if(-not (Test-Path -LiteralPath $p)){ $skip++; continue }",
		"try{",
		"if((Get-Item -LiteralPath $p).PSIsContainer){ [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p,'OnlyErrorDialogs','SendToRecycleBin') } else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p,'OnlyErrorDialogs','SendToRecycleBin') }",
		"$n++",
		"}catch{ $skip++ }",
		"}",
		"\"ok:$($n);skip:$($skip)\""
	].join("; ");
	const output = await powershell(script);
	const match = /^ok:(\d+);skip:(\d+)$/.exec(output);
	if (match === null) throw new Error("delete failed");
	return { count: Number(match[1]) || 0, skipped: Number(match[2]) || 0 };
}

async function renamePath(path, newName) {
	const script = "$ErrorActionPreference='Stop'; (Rename-Item -LiteralPath " + quote(path) +
		" -NewName " + quote(newName) + " -PassThru).FullName";
	return await powershell(script);
}

async function makeDir(dir, name) {
	const script = [
		"$ErrorActionPreference='Stop'",
		"$base=" + quote(name),
		"$i=2",
		"$target=Join-Path " + quote(dir) + " $base",
		"while(Test-Path -LiteralPath $target){ $target=Join-Path " + quote(dir) + " ($base+' '+$i); $i++ }",
		"New-Item -ItemType Directory -Path $target | Out-Null",
		"$target"
	].join("; ");
	return await powershell(script);
}

async function menuHandler(req, res) {
	if (req.method !== "POST") {
		json(res, 405, { ok: false, error: "POST only" });
		return;
	}
	let body;
	try {
		body = await readJson(req, 4 * 1024 * 1024);
	} catch (error) {
		json(res, 400, { ok: false, error: String((error && error.message) || error) });
		return;
	}
	const action = body && body.action;
	try {
		if (action === "ping") {
			json(res, 200, { ok: true, version: "1.0.0" });
			return;
		}
		if (action === "copyFiles") {
			const paths = Array.isArray(body.paths)
				? body.paths.filter((item) => typeof item === "string" && item.length > 0)
				: [];
			if (paths.length === 0) throw new Error("no paths");
			await copyFiles(paths);
			json(res, 200, { ok: true, count: paths.length });
			return;
		}
		if (action === "pasteFiles") {
			if (typeof body.dir !== "string" || body.dir.length === 0) throw new Error("no directory");
			const result = await pasteFiles(body.dir);
			json(res, 200, { ok: true, count: result.count, skipped: result.skipped });
			return;
		}
		if (action === "reveal") {
			if (typeof body.path !== "string" || body.path.length === 0) throw new Error("no path");
			await reveal(body.path);
			json(res, 200, { ok: true });
			return;
		}
		if (action === "open") {
			if (typeof body.path !== "string" || body.path.length === 0) throw new Error("no path");
			await openPath(body.path);
			json(res, 200, { ok: true });
			return;
		}
		if (action === "delete") {
			const paths = Array.isArray(body.paths)
				? body.paths.filter((item) => typeof item === "string" && item.length > 0)
				: [];
			if (paths.length === 0) throw new Error("no paths");
			const result = await deletePaths(paths);
			json(res, 200, { ok: true, count: result.count, skipped: result.skipped });
			return;
		}
		if (action === "rename") {
			if (typeof body.path !== "string" || body.path.length === 0) throw new Error("no path");
			if (typeof body.name !== "string" || body.name.length === 0) throw new Error("no name");
			if (/[\\/]/.test(body.name)) throw new Error("name must not contain a path separator");
			const full = await renamePath(body.path, body.name);
			json(res, 200, { ok: true, path: full });
			return;
		}
		if (action === "mkdir") {
			if (typeof body.dir !== "string" || body.dir.length === 0) throw new Error("no directory");
			const full = await makeDir(body.dir, typeof body.name === "string" && body.name ? body.name : "新建文件夹");
			json(res, 200, { ok: true, path: full });
			return;
		}
		json(res, 400, { ok: false, error: "unknown action" });
	} catch (error) {
		json(res, 500, { ok: false, error: String((error && error.message) || error) });
	}
}

export function apply(ctx) {
	ctx.inject(["webServer"], (scoped) => {
		scoped.effect(() => {
			const disposePdf = scoped.webServer.register({
				kind: "exact",
				path: PDF_ROUTE,
				handler: pdfHandler
			});
			const disposeMenu = scoped.webServer.register({
				kind: "exact",
				path: MENU_ROUTE,
				handler: menuHandler
			});
			return () => {
				disposePdf();
				disposeMenu();
			};
		}, "dsh-file-toolkit: RPC routes");
	});
}
