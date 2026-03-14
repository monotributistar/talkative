// Leaflet is loaded via CDN in index.html, not via npm
// This declaration prevents TypeScript from erroring on the global `L` namespace
declare module "leaflet" {
  const L: any;
  export = L;
}
