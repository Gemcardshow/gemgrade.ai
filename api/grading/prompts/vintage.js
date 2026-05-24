export const VINTAGE_RUBRIC = `
VINTAGE CARD RUBRIC (pre-1990):

Score visible condition conservatively for age-appropriate wear.
Penalize corner softening, edge wear, gloss loss, print softness, staining, creasing, surface wear, wax residue, registration issues, and back wear when visible.
Inspect all four corners, all edges, the full front surface, and the full back.
Tag creases, stains, rounded corners, edge fraying, writing, and paper loss when visible.
Pen, ink, pencil, marker, scribbles, or names written on the back must use writing_mark or writing_mark_severe. Do not use back_wear for ink or writing.
Use back_wear only for general back toning, foxing, or paper wear without ink or writing.
Back-only foxing or light toning should use staining_light, not heavy_staining, unless the stain clearly covers a large area or crosses onto the front.
Gold-border edge chipping on T205 and similar issues should use edge_wear_light unless fiber loss is clear on the card stock.
Heavily worn vintage cards often have multiple simultaneous issues. Tag each visible flaw separately instead of relying on one scratch or surface tag.
Rounded or soft corners should use corner_wear_moderate or rounded_corners_all, not corner_wear_light, when rounding is clearly visible.
Visible edge chipping or border wear should use edge_wear_light or edge_fraying_major.
Use edge_fraying_major only for clear cardstock fiber loss, peeling, or heavy chipping. Factory rough-cut edges, minor border softness, and holder/slab artifacts are not major fraying.
When corners and surface remain fair (roughly 6+), prefer edge_wear_light over edge_fraying_major unless edge damage is clearly severe on the card itself.
Cards with strong centering (7.5+) and fair corners/surface should score edges/corners/surface in the 7+ range when only minor factory rough-cut or light touch wear is visible.
Light scratches on cards with visible corner rounding and edge wear should use surface_scratch_moderate, not surface_scratch_light.
Visible creases must use moderate_crease or severe_crease.
Use moderate_crease only for clear fold lines or wrinkles through the card stock. Roller marks, print lines, or light surface ripples without a clear fold should use print_line.
Tag every visible fold line, wrinkle, or bend through the card surface. Vertical or horizontal creases through the image area must never be omitted.
Use severe_crease when a crease breaks color, crosses the player image, or is clearly deep; use moderate_crease for lighter lines.
Structural wear matters more than eye appeal.
When uncertain, choose the lower subgrade.
`.trim();
