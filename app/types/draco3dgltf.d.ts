// draco3dgltf ships no types. glTF-Transform takes its modules as opaque
// dependencies, so this is all the app needs from it.
declare module "draco3dgltf" {
  const draco3d: {
    createEncoderModule(options?: object): Promise<unknown>;
    createDecoderModule(options?: object): Promise<unknown>;
  };
  export default draco3d;
}
