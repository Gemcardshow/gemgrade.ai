export const VINTAGE_RUBRIC = `
VINTAGE CARD RUBRIC (pre-1990):

Score visible condition conservatively for age-appropriate wear.
Penalize corner softening, edge wear, gloss loss, print softness, staining, creasing, surface wear, wax residue, registration issues, and back wear when visible.
Inspect all four corners, all edges, the full front surface, and the full back.
Tag creases, stains, rounded corners, edge fraying, writing, and paper loss when visible.
Heavily worn vintage cards often have multiple simultaneous issues. Tag each visible flaw separately instead of relying on one scratch or surface tag.
Rounded or soft corners should use corner_wear_moderate or rounded_corners_all, not corner_wear_light, when rounding is clearly visible.
Visible edge chipping or border wear should use edge_wear_light or edge_fraying_major.
Light scratches on cards with visible corner rounding and edge wear should use surface_scratch_moderate, not surface_scratch_light.
Visible creases must use moderate_crease or severe_crease.
Structural wear matters more than eye appeal.
When uncertain, choose the lower subgrade.
`.trim();
