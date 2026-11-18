// next/script and next/head on the canvas: no third-party scripts and no page head. Previews
// stay local, so analytics and tags never load.
export default function Nothing(_props: object) {
  return null;
}
