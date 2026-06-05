// Example Remotion entry — the file you pass as `entry` to renderRemotion / the
// "remotion" EDL clip kind. It registers the root component. Illustrative only;
// requires the optional peers (remotion, @remotion/bundler, @remotion/renderer,
// react, react-dom) installed in the consuming app.
import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root.tsx";

registerRoot(RemotionRoot);
