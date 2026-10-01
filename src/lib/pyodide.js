/* global loadPyodide -- defined by the Pyodide script loaded from the CDN */
const PYODIDE_CDN_BASE = "https://cdn.jsdelivr.net/pyodide/v0.23.4/full/";

// Served from public/artifact and precached by the service worker, so marks parsing works
// offline and doesn't depend on another repository's main branch.
const WHEELS = [
  "artifact/PyMuPDF-1.24.12-cp311-abi3-emscripten_3_1_32_wasm32.whl",
  "artifact/jiit_marks-0.2.0-py3-none-any.whl",
];

// Each step is cached while in flight or done, and cleared if it fails, so a network
// hiccup is retried on the next call instead of breaking marks until a reload.
let _scriptPromise = null;
let _pyodidePromise = null;
let _packagesPromise = null;

const resetOnFailure = (promise, reset) => {
  promise.catch(reset);
  return promise;
};

function ensurePyodideScript() {
  if (typeof loadPyodide === "function") return Promise.resolve();
  if (!_scriptPromise) {
    _scriptPromise = resetOnFailure(new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = `${PYODIDE_CDN_BASE}pyodide.js`;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        s.remove();
        reject(new Error("Failed to load Pyodide script"));
      };
      document.head.appendChild(s);
    }), () => { _scriptPromise = null; });
  }
  return _scriptPromise;
}

export async function getPyodideInstance() {
  await ensurePyodideScript();
  if (!_pyodidePromise) {
    _pyodidePromise = resetOnFailure(loadPyodide({ indexURL: PYODIDE_CDN_BASE }), () => { _pyodidePromise = null; });
  }
  return await _pyodidePromise;
}

export async function ensurePackagesLoaded() {
  const pyodide = await getPyodideInstance();
  if (!_packagesPromise) {
    _packagesPromise = resetOnFailure((async () => {
      for (const wheel of WHEELS) {
        await pyodide.loadPackage(new URL(`${import.meta.env.BASE_URL}${wheel}`, window.location.href).href);
      }
      // loadPackage only logs a failed download, so check the modules really installed.
      pyodide.runPython("import pymupdf\nimport jiit_marks");
    })(), () => { _packagesPromise = null; });
  }
  await _packagesPromise;
  return pyodide;
}

export async function getPyodideWithPackages() {
  return await ensurePackagesLoaded();
}
