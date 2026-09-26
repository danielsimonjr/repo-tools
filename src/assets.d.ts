/** A `.wasm` file imported with Bun's file loader: the import gives the path of the file. */
declare module "*.wasm" {
  const path: string;
  export default path;
}
