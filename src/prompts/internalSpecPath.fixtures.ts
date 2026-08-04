export const FLANDERS_INTERNAL_SPEC_MARKDOWN_PATH = /(?:^|[^\p{L}\p{N}_.-])(?:(?:(?:(?:\.spec[\\/])?(?:contracts|rules|flanders)|plans)[\\/](?:[^\s\\/`'")\]}<>]+[\\/])*[^\s\\/`'")\]}<>]+\.md(?:#[^\s`'")\]}<>]+)?)|shared[\\/]spec-folder-write-authority\.md(?:#[^\s`'")\]}<>]+)?)(?=$|[\s`'")\]}<>,;:.!?])/iu;

export const FLANDERS_INTERNAL_SPEC_MARKDOWN_PATHS = new RegExp(FLANDERS_INTERNAL_SPEC_MARKDOWN_PATH.source, "giu");
