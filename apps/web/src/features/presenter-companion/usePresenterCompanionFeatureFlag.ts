import { useEffect, useState } from "react";
import { isPresenterCompanionEnabled } from "./presenterCompanionApi";

export function usePresenterCompanionFeatureFlag() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let active = true;
    void isPresenterCompanionEnabled().then(
      (value) => {
        if (active) setEnabled(value);
      },
      () => {
        if (active) setEnabled(false);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  return enabled;
}
