/** esbuild loads a .gz file as its bytes (see the build script). */
declare module '*.gz' {
  const bytes: Uint8Array;
  export default bytes;
}
