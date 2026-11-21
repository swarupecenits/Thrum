/** Metro bundles fonts as asset ids, the same as `require()` of an image. */
declare module '*.ttf' {
  const asset: number;
  export default asset;
}
