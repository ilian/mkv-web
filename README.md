# mkv-web
Play Matroska (MKV) files inside your browser.

## Project description
Modern web browsers only support the WebM container format that is based on Matroska, but limited to royalty-free codecs.
Even when the MKV file contains media encoded by a codec that the browser is able to decode, most browsers are unable to play media in such a container.
This project copies the underlying media streams to containers that are supported by most browsers (e.g. mp4, webm) inside the browser without third-party extensions or programs.
This is achieved by remuxing media segments with ffmpeg compiled to webassembly (thanks to [the ffmpeg.wasm project](https://github.com/ilian/ffmpeg.wasm-core)) using [web workers](https://html.spec.whatwg.org/multipage/workers.html). Remuxed chunks are sent from the Web Worker to the main thread and appended to the HTML5 video element using [Media Source Extensions](https://www.w3.org/TR/media-source-2/).

## Notes on deploying
This project uses SharedArrayBuffer, for which the following [COOP/COEP](https://www.w3.org/TR/post-spectre-webdev/) HTTP headers need to be returned by the server hosting the web page to enable the JavaScript feature:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```
