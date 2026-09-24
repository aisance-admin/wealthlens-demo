/* WealthLens · PDF.js 4 (legacy-сборка) со своего адреса. Модуль грузится после обычных скриптов — чтение ждёт события
   pdfjs-ready. Отдельным файлом, а не в странице: политика безопасности (CSP) не разрешает встроенные скрипты. */
import * as pdfjsLib from "./vendor/pdfjs/pdf.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
window.pdfjsLib = pdfjsLib;
window.dispatchEvent(new Event("pdfjs-ready"));
