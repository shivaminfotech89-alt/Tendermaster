/**
 * Minimal browser-API stubs for running pdfjs-dist in Node.js.
 *
 * pdfjs-dist v6 normally polyfills DOMMatrix / Path2D via @napi-rs/canvas.
 * When that native binding is unavailable, pdfjs throws at module init time.
 * We only use pdfjs for text extraction (getTextContent), which never touches
 * canvas rendering, so these stubs just need to satisfy the module initialiser
 * (e.g. `const SCALE_MATRIX = new DOMMatrix()`) — they are never actually called.
 *
 * IMPORTANT: This file must be imported as the very first import in any Node
 * script that imports pdfjs-dist, so the polyfills are set on globalThis before
 * the pdfjs module body evaluates.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

if (!globalThis.DOMMatrix) {
  class DOMMatrixStub {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    m11 = 1; m12 = 0; m13 = 0; m14 = 0;
    m21 = 0; m22 = 1; m23 = 0; m24 = 0;
    m31 = 0; m32 = 0; m33 = 1; m34 = 0;
    m41 = 0; m42 = 0; m43 = 0; m44 = 1;
    is2D = true; isIdentity = true;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_init?: string | number[]) {}
    invertSelf()                              { return this; }
    multiplySelf(_m: unknown)                 { return this; }
    preMultiplySelf(_m: unknown)              { return this; }
    translate(_x = 0, _y = 0, _z = 0)        { return this; }
    scale(_sx = 1, _sy = 1, _sz = 1)         { return this; }
    scale3d(_scale = 1)                       { return this; }
    rotate(_rx = 0, _ry = 0, _rz = 0)        { return this; }
    flipX()                                   { return this; }
    flipY()                                   { return this; }
    skewX(_sx = 0)                            { return this; }
    skewY(_sy = 0)                            { return this; }
    inverse()                                 { return this; }
    transformPoint(p: Record<string, number>) { return p; }
    toFloat32Array()                          { return new Float32Array(6); }
    toFloat64Array()                          { return new Float64Array(6); }
    toString()                                { return 'matrix(1,0,0,1,0,0)'; }
  }
  (globalThis as any).DOMMatrix = DOMMatrixStub;
}

if (!globalThis.Path2D) {
  class Path2DStub {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_path?: unknown) {}
    addPath(_path: unknown, _transform?: unknown) {}
    closePath()                              {}
    moveTo(_x: number, _y: number)           {}
    lineTo(_x: number, _y: number)           {}
    arc(_x: number, _y: number, _r: number, _start: number, _end: number, _cc?: boolean) {}
    arcTo(_x1: number, _y1: number, _x2: number, _y2: number, _r: number) {}
    bezierCurveTo(_cp1x: number, _cp1y: number, _cp2x: number, _cp2y: number, _x: number, _y: number) {}
    quadraticCurveTo(_cpx: number, _cpy: number, _x: number, _y: number) {}
    ellipse(_x: number, _y: number, _rx: number, _ry: number, _rot: number, _start: number, _end: number, _cc?: boolean) {}
    rect(_x: number, _y: number, _w: number, _h: number) {}
  }
  (globalThis as any).Path2D = Path2DStub;
}

if (!globalThis.ImageData) {
  class ImageDataStub {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(widthOrData: number | Uint8ClampedArray, height: number) {
      if (typeof widthOrData === 'number') {
        this.width = widthOrData;
        this.height = height;
        this.data = new Uint8ClampedArray(widthOrData * height * 4);
      } else {
        this.data = widthOrData;
        this.width = Math.sqrt(widthOrData.length / 4);
        this.height = height;
      }
    }
  }
  (globalThis as any).ImageData = ImageDataStub;
}
