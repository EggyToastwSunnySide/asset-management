/** Values of the backend's `attribute_data_type` enum (backend/api/dto/assetTypes.dto.js). */
export const ATTRIBUTE_DATA_TYPES = ['text', 'number', 'date', 'boolean'] as const
export type AttributeDataType = (typeof ATTRIBUTE_DATA_TYPES)[number]

export const DATA_TYPE_LABELS: Record<AttributeDataType, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  boolean: 'Yes / no',
}

/** A custom attribute of an asset type, as served by `GET /api/asset-types/:code/attributes`. */
export interface Attribute {
  key: string
  label: string
  dataType: AttributeDataType
  isRequired: boolean
  /** False once hidden (DELETE); the key stays reserved and can be restored. */
  isActive: boolean
}

/** Body of `POST` / `PUT /api/asset-types/:code/attributes`. */
export interface AttributeInput {
  key: string
  label: string
  dataType: AttributeDataType
  isRequired: boolean
}
