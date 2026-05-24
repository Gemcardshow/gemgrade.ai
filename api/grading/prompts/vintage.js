export const VINTAGE_RUBRIC = `
VINTAGE CARD RUBRIC (pre-1990):

Score visible condition conservatively for age-appropriate wear.
Penalize corner softening, edge wear, gloss loss, print softness, staining, creasing, surface wear, wax residue, registration issues, and back wear when visible.
Inspect all four corners, all edges, the full front surface, and the full back.
Tag creases, stains, rounded corners, edge fraying, writing, and paper loss when visible.
Pen, ink, pencil, marker, scribbles, or names written on the back must use writing_mark or writing_mark_severe. Do not use back_wear for ink or writing.
Use back_wear only for general back toning, foxing, or paper wear without ink or writing.
Heavily worn vintage cards often have multiple simultaneous issues. Tag each visible flaw separately instead of relying on one scratch or surface tag.
Rounded or soft corners should use corner_wear_moderate or rounded_corners_all, not corner_wear_light, when rounding is clearly visible.
Visible edge chipping or border wear should use edge_wear_light or edge_fraying_major.
Use edge_fraying_major only for clear cardstock fiber loss, peeling, or heavy chipping. Factory rough-cut edges, minor border softness, and holder/slab artifacts are not major fraying.
When corners and surface remain fair (roughly 6+), prefer edge_wear_light over edge_fraying_major unless edge damage is clearly severe on the card itself.
Cards with strong centering (7.5+) and fair corners/surface should score edges/corners/surface in the 7+ range when only minor factory rough-cut or light touch wear is visible.
Light scratches on cards with visible corner rounding and edge wear should use surface_scratch_moderate, not surface_scratch_light.
Visible creases must use moderate_crease or severe_crease.
Structural wear matters more than eye appeal.
When uncertain, choose the lower subgrade.
`.trim();
