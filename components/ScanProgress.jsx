const SCAN_STEPS = [
  { key: "uploading", label: "Uploading images..." },
  { key: "analyzing", label: "Analyzing card..." },
  { key: "calculating", label: "Calculating grade..." },
];

export { SCAN_STEPS };

/**
 * @param {{ activeStep: string | null }} props
 */
export default function ScanProgress({ activeStep }) {
  if (!activeStep) {
    return null;
  }

  const activeIndex = SCAN_STEPS.findIndex((step) => step.key === activeStep);

  return (
    <div className="scan-progress" role="status" aria-live="polite">
      <ol className="scan-progress__steps">
        {SCAN_STEPS.map((step, index) => {
          const isComplete = activeIndex > index;
          const isActive = step.key === activeStep;

          return (
            <li
              key={step.key}
              className={[
                "scan-progress__step",
                isComplete ? "scan-progress__step--complete" : "",
                isActive ? "scan-progress__step--active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span className="scan-progress__marker" aria-hidden="true">
                {isComplete ? "✓" : index + 1}
              </span>
              <span className="scan-progress__label">{step.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
