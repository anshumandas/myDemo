// Example composition registry. Defines a "BrandIntro" composition at the master
// canvas (1920×1080, 30fps) — match your @mydemo/core video.canvas so segments
// join without rescaling. Illustrative only (not type-checked by the package).
import { Composition } from "remotion";
import { BrandIntro } from "./BrandIntro.tsx";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="BrandIntro"
        component={BrandIntro}
        durationInFrames={120} // 4s @ 30fps
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ title: "Your Brand", subtitle: "" }}
      />
    </>
  );
};
