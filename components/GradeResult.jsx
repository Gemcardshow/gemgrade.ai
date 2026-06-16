import ProGradeResult from "./ProGradeResult.jsx";
import ScoutResult from "./ScoutResult.jsx";

/**
 * @param {{
 *   grade: Record<string, unknown> | null,
 *   mode?: "scout"|"pro",
 * }} props
 */
export default function GradeResult({ grade, mode = "pro" }) {
  if (!grade) {
    return null;
  }

  if (mode === "scout") {
    return <ScoutResult grade={grade} />;
  }

  return <ProGradeResult grade={grade} />;
}
