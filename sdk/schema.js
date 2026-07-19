// The metadata envelope contract. Consumers key off `format` +
// `schemaVersion` (see SCHEMA.md and schema/bowser-snaps.schema.json for the
// full field reference); fields are only added within a schemaVersion —
// breaking changes bump it.

export const FORMAT = 'bowser-snaps';
export const SCHEMA_VERSION = 2;

/** PNG iTXt keyword the metadata JSON is embedded under. */
export const METADATA_KEYWORD = 'bowser-snaps';
